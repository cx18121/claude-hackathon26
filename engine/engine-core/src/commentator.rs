//! Live AI commentary engine (COMM-01).
//!
//! Spawned once per room. Receives CommentaryHint events via an mpsc channel,
//! calls Claude (streaming) to generate a short call, then optionally calls
//! ElevenLabs to convert each sentence to audio.
//!
//! Broadcast messages sent to game_tx (received by spectator overlay):
//!   {"type":"commentary_start","id":N}
//!   {"type":"commentary_text","id":N,"delta":"..."}   (one per streamed chunk)
//!   {"type":"commentary_audio","id":N,"idx":M,"mime":"audio/mpeg","audio_b64":"<b64 mp3>"}
//!   {"type":"commentary_end","id":N}
//!
//! Both keys are optional — missing key disables that half gracefully.
//! Set ANTHROPIC_API_KEY and ELEVENLABS_API_KEY in the environment.

use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc};
use serde_json::{json, Value};
use base64::Engine as _;

const CLAUDE_MODEL: &str = "claude-haiku-4-5-20251001";
const CLAUDE_MAX_TOKENS: u32 = 120;
const TRIGGER_COOLDOWN_SECS: f64 = 3.5;
const PRIORITY_EVENTS: &[&str] = &["first_blood", "ko", "match_end", "round_end", "comeback"];

const SYSTEM_PROMPT: &str = r#"You are SHADOW, the unofficial play-by-play voice of an underground 1v1 phone-camera fight tournament. Two fighters. Pose-tracked silhouettes. Real punches, real kicks, real sweat. You see every blow as it lands and call it like the world depends on it.

VOICE
- 1 to 2 short sentences. Total under 25 words. No exceptions.
- Present tense, active verbs, vivid imagery.
- Punch with consonants. Bite the words.
- Trash talk and hype both welcome. Be opinionated, take sides briefly, then flip.
- Never read raw stats. Translate to feeling: "clinging on", "still fresh", "wobbling".
- Never repeat phrasing from your last few calls.
- React to THIS moment. Don't recap. Don't predict.

INPUT
You receive a JSON packet. Output ONLY the call — no preamble, no JSON, no quotes, no stage directions."#;

#[derive(Debug, Clone)]
pub struct CommentaryHint {
    pub kind: String,
    pub payload: Value,
}

/// Spawn the commentary task for one room. Returns the sender end of the hint channel.
/// The task exits when the sender is dropped (room teardown).
pub fn spawn(
    game_tx: broadcast::Sender<String>,
    room_code: String,
) -> mpsc::Sender<CommentaryHint> {
    let (tx, rx) = mpsc::channel::<CommentaryHint>(32);
    tokio::spawn(run(rx, game_tx, room_code));
    tx
}

