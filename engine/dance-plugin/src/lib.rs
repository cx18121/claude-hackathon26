//! Dance scoring game plugin — implements the GamePlugin trait for a rhythm/beat-gated game.
//! Players score by matching target poses at each beat boundary. No bot logic, no HP tracking.
//! engine-core depends on this only at the DancePlugin::new construction site in main.rs.

use std::any::Any;
use plugin_trait::{GamePlugin, GameEvent, TickContext, PoseFrame, PoseKeypoint};
use serde_json::json;

mod poses;

/// Beat interval: 60 ticks = 1 second at 60 Hz (D-02).
const BEAT_INTERVAL: u64 = 60;
/// One round = 16 beats (D-02).
const TOTAL_BEATS: u64 = 16;

// ---------------------------------------------------------------------------
// Config and state
// ---------------------------------------------------------------------------

/// Construction-time config for a dance match.
pub struct DanceConfig {
    /// Wins required to win the match (passed to max_wins()).
    pub max_wins: u32,
}

/// Per-room mutable dance state stored as Box<dyn Any + Send>.
/// All fields are owned (no references) — required for 'static bound on Box<dyn Any + Send>.
pub struct DanceState {
    /// Cumulative cosine-similarity score per slot. Cleared on round reset.
    pub scores: [f64; 2],
    /// Index into POSE_LIBRARY for the next beat's target pose.
    pub target_index: usize,
    /// tick value when the round officially started. Captured on first on_tick call.
    /// Do NOT use 0 as the origin — tick counter may be in the hundreds by match start (Pitfall 1).
    pub round_start_tick: u64,
    /// False until the first on_tick call; set to true on first call to lock round_start_tick.
    pub round_started: bool,
    /// How many beats have been scored so far in this round (0..=16).
    pub beats_scored: u64,
    /// Set to true after RoundOver is emitted. Guards against emitting RoundOver every tick (Pitfall 3).
    pub round_ended: bool,
}

// ---------------------------------------------------------------------------
// Plugin struct
// ---------------------------------------------------------------------------

pub struct DancePlugin {
    config: DanceConfig,
}

impl DancePlugin {
    pub fn new(config: DanceConfig) -> Self {
        Self { config }
    }
}

// ---------------------------------------------------------------------------
// GamePlugin implementation
// ---------------------------------------------------------------------------

impl GamePlugin for DancePlugin {
    fn init_state(&self) -> Box<dyn Any + Send> {
        Box::new(DanceState {
            scores: [0.0; 2],
            target_index: 0,
            round_start_tick: 0,
            round_started: false,
            beats_scored: 0,
            round_ended: false,
        })
    }

    fn on_tick(&self, ctx: &TickContext, state: &mut dyn Any) -> Vec<GameEvent> {
        let s = state.downcast_mut::<DanceState>()
            .expect("dance plugin: state type mismatch");

        // Pitfall 3: guard against RoundOver being emitted every tick after round ends
        if s.round_ended { return vec![]; }

        let mut events = Vec::new();

        // Pitfall 1: lock round_start_tick on first tick (tick counter may be nonzero at round start)
        if !s.round_started {
            s.round_start_tick = ctx.tick_info.tick;
            s.round_started = true;
        }

        // Beat clock: how many ticks have elapsed since round start
        let elapsed_ticks = ctx.tick_info.tick.saturating_sub(s.round_start_tick);

        // Beat boundary: fires when elapsed_ticks is a nonzero multiple of BEAT_INTERVAL
        if elapsed_ticks > 0 && elapsed_ticks % BEAT_INTERVAL == 0
            && s.beats_scored < TOTAL_BEATS
        {
            // Score player poses at this beat boundary
            let target = &poses::POSE_LIBRARY[s.target_index % poses::POSE_LIBRARY.len()];

            for slot_idx in 0..2usize {
                // Solo mode: skip slot 1 scoring entirely (D-04)
                if ctx.room.solo_mode && slot_idx == 1 {
                    continue;
                }
                if let Some(frame) = ctx.frames[slot_idx].back() {
                    s.scores[slot_idx] += score_pose(frame, &target.keypoints);
                }
            }

            s.beats_scored += 1;
            s.target_index = (s.target_index + 1) % poses::POSE_LIBRARY.len();

            // Broadcast beat event with target pose so overlay can display it
            events.push(GameEvent::Broadcast {
                payload: json!({
                    "type": "dance_beat",
                    "beat": s.beats_scored,
                    "total_beats": TOTAL_BEATS,
                    "target_pose": target.keypoints.iter()
                        .map(|kp| [kp.x, kp.y, kp.z, kp.visibility])
                        .collect::<Vec<_>>(),
                }),
            });

            // Broadcast live scores so overlay can display cumulative scores
            events.push(GameEvent::Broadcast {
                payload: json!({
                    "type": "dance_score",
                    "beat": s.beats_scored,
                    "scores": [s.scores[0], s.scores[1]],
                }),
            });
        }

        // Round end check AFTER beat scoring — ensures beat 16 is scored before RoundOver
        if s.beats_scored >= TOTAL_BEATS {
            s.round_ended = true;
            let winner = if ctx.room.solo_mode {
                Some(1u8) // solo: player 1 always "wins" (scores alone)
            } else if s.scores[0] > s.scores[1] {
                Some(1)
            } else if s.scores[1] > s.scores[0] {
                Some(2)
            } else {
                None // draw
            };
            events.push(GameEvent::RoundOver { winner });
        }

        events
    }

