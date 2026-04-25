"""Live AI commentator.

Wires the game loop to Claude (text generation) and ElevenLabs (TTS) so the
overlay can render a real-time subtitle ticker while the speakers play
sentence-level audio. Both halves degrade gracefully: missing
ANTHROPIC_API_KEY disables the engine entirely; missing ELEVENLABS_API_KEY
keeps text but skips audio.

Event flow:

    game_loop -> CommentaryEngine.event(...) -> internal queue
        -> _run_loop picks the next trigger
        -> Claude streams tokens
            text deltas      -> broadcast as commentary_text
            sentence boundary -> ElevenLabs HTTP TTS
                              -> broadcast as commentary_sentence (b64 mp3)

The Claude system prompt is identical across calls so the prefix is reused
through prompt caching. Per-call user content carries the event packet plus
a short rolling history of recent calls (so the model doesn't repeat
itself) and the most recent game events (so the call is grounded in what
just happened).
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import re
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

import anthropic
import httpx

log = logging.getLogger(__name__)

CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-opus-4-7")

# Punchy male announcer-style voice. Override with ELEVENLABS_VOICE_ID.
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "pNInz6obpgDQGcFmaJgB")
# Flash v2.5 is the lowest-latency model (~75ms TTFB), perfect for short
# reactive lines. Override with ELEVENLABS_MODEL_ID for higher quality.
ELEVENLABS_MODEL_ID = os.getenv("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5")

# Don't fire commentary more often than this (seconds). The game can produce
# a hit every ~200ms during a flurry — without a cooldown the commentary
# would be a constant overlapping wall of sound.
_TRIGGER_COOLDOWN = 3.5
# But always speak immediately on these high-priority events, even mid-cooldown.
_PRIORITY_EVENTS = frozenset({"first_blood", "ko", "match_end", "round_end", "comeback"})

# Sentence boundary: the first ., !, or ? followed by a space or end of text.
_SENTENCE_RE = re.compile(r"([^.!?\n]+[.!?\n]+)")

SYSTEM_PROMPT = """You are SHADOW, the unofficial play-by-play voice of an underground 1v1 phone-camera fight tournament. Two fighters. Pose-tracked silhouettes. Real punches, real kicks, real sweat. You see every blow as it lands and call it like the world depends on it.