async fn run(
    mut rx: mpsc::Receiver<CommentaryHint>,
    game_tx: broadcast::Sender<String>,
    room_code: String,
) {
    let anthropic_key = std::env::var("ANTHROPIC_API_KEY").ok();
    let elevenlabs_key = std::env::var("ELEVENLABS_API_KEY").ok();
    let voice_id = std::env::var("ELEVENLABS_VOICE_ID")
        .unwrap_or_else(|_| "pNInz6obpgDQGcFmaJgB".to_string());
    let el_model = std::env::var("ELEVENLABS_MODEL_ID")
        .unwrap_or_else(|_| "eleven_flash_v2_5".to_string());

    if anthropic_key.is_none() {
        tracing::info!("room {}: ANTHROPIC_API_KEY not set — commentary disabled", room_code);
        // Drain the channel so the sender never blocks, then exit
        while rx.recv().await.is_some() {}
        return;
    }
    let anthropic_key = anthropic_key.unwrap();

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .expect("reqwest client");

    let mut last_fired_at: Option<Instant> = None;
    let mut recent_calls: Vec<String> = Vec::new();
    let mut call_id: u32 = 0;

    while let Some(hint) = rx.recv().await {
        // Cooldown gate — skip unless it's a priority event
        let is_priority = PRIORITY_EVENTS.contains(&hint.kind.as_str());
        if !is_priority {
            if let Some(last) = last_fired_at {
                if last.elapsed().as_secs_f64() < TRIGGER_COOLDOWN_SECS {
                    continue;
                }
            }
        }
        last_fired_at = Some(Instant::now());
        call_id += 1;
        let id = call_id;

        let user_content = json!({
            "event": { "kind": hint.kind, "data": hint.payload },
            "recent_calls": recent_calls.iter().rev().take(3).collect::<Vec<_>>(),
        })
        .to_string();

        // --- Claude streaming request ---
        let body = json!({
            "model": CLAUDE_MODEL,
            "max_tokens": CLAUDE_MAX_TOKENS,
            "system": SYSTEM_PROMPT,
            "messages": [{ "role": "user", "content": user_content }],
            "stream": true,
        });

        let resp = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &anthropic_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await;

        let resp = match resp {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                tracing::warn!("room {}: Claude returned {}", room_code, r.status());
                continue;
            }
            Err(e) => {
                tracing::warn!("room {}: Claude request failed: {}", room_code, e);
                continue;
            }
        };

        let _ = game_tx.send(format!(r#"{{"type":"commentary_start","id":{id}}}"#));

        // Collect full text while streaming deltas to the overlay
        let mut full_text = String::new();
        let mut sentence_buf = String::new();
        let mut sentence_idx: u32 = 0;

        use futures_util::StreamExt;
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let bytes = match chunk {
                Ok(b) => b,
                Err(e) => { tracing::warn!("room {}: stream read error: {}", room_code, e); break; }
            };
            let text = String::from_utf8_lossy(&bytes);
            // SSE: each line is "data: {...}" or "data: [DONE]"
            for line in text.lines() {
                let Some(data) = line.strip_prefix("data: ") else { continue };
                if data.trim() == "[DONE]" { break; }
                let Ok(evt) = serde_json::from_str::<Value>(data) else { continue };
                let Some(delta) = evt
                    .get("delta")
                    .and_then(|d| d.get("text"))
                    .and_then(|t| t.as_str())
                else { continue };

                full_text.push_str(delta);
                sentence_buf.push_str(delta);

                // Escape for inline JSON string
                let safe = delta.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', " ");
                let _ = game_tx.send(format!(r#"{{"type":"commentary_text","id":{id},"delta":"{safe}"}}"#));

                // Sentence boundary — fire TTS for each completed sentence
                if let Some(el_key) = &elevenlabs_key {
                    while let Some(pos) = sentence_buf.find(|c| c == '.' || c == '!' || c == '?') {
                        let sentence = sentence_buf[..=pos].trim().to_string();
                        sentence_buf = sentence_buf[pos + 1..].to_string();
                        if sentence.len() < 4 { continue; }

                        let idx = sentence_idx;
                        sentence_idx += 1;
                        let el_key = el_key.clone();
                        let client2 = client.clone();
                        let voice = voice_id.clone();
                        let model = el_model.clone();
                        let tx2 = game_tx.clone();
                        let rc2 = room_code.clone();
                        tokio::spawn(async move {
                            tts_and_broadcast(client2, el_key, voice, model, sentence, id, idx, tx2, rc2).await;
                        });
                    }
                }
            }
        }

        let _ = game_tx.send(format!(r#"{{"type":"commentary_end","id":{id}}}"#));

        if !full_text.is_empty() {
            recent_calls.push(full_text);
            if recent_calls.len() > 6 {
                recent_calls.remove(0);
            }
        }
    }

    tracing::debug!("room {}: commentary task exiting (channel closed)", room_code);
}

async fn tts_and_broadcast(
    client: reqwest::Client,
    el_key: String,
    voice_id: String,
    model_id: String,
    text: String,
    call_id: u32,
    sentence_idx: u32,
    game_tx: broadcast::Sender<String>,
    room_code: String,
) {
    let resp = client
        .post(format!("https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"))
        .header("xi-api-key", &el_key)
        .json(&json!({
            "text": text,
            "model_id": model_id,
            "output_format": "mp3_44100_64",
        }))
        .send()
        .await;

    match resp {
        Ok(r) if r.status().is_success() => {
            match r.bytes().await {
                Ok(audio) => {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&audio);
                    let _ = game_tx.send(format!(
                        r#"{{"type":"commentary_audio","id":{call_id},"idx":{sentence_idx},"mime":"audio/mpeg","audio_b64":"{b64}"}}"#
                    ));
                }
                Err(e) => tracing::warn!("room {}: ElevenLabs read failed: {}", room_code, e),
            }
        }
        Ok(r) => tracing::warn!("room {}: ElevenLabs returned {}", room_code, r.status()),
        Err(e) => tracing::warn!("room {}: ElevenLabs request failed: {}", room_code, e),
    }
}
