use std::time::Instant;
use crate::room::RoomState;
use crate::protocol::*;

// Constants ported from server/game_loop.py lines 26-28
pub const ROUND_DURATION: f64 = 90.0;
pub const ROUND_WARMUP: f64 = 3.8;

/// Called from room_actor's select! tick arm (ENG-04).
/// Implements: warmup gate (ENG-09), round lifecycle (ENG-10), MsgGameState broadcast.
/// Hit detection is Phase 2 scope — this returns empty recent_hits every tick.
pub fn game_tick(state: &mut RoomState) {
    // Only tick if match is in progress (both players calibrated)
    let match_in_progress = state.players.iter().all(|p| p.reference_velocity.is_some())
        && state.round_start_time.is_some()
        && !state.match_over;

    if !match_in_progress {
        return;
    }

    let round_live_at = state.round_start_time.unwrap();
    let warmup_elapsed = round_live_at.elapsed().as_secs_f64();

    // ENG-09: During warmup (first ROUND_WARMUP seconds), clear input buffers
    if warmup_elapsed < ROUND_WARMUP {
        for player in state.players.iter_mut() {
            player.pose_buffer.clear();
            player.processed_frames.clear();
        }
        // Broadcast game_state with full round duration during warmup
        let gs = build_game_state(state, ROUND_DURATION);
        if let Ok(json) = serde_json::to_string(&gs) {
            let _ = state.game_tx.send(json);
        }
        return;
    }

    // Live phase: compute remaining time
    let live_elapsed = warmup_elapsed - ROUND_WARMUP;
    let remaining_time = (ROUND_DURATION - live_elapsed).max(0.0);

    // ENG-06: Drain RTT-released frames (Phase 2 will process these for hit detection)
    let samples_p1 = state.players[0].rtt_samples.clone();
    let samples_p2 = state.players[1].rtt_samples.clone();
    let (cutoff, rtt_a, rtt_b) = crate::input_delay::compute_cutoff(
        &samples_p1,
        &samples_p2,
        crate::input_delay::MAX_INPUT_DELAY_MS,
    );
    for player in state.players.iter_mut() {
        while let Some(&(arrived_at, _)) = player.pose_buffer.front() {
            if arrived_at <= cutoff {
                if let Some((_, frame)) = player.pose_buffer.pop_front() {
                    player.processed_frames.push_back(frame);
                }
            } else {
                break;
            }
        }
        // Phase 1 has no hit-detection consumer for processed_frames; clear immediately
        // to bound memory (~5 400 frames × ~1 KB/frame = ~5 MB unbounded per round) (WR-05).
        // Phase 2 will process these frames before clearing.
        player.processed_frames.clear();
    }

    // ENG-10: Check round over (time limit only in Phase 1; KO added in Phase 2)
    let round_over = remaining_time <= 0.0;

    if round_over {
        // Determine winner by HP (equal HP = draw)
        let winner: Option<u8> = match state.hp[0].cmp(&state.hp[1]) {
            std::cmp::Ordering::Greater => Some(1),
            std::cmp::Ordering::Less => Some(2),
            std::cmp::Ordering::Equal => None, // draw
        };

        // Broadcast round end
        let round_end = MsgRoundEnd {
            msg_type: "round_end".to_string(),
            winner,
            final_hp: (state.hp[0], state.hp[1]),
        };
        if let Ok(json) = serde_json::to_string(&round_end) {
            let _ = state.game_tx.send(json.clone());
            // Also send to players — log if channel full so we don't silently drop (WR-02)
            for (slot, player) in state.players.iter().enumerate() {
                if let Some(tx) = &player.tx {
                    if tx.try_send(json.clone()).is_err() {
                        tracing::warn!("room {} player {} outbound channel full, dropping round_end", state.code, slot + 1);
                    }
                }
            }
        }

        // Increment win counter
        if let Some(w) = winner {
            state.wins[(w - 1) as usize] += 1;
        }

        // Check match over
        if state.wins.iter().any(|&w| w >= state.max_wins) {
            let match_winner = state
                .wins
                .iter()
                .enumerate()
                .max_by_key(|(_, &w)| w)
                .map(|(i, _)| (i + 1) as u8)
                .unwrap_or(1);
            let match_end = MsgMatchEnd {
                msg_type: "match_end".to_string(),
                winner: match_winner,
            };
            if let Ok(json) = serde_json::to_string(&match_end) {
                let _ = state.game_tx.send(json.clone());
                // Log if channel full — match_end must not be silently dropped (WR-02)
                for (slot, player) in state.players.iter().enumerate() {
                    if let Some(tx) = &player.tx {
                        if tx.try_send(json.clone()).is_err() {
                            tracing::warn!("room {} player {} outbound channel full, dropping match_end", state.code, slot + 1);
                        }
                    }
                }
            }
            state.match_over = true;
            // Signal the shared flag so RoomHandle.is_expired() can observe match completion (CR-03)
            state.match_over_flag.store(true, std::sync::atomic::Ordering::Relaxed);
            tracing::info!("room {} match ended, winner player {}", state.code, match_winner);
            return;
        }

        // Reset for next round (ENG-10: on_round_reset)
        state.round_number += 1;
        state.hp = [800, 800];
        state.round_start_time = Some(Instant::now()); // new warmup window
        // Clear processed frames
        for player in state.players.iter_mut() {
            player.pose_buffer.clear();
            player.processed_frames.clear();
        }

        let round_start = MsgRoundStart {
            msg_type: "round_start".to_string(),
            round_number: state.round_number,
        };
        if let Ok(json) = serde_json::to_string(&round_start) {
            let _ = state.game_tx.send(json.clone());
            // Log if channel full — round_start must not be silently dropped (WR-02)
            for (slot, player) in state.players.iter().enumerate() {
                if let Some(tx) = &player.tx {
                    if tx.try_send(json.clone()).is_err() {
                        tracing::warn!("room {} player {} outbound channel full, dropping round_start", state.code, slot + 1);
                    }
                }
            }
        }
        tracing::info!("room {} round {} started", state.code, state.round_number);
        return;
    }

    // Broadcast live game_state (poses always empty in Phase 1 per _EMPTY_POSES pattern)
    let high_latency = rtt_a.max(rtt_b) > 150.0;
    let gs = build_game_state_with_latency(state, remaining_time, high_latency);
    if let Ok(json) = serde_json::to_string(&gs) {
        let _ = state.game_tx.send(json);
        // NOTE: game_state is NOT sent to individual players in the Python server — only to spectators
        // Players receive game_state via the spectator broadcast channel if they subscribe to it
    }
}

fn build_game_state(state: &RoomState, remaining_time: f64) -> MsgGameState {
    build_game_state_with_latency(state, remaining_time, false)
}

fn build_game_state_with_latency(
    state: &RoomState,
    remaining_time: f64,
    high_latency: bool,
) -> MsgGameState {
    MsgGameState {
        msg_type: "game_state".to_string(),
        tick: 0, // tick counter not tracked in Phase 1; Phase 2 will add
        hp: (state.hp[0], state.hp[1]),
        wins: (state.wins[0], state.wins[1]), // FIX-02: wins in snapshot prevents overlay desync on reconnect
        poses: (vec![], vec![]),              // _EMPTY_POSES — poses travel via pose_update fast path
        recent_hits: vec![],                  // hit detection is Phase 2
        high_latency,
        remaining_time,
        max_wins: state.max_wins,
    }
}

/// GameEvent enum (D-07: defined in Phase 1, commentary variants deferred)
pub enum GameEvent {
    RoundStart { round_number: u32 },
    RoundOver { winner: Option<u8> },
    MatchEnd { winner: u8 },
    // CommentaryHint { ... } — deferred to Phase 2
}