VOICE
- 1 to 2 short sentences. Total under 25 words. No exceptions.
- Present tense, active verbs, vivid imagery.
- Punch with consonants. Bite the words.
- Trash talk and hype both welcome. Be opinionated, take sides briefly, then flip.
- Never read raw stats. "HP 47" is BANNED. Translate to feeling: "clinging on", "still fresh", "wobbling".
- Never repeat phrasing from your last few calls (you'll see them in the history).
- React to THIS moment. Don't recap. Don't predict.

INPUT
You receive a JSON packet describing the current event, recent events, current HP, round number, and your last few calls. Output ONLY the call itself — no preamble, no JSON, no quotes, no stage directions."""


@dataclass
class CommentaryEvent:
    """A game event the commentator may decide to react to."""

    kind: str
    payload: dict[str, Any]
    timestamp: float = field(default_factory=time.time)
    priority: bool = False


# Broadcast callback: takes a JSON-string message, sends it to spectators.
BroadcastFn = Callable[[str], Awaitable[None]]


class CommentaryEngine:
    """Per-room commentary task.

    Owns one Anthropic stream at a time. Game events are funneled in via
    `event()` and consumed asynchronously. Output is multiplexed:
    `commentary_text` deltas go out as Claude streams, and once a sentence
    completes it's pushed to ElevenLabs and the resulting audio is
    broadcast as `commentary_sentence`.
    """

    def __init__(self, broadcast: BroadcastFn) -> None:
        self._broadcast = broadcast
        self._anthropic_key = os.getenv("ANTHROPIC_API_KEY")
        self._elevenlabs_key = os.getenv("ELEVENLABS_API_KEY")
        self._enabled = bool(self._anthropic_key)

        if not self._enabled:
            log.warning("commentator: ANTHROPIC_API_KEY not set — disabled")
            return
        if not self._elevenlabs_key:
            log.warning("commentator: ELEVENLABS_API_KEY not set — text-only mode")

        self._anthropic = anthropic.AsyncAnthropic(api_key=self._anthropic_key)
        self._http = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0))

        self._queue: asyncio.Queue[CommentaryEvent] = asyncio.Queue(maxsize=64)
        # Rolling history of the last few events the engine has seen — used
        # as grounding context for the next call.
        self._recent_events: deque[CommentaryEvent] = deque(maxlen=8)
        # Rolling history of the model's last few calls — fed back so it
        # doesn't repeat phrases.
        self._recent_calls: deque[str] = deque(maxlen=4)

        self._last_trigger_at: float = 0.0
        self._task: asyncio.Task | None = None
        self._stopped = False
        # Monotonic id so the overlay can correlate text deltas with audio
        # chunks and clear stale streams when a new one starts.
        self._call_seq: int = 0

    @property
    def enabled(self) -> bool:
        return self._enabled

    def start(self) -> None:
        if not self._enabled or self._task is not None:
            return
        self._task = asyncio.create_task(self._run_loop())

    async def stop(self) -> None:
        self._stopped = True
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None
        if self._enabled:
            await self._http.aclose()

    def event(self, kind: str, payload: dict[str, Any] | None = None) -> None:
        """Non-blocking: enqueue a game event for possible commentary."""
        if not self._enabled or self._stopped:
            return
        evt = CommentaryEvent(
            kind=kind,
            payload=payload or {},
            priority=kind in _PRIORITY_EVENTS,
        )
        self._recent_events.append(evt)
        try:
            self._queue.put_nowait(evt)
        except asyncio.QueueFull:
            # Drop oldest, push newest — never block the game loop.
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            try:
                self._queue.put_nowait(evt)
            except asyncio.QueueFull:
                pass

    # -- internals --------------------------------------------------------

    async def _run_loop(self) -> None:
        while not self._stopped:
            try:
                evt = await self._queue.get()
            except asyncio.CancelledError:
                return

            now = time.time()
            cooldown_ok = (now - self._last_trigger_at) >= _TRIGGER_COOLDOWN
            if not (evt.priority or cooldown_ok):
                # Drop this one; the next priority/post-cooldown event will
                # carry the freshest snapshot of the match anyway.
                continue

            self._last_trigger_at = now
            self._call_seq += 1
            try:
                await self._stream_call(self._call_seq, evt)
            except Exception:
                log.exception("commentator: call %d failed", self._call_seq)

    async def _stream_call(self, call_id: int, trigger: CommentaryEvent) -> None:
        user_packet = self._build_user_packet(trigger)

        # Tell the overlay a new line is starting so it can clear the
        # previous subtitle and reset its audio queue.
        await self._safe_broadcast(
            f'{{"type":"commentary_start","id":{call_id}}}'
        )

        full_text_parts: list[str] = []
        sentence_buffer = ""
        sentence_idx = 0
        # Background tasks for TTS so synthesis runs in parallel with
        # continued token streaming. We await them at the end.
        tts_tasks: list[asyncio.Task] = []

        try:
            async with self._anthropic.messages.stream(
                model=CLAUDE_MODEL,
                max_tokens=120,
                system=[
                    {
                        "type": "text",
                        "text": SYSTEM_PROMPT,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=[{"role": "user", "content": user_packet}],
            ) as stream:
                async for delta in stream.text_stream:
                    if not delta:
                        continue
                    full_text_parts.append(delta)
                    sentence_buffer += delta

                    # Stream the text delta to the overlay character-by-character.
                    await self._safe_broadcast(
                        _commentary_text_msg(call_id, delta)
                    )

                    # Flush any complete sentences to TTS. The regex anchors
                    # at the start and consumes through terminal punctuation,
                    # so each match is one complete sentence we can ship.
                    while True:
                        m = _SENTENCE_RE.match(sentence_buffer)
                        if m is None:
                            break
                        sentence = m.group(0).strip()
                        sentence_buffer = sentence_buffer[m.end():]
                        if sentence:
                            tts_tasks.append(
                                asyncio.create_task(
                                    self._synthesize(call_id, sentence_idx, sentence)
                                )
                            )
                            sentence_idx += 1

                final_msg = await stream.get_final_message()
        except anthropic.APIError as exc:
            log.warning("commentator: anthropic API error: %s", exc)
            await self._safe_broadcast(
                f'{{"type":"commentary_end","id":{call_id}}}'
            )
            return

        # Flush any trailing partial sentence (no terminal punctuation).
        tail = sentence_buffer.strip()
        if tail:
            tts_tasks.append(
                asyncio.create_task(
                    self._synthesize(call_id, sentence_idx, tail)
                )
            )

        # Wait for in-flight TTS tasks to complete so the audio messages
        # land before the commentary_end marker.
        if tts_tasks:
            await asyncio.gather(*tts_tasks, return_exceptions=True)

        full_text = "".join(full_text_parts).strip()
        if full_text:
            self._recent_calls.append(full_text)

        await self._safe_broadcast(
            f'{{"type":"commentary_end","id":{call_id}}}'
        )

        usage = final_msg.usage
        log.info(
            "commentator: call=%d trigger=%s text=%r tokens=in:%d/out:%d cached:%d",
            call_id,
            trigger.kind,
            full_text[:80],
            usage.input_tokens,
            usage.output_tokens,
            getattr(usage, "cache_read_input_tokens", 0) or 0,
        )

    def _build_user_packet(self, trigger: CommentaryEvent) -> str:
        # Use a compact text format rather than JSON — easier for the model
        # to parse and more cache-stable across calls.
        recent_lines = "\n".join(
            f"  - {e.kind}: {_compact(e.payload)}" for e in list(self._recent_events)[-5:]
        ) or "  (none)"
        prior_calls = "\n".join(f"  - {c!r}" for c in self._recent_calls) or "  (none)"

        return (
            f"NOW: {trigger.kind} {_compact(trigger.payload)}\n\n"
            f"RECENT EVENTS:\n{recent_lines}\n\n"
            f"YOUR LAST FEW CALLS (do not repeat phrasing):\n{prior_calls}\n\n"
            "Call it."
        )

    async def _synthesize(self, call_id: int, sentence_idx: int, sentence: str) -> None:
        """POST sentence to ElevenLabs streaming TTS, broadcast mp3 base64."""
        if not self._elevenlabs_key:
            return
        url = (
            f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}/stream"
            "?optimize_streaming_latency=3&output_format=mp3_22050_32"
        )
        headers = {
            "xi-api-key": self._elevenlabs_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        }
        body = {
            "text": sentence,
            "model_id": ELEVENLABS_MODEL_ID,
            "voice_settings": {"stability": 0.4, "similarity_boost": 0.75, "style": 0.65},
        }
        try:
            resp = await self._http.post(url, headers=headers, json=body)
            resp.raise_for_status()
            audio_b64 = base64.b64encode(resp.content).decode("ascii")
        except Exception as exc:
            log.warning("commentator: elevenlabs synth failed: %s", exc)
            return

        # Hand-roll the JSON: audio_b64 is a clean ascii base64 string with
        # no characters needing escaping, so we skip the json module roundtrip.
        msg = (
            f'{{"type":"commentary_audio","id":{call_id},"idx":{sentence_idx},'
            f'"mime":"audio/mpeg","audio_b64":"{audio_b64}"}}'
        )
        await self._safe_broadcast(msg)

    async def _safe_broadcast(self, msg: str) -> None:
        try:
            await self._broadcast(msg)
        except Exception:
            log.exception("commentator: broadcast failed")


# -- helpers --------------------------------------------------------------

def _compact(payload: dict[str, Any]) -> str:
    if not payload:
        return ""
    return " ".join(f"{k}={v}" for k, v in payload.items())


def _commentary_text_msg(call_id: int, delta: str) -> str:
    # Escape minimally — only the chars JSON requires inside strings.
    safe = (
        delta.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )
    return f'{{"type":"commentary_text","id":{call_id},"delta":"{safe}"}}'