    fn on_round_reset(&self, state: &mut dyn Any) {
        let s = state.downcast_mut::<DanceState>()
            .expect("dance plugin: state type mismatch");
        s.scores = [0.0; 2];
        s.beats_scored = 0;
        s.target_index = 0;
        s.round_started = false;
        s.round_ended = false;
        // round_start_tick is NOT reset — it will be re-captured on first on_tick call
        // via round_started = false (Pitfall 1 fix)
    }

    fn max_wins(&self) -> u32 {
        self.config.max_wins
    }

    // on_calibration_complete: intentional no-op (D-05). Using trait default.
    // on_player_join: using trait default no-op.
    // on_player_leave: using trait default no-op.
}

// ---------------------------------------------------------------------------
// Pose similarity scoring
// ---------------------------------------------------------------------------

/// Cosine similarity between a player's pose frame and a target pose.
///
/// Only uses X and Y (Z omitted — near-zero for 2D MediaPipe, RESEARCH.md Code Examples).
/// Skips landmarks with visibility < 0.5 (unreliable keypoints).
/// Returns 0.0 if fewer than 5 visible landmarks are found (not enough signal).
/// Returns result clamped to [0.0, 1.0].
fn score_pose(player_frame: &PoseFrame, target: &[PoseKeypoint]) -> f64 {
    if player_frame.keypoints.len() < target.len() {
        return 0.0;
    }
    let mut dot = 0.0_f64;
    let mut pm = 0.0_f64;
    let mut tm = 0.0_f64;
    let mut n = 0usize;

    for (p, t) in player_frame.keypoints.iter().zip(target.iter()) {
        if p.visibility < 0.5 {
            continue; // skip low-confidence landmarks
        }
        dot += p.x * t.x + p.y * t.y; // z omitted: near-zero for 2D MediaPipe
        pm += p.x * p.x + p.y * p.y;
        tm += t.x * t.x + t.y * t.y;
        n += 1;
    }

    if n < 5 || pm < 1e-9 || tm < 1e-9 {
        return 0.0; // not enough visible landmarks for a meaningful score
    }
    (dot / (pm.sqrt() * tm.sqrt())).clamp(0.0, 1.0)
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use plugin_trait::{TickContext, TickInfo, RoomView, SlotView, PoseFrame, PoseKeypoint};

    fn test_config() -> DanceConfig {
        DanceConfig { max_wins: 3 }
    }

    fn empty_frames() -> (VecDeque<PoseFrame>, VecDeque<PoseFrame>) {
        (VecDeque::new(), VecDeque::new())
    }

    fn make_ctx<'a>(
        tick: u64,
        frames0: &'a VecDeque<PoseFrame>,
        frames1: &'a VecDeque<PoseFrame>,
        solo: bool,
    ) -> TickContext<'a> {
        TickContext {
            frames: [frames0, frames1],
            tick_info: TickInfo {
                tick,
                elapsed_secs: 0.0,
                remaining_secs: 100.0,
            },
            room: RoomView {
                slots: [
                    SlotView { connected: true, reference_velocity: None },
                    SlotView { connected: !solo, reference_velocity: None },
                ],
                solo_mode: solo,
            },
        }
    }

    // Helper: build a PoseFrame with 33 keypoints using a mapping function
    fn make_frame<F>(f: F) -> PoseFrame
    where
        F: Fn(usize) -> PoseKeypoint,
    {
        PoseFrame {
            timestamp: 0.0,
            keypoints: (0..33).map(f).collect(),
        }
    }

    // -----------------------------------------------------------------------
    // beat_fires_at_tick_60
    // -----------------------------------------------------------------------
    #[test]
    fn beat_fires_at_tick_60() {
        let plugin = DancePlugin::new(test_config());
        let mut state = plugin.init_state();
        let (f0, f1) = empty_frames();

        // Tick 1: round starts, round_start_tick locked to 1, elapsed=0 — no beat
        let ctx1 = make_ctx(1, &f0, &f1, false);
        let events1 = plugin.on_tick(&ctx1, &mut *state);
        let has_beat1 = events1.iter().any(|e| {
            if let GameEvent::Broadcast { payload } = e {
                payload.get("type").and_then(|v| v.as_str()) == Some("dance_beat")
            } else {
                false
            }
        });
        assert!(!has_beat1, "tick 1 should not fire a beat (elapsed_ticks=0)");

        // Tick 61: elapsed_ticks = 61 - 1 = 60, which is 60 % 60 == 0 — beat fires
        let ctx61 = make_ctx(61, &f0, &f1, false);
        let events61 = plugin.on_tick(&ctx61, &mut *state);
        let beat_event = events61.iter().find(|e| {
            if let GameEvent::Broadcast { payload } = e {
                payload.get("type").and_then(|v| v.as_str()) == Some("dance_beat")
            } else {
                false
            }
        });
        assert!(beat_event.is_some(), "tick 61 (elapsed=60) should fire a dance_beat event");

        // Verify beat number is 1
        if let Some(GameEvent::Broadcast { payload }) = beat_event {
            assert_eq!(
                payload.get("beat").and_then(|v| v.as_u64()),
                Some(1),
                "first beat should be beat=1"
            );
        }
    }

    // -----------------------------------------------------------------------
    // beat_advances_target
    // -----------------------------------------------------------------------
    #[test]
    fn beat_advances_target() {
        let plugin = DancePlugin::new(test_config());
        let mut state = plugin.init_state();
        let (f0, f1) = empty_frames();

        // Lock round_start_tick at 1 by calling tick 1
        let ctx1 = make_ctx(1, &f0, &f1, false);
        plugin.on_tick(&ctx1, &mut *state);

        // Fire 6 beats (ticks 61, 121, 181, 241, 301, 361)
        for beat_num in 1u64..=6 {
            let tick = 1 + beat_num * BEAT_INTERVAL;
            let ctx = make_ctx(tick, &f0, &f1, false);
            plugin.on_tick(&ctx, &mut *state);
        }

        // After 6 beats, target_index should be back to 0 (6 % 6 == 0)
        let s = state.downcast_ref::<DanceState>().unwrap();
        assert_eq!(s.target_index, 0, "after 6 beats target_index should cycle back to 0");
        assert_eq!(s.beats_scored, 6);
    }

    // -----------------------------------------------------------------------
    // round_over_fires_after_16_beats
    // -----------------------------------------------------------------------
    #[test]
    fn round_over_fires_after_16_beats() {
        let plugin = DancePlugin::new(test_config());
        let mut state = plugin.init_state();
        let (f0, f1) = empty_frames();

        let mut found_round_over = false;

        // Simulate ticks 1..=961 (round start at 1, beat 16 fires at elapsed=960, tick=961)
        for tick in 1u64..=961 {
            let ctx = make_ctx(tick, &f0, &f1, false);
            let events = plugin.on_tick(&ctx, &mut *state);
            if events.iter().any(|e| matches!(e, GameEvent::RoundOver { .. })) {
                found_round_over = true;
            }
        }

        assert!(found_round_over, "RoundOver must fire after 16 beats");

        let s = state.downcast_ref::<DanceState>().unwrap();
        assert_eq!(s.beats_scored, 16, "beats_scored must be 16 at round end");
        assert!(s.round_ended, "round_ended flag must be true");
    }

    // -----------------------------------------------------------------------
    // round_ended_guard
    // -----------------------------------------------------------------------
    #[test]
    fn round_ended_guard() {
        let plugin = DancePlugin::new(test_config());
        let mut state = plugin.init_state();
        let (f0, f1) = empty_frames();

        // Run 16 beats
        for tick in 1u64..=961 {
            let ctx = make_ctx(tick, &f0, &f1, false);
            plugin.on_tick(&ctx, &mut *state);
        }

        // After round ended, next tick should return empty vec
        let ctx_after = make_ctx(962, &f0, &f1, false);
        let events_after = plugin.on_tick(&ctx_after, &mut *state);
        assert!(
            events_after.is_empty(),
            "after round_ended=true, on_tick must return empty vec (round_ended guard)"
        );
    }

    // -----------------------------------------------------------------------
    // on_round_reset_clears_state
    // -----------------------------------------------------------------------
    #[test]
    fn on_round_reset_clears_state() {
        let plugin = DancePlugin::new(test_config());
        let mut state = plugin.init_state();
        let (f0, f1) = empty_frames();

        // Run 16 beats to accumulate scores and set flags
        for tick in 1u64..=961 {
            let ctx = make_ctx(tick, &f0, &f1, false);
            plugin.on_tick(&ctx, &mut *state);
        }

        // Verify state was set
        {
            let s = state.downcast_ref::<DanceState>().unwrap();
            assert!(s.round_ended);
            assert_eq!(s.beats_scored, 16);
        }

        // Reset
        plugin.on_round_reset(&mut *state);

        let s = state.downcast_ref::<DanceState>().unwrap();
        assert_eq!(s.scores, [0.0, 0.0], "scores must be cleared");
        assert_eq!(s.beats_scored, 0, "beats_scored must be 0");
        assert_eq!(s.target_index, 0, "target_index must be 0");
        assert!(!s.round_started, "round_started must be false");
        assert!(!s.round_ended, "round_ended must be false");
    }

    // -----------------------------------------------------------------------
    // solo_mode_scores_only_slot0
    // -----------------------------------------------------------------------
    #[test]
    fn solo_mode_scores_only_slot0() {
        let plugin = DancePlugin::new(test_config());
        let mut state = plugin.init_state();

        // Create a pose frame that matches ARMS_UP for slot 0
        let arms_up_frame = make_frame(|i| PoseKeypoint {
            x: poses::ARMS_UP.keypoints[i].x,
            y: poses::ARMS_UP.keypoints[i].y,
            z: 0.0,
            visibility: 1.0,
        });

        let mut f0: VecDeque<PoseFrame> = VecDeque::new();
        f0.push_back(arms_up_frame);
        let f1: VecDeque<PoseFrame> = VecDeque::new();

        // Lock round start
        let ctx1 = make_ctx(1, &f0, &f1, true); // solo=true
        plugin.on_tick(&ctx1, &mut *state);

        // Fire one beat
        let ctx61 = make_ctx(61, &f0, &f1, true);
        plugin.on_tick(&ctx61, &mut *state);

        let s = state.downcast_ref::<DanceState>().unwrap();
        assert!(s.scores[0] > 0.0, "slot 0 should have a positive score in solo mode");
        assert_eq!(s.scores[1], 0.0, "slot 1 should stay at 0.0 in solo mode");
    }

    // -----------------------------------------------------------------------
    // calibration_noop
    // -----------------------------------------------------------------------
    #[test]
    fn calibration_noop() {
        let plugin = DancePlugin::new(test_config());
        let mut state = plugin.init_state();

        // on_calibration_complete should be a no-op (D-05) — uses trait default
        plugin.on_calibration_complete(0, 5.0, &mut *state);
        plugin.on_calibration_complete(1, 3.0, &mut *state);

        let s = state.downcast_ref::<DanceState>().unwrap();
        // State should be unchanged from init
        assert_eq!(s.scores, [0.0, 0.0]);
        assert!(!s.round_started);
        assert_eq!(s.beats_scored, 0);
    }

    // -----------------------------------------------------------------------
    // score_pose_returns_zero_for_invisible
    // -----------------------------------------------------------------------
    #[test]
    fn score_pose_returns_zero_for_invisible() {
        let frame = make_frame(|_| PoseKeypoint {
            x: 0.5,
            y: 0.5,
            z: 0.0,
            visibility: 0.0, // all invisible
        });

        let target = poses::ARMS_UP.keypoints.as_ref();
        let result = score_pose(&frame, target);
        assert_eq!(result, 0.0, "all-invisible frame should score 0.0");
    }

    // -----------------------------------------------------------------------
    // score_pose_returns_one_for_identical
    // -----------------------------------------------------------------------
    #[test]
    fn score_pose_returns_one_for_identical() {
        // Frame identical to ARMS_UP target
        let frame = make_frame(|i| PoseKeypoint {
            x: poses::ARMS_UP.keypoints[i].x,
            y: poses::ARMS_UP.keypoints[i].y,
            z: 0.0,
            visibility: 1.0,
        });

        let target = poses::ARMS_UP.keypoints.as_ref();
        let result = score_pose(&frame, target);
        assert!(
            result > 0.9,
            "identical frame should score close to 1.0, got {}",
            result
        );
    }
}
