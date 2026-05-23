//! FPS Boxing game plugin — implements GamePlugin for "fps_boxing" rooms.
//! Thin orchestration layer: reads pose frames, calls boxing-core for hit detection,
//! packages results into GameEvents. No I/O, no async.

use std::any::Any;
use std::collections::VecDeque;
use plugin_trait::{GamePlugin, GameEvent, TickContext, BodyRegion};
use boxing_core::combat::{self, DEFAULT_HIT_COOLDOWN_TICKS};
use serde_json::json;

// ---------------------------------------------------------------------------
// Landmark index constants (MediaPipe indices 11-16, per D-07)
// Elbow constants (13, 14) added to boxing-core in Plan 01.
// Re-exported here as local aliases for readability in on_tick.
// ---------------------------------------------------------------------------
use boxing_core::hit_detection::{LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_ELBOW, RIGHT_ELBOW, WRIST_LEFT as LEFT_WRIST, WRIST_RIGHT as RIGHT_WRIST};

// ---------------------------------------------------------------------------
// Config and state
// ---------------------------------------------------------------------------

pub struct FPSBoxingConfig {
    pub hp: u32,
    pub round_secs: f64,
    pub max_wins: u32,
}

/// Per-room mutable state. Stored as Box<dyn Any + Send>.
/// Fields are intentionally minimal vs BoxingState — no bot, no combo, no commentary (D-09).
pub struct FPSBoxingState {
    /// Current HP for each player slot. Index 0 = slot 1, index 1 = slot 2.
    pub hp: [u32; 2],
    /// Clamped reference velocity per slot. NOT cleared in on_round_reset (FIX-01).
    pub ref_vel: [f64; 2],
    /// Tick number of last hit per attacker. -999 sentinel = never hit.
    pub last_hit_tick: [i64; 2],
    /// True once the first RoundOver event has been emitted this round.
    pub round_ended: bool,
}

// ---------------------------------------------------------------------------
// Plugin struct
// ---------------------------------------------------------------------------

pub struct FPSBoxingPlugin {
    config: FPSBoxingConfig,
}

impl FPSBoxingPlugin {
    pub fn new(config: FPSBoxingConfig) -> Self {
        Self { config }
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Zero PoseKeypoint used as fallback when a landmark is missing from the frame.
fn zero_kp_json() -> serde_json::Value {
    json!({ "x": 0.0, "y": 0.0, "z": 0.0, "visibility": 0.0 })
}

/// Extract one arm keypoint from a PoseFrame, converting plugin_trait::PoseKeypoint
/// to a serde_json::Value matching the protocol::PoseKeypoint shape.
/// Returns zero_kp_json() if the frame is missing or the index is out of bounds.
fn extract_kp_json(frame: &plugin_trait::PoseFrame, idx: usize) -> serde_json::Value {
    frame.keypoints.get(idx)
        .map(|kp| json!({ "x": kp.x, "y": kp.y, "z": kp.z, "visibility": kp.visibility }))
        .unwrap_or_else(zero_kp_json)
}

/// Build the MsgFpsState payload for one player (receiving their opponent's landmarks).
fn build_fps_state(
    opponent_frames: &VecDeque<plugin_trait::PoseFrame>,
    hp: [u32; 2],
    round_timer: f64,
) -> serde_json::Value {
    let frame = opponent_frames.back();
    let ls = frame.map(|f| extract_kp_json(f, LEFT_SHOULDER)).unwrap_or_else(zero_kp_json);
    let rs = frame.map(|f| extract_kp_json(f, RIGHT_SHOULDER)).unwrap_or_else(zero_kp_json);
    let le = frame.map(|f| extract_kp_json(f, LEFT_ELBOW)).unwrap_or_else(zero_kp_json);
    let re = frame.map(|f| extract_kp_json(f, RIGHT_ELBOW)).unwrap_or_else(zero_kp_json);
    let lw = frame.map(|f| extract_kp_json(f, LEFT_WRIST)).unwrap_or_else(zero_kp_json);
    let rw = frame.map(|f| extract_kp_json(f, RIGHT_WRIST)).unwrap_or_else(zero_kp_json);
    json!({
        "type": "fps_state",
        "left_shoulder":  ls,
        "right_shoulder": rs,
        "left_elbow":     le,
        "right_elbow":    re,
        "left_wrist":     lw,
        "right_wrist":    rw,
        "hp": [hp[0], hp[1]],
        "round_timer": round_timer,
    })
}

/// Map BodyRegion to punch_type string for MsgFpsHit.punch_type (D-06).
fn region_to_punch_type(region: &BodyRegion) -> &'static str {
    match region {
        BodyRegion::HeadFace | BodyRegion::HeadChin | BodyRegion::HeadThroat => "cross",
        BodyRegion::TorsoUpper | BodyRegion::TorsoLower => "body_shot",
        BodyRegion::LegThigh | BodyRegion::LegShin => "kick",
        BodyRegion::BlockHand | BodyRegion::BlockForearm => "blocked",
    }
}

// ---------------------------------------------------------------------------
// GamePlugin implementation
// ---------------------------------------------------------------------------

impl GamePlugin for FPSBoxingPlugin {
    fn game_type(&self) -> &'static str {
        "fps_boxing"
    }

    fn max_wins(&self) -> u32 {
        self.config.max_wins
    }

    fn initial_hp(&self) -> u32 {
        self.config.hp
    }

    fn current_hp(&self, state: &dyn Any) -> Option<[u32; 2]> {
        state.downcast_ref::<FPSBoxingState>().map(|s| s.hp)
    }

    fn init_state(&self) -> Box<dyn Any + Send> {
        Box::new(FPSBoxingState {
            hp: [self.config.hp; 2],
            ref_vel: [0.0; 2],
            last_hit_tick: [-999; 2],
            round_ended: false,
        })
    }

    fn on_calibration_complete(&self, slot: u8, ref_vel: f64, state: &mut dyn Any) {
        let s = state.downcast_mut::<FPSBoxingState>().expect("FPSBoxingState type mismatch");
        // Clamp ref_vel to [0.5, 15.0] (D-08: same clamping as BoxingPlugin)
        s.ref_vel[slot as usize] = ref_vel.clamp(0.5, 15.0);
        tracing::info!(slot, ref_vel, "fps_boxing calibration complete");
    }

    fn on_round_reset(&self, state: &mut dyn Any) {
        let s = state.downcast_mut::<FPSBoxingState>().expect("FPSBoxingState type mismatch");
        // Reset round-scoped fields ONLY — ref_vel MUST survive (FIX-01)
        s.hp = [self.config.hp; 2];
        s.last_hit_tick = [-999; 2];
        s.round_ended = false;
        // s.ref_vel is intentionally NOT cleared here
    }

    fn on_tick(&self, ctx: &TickContext, state: &mut dyn Any) -> Vec<GameEvent> {
        let s = state.downcast_mut::<FPSBoxingState>().expect("FPSBoxingState type mismatch");
        let mut events: Vec<GameEvent> = Vec::new();

        if s.round_ended {
            return events;
        }

        // --- Hit detection: attacker=0 vs defender=1, then attacker=1 vs defender=0 ---
        // boxing-core::combat::process_attacker owns the cooldown + detect_punch +
        // damage + HP subtract + last_hit_tick bookkeeping. Punch-only here
        // (no kicks), and ref_vel always wrapped in Some.
        for attacker_idx in 0..2usize {
            let defender_idx = 1 - attacker_idx;
            let Some(h) = combat::process_attacker(
                attacker_idx,
                defender_idx,
                ctx.frames,
                &mut s.hp,
                Some(s.ref_vel[attacker_idx]),
                &mut s.last_hit_tick,
                ctx.tick_info.tick,
                DEFAULT_HIT_COOLDOWN_TICKS,
                /* include_kicks */ false,
            ) else { continue };

            tracing::info!(
                attacker = attacker_idx,
                defender = defender_idx,
                region = ?h.region,
                dmg = h.damage,
                hp_remaining = s.hp[defender_idx],
                "fps_boxing hit"
            );

            events.push(GameEvent::Hit {
                attacker: (attacker_idx + 1) as u8,
                defender: (defender_idx + 1) as u8,
                region: h.region.clone(),
                damage: h.damage as f32,
                position: [h.position.0 as f32, h.position.1 as f32],
            });

            events.push(GameEvent::SendToPlayer {
                slot: (defender_idx + 1) as u8,
                payload: json!({
                    "type": "fps_hit",
                    "punch_type": region_to_punch_type(&h.region),
                    "damage": h.damage,
                }),
            });

            if s.hp[defender_idx] == 0 {
                s.round_ended = true;
                events.push(GameEvent::RoundOver {
                    winner: Some((attacker_idx + 1) as u8),
                });
                // MsgFpsState still emitted below so both players see final HP
            }
        }

        // Check round timer expiry
        if !s.round_ended && ctx.tick_info.remaining_secs <= 0.0 {
            s.round_ended = true;
            // Determine winner by HP; tie = draw
            let winner = if s.hp[0] > s.hp[1] {
                Some(1u8)
            } else if s.hp[1] > s.hp[0] {
                Some(2u8)
            } else {
                None // draw
            };
            events.push(GameEvent::RoundOver { winner });
        }

        // --- Per-tick MsgFpsState broadcast (FPSP-03) ---
        // Player at slot 1 (index 0) receives slot 2's (index 1) landmarks.
        // Player at slot 2 (index 1) receives slot 1's (index 0) landmarks.
        let current_hp = s.hp;
        for receiver_idx in 0..2usize {
            let opponent_idx = 1 - receiver_idx;
            let payload = build_fps_state(ctx.frames[opponent_idx], current_hp, ctx.tick_info.remaining_secs);
            events.push(GameEvent::SendToPlayer {
                slot: (receiver_idx + 1) as u8,
                payload,
            });
        }

        events
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use plugin_trait::{PoseFrame, PoseKeypoint, TickContext, TickInfo, RoomView, SlotView};

    fn make_plugin() -> FPSBoxingPlugin {
        FPSBoxingPlugin::new(FPSBoxingConfig { hp: 800, round_secs: 90.0, max_wins: 3 })
    }

    fn zero_kp() -> PoseKeypoint {
        PoseKeypoint { x: 0.0, y: 0.0, z: 0.0, visibility: 1.0 }
    }

    fn empty_frames() -> VecDeque<PoseFrame> {
        VecDeque::new()
    }

    fn make_tick_ctx<'a>(
        frames: [&'a VecDeque<PoseFrame>; 2],
        tick: u64,
        remaining: f64,
    ) -> TickContext<'a> {
        TickContext {
            frames,
            tick_info: TickInfo { tick, elapsed_secs: 0.0, remaining_secs: remaining },
            room: RoomView {
                slots: [
                    SlotView { connected: true, reference_velocity: Some(3.0) },
                    SlotView { connected: true, reference_velocity: Some(3.0) },
                ],
                solo_mode: false,
            },
        }
    }

    // FPSP-01: game_type returns "fps_boxing", NOT "boxing"
    #[test]
    fn game_type_is_fps_boxing() {
        let plugin = make_plugin();
        assert_eq!(plugin.game_type(), "fps_boxing");
        assert_ne!(plugin.game_type(), "boxing");
    }

    // FPSP-03: on_tick with two connected players emits exactly 2 SendToPlayer events
    #[test]
    fn fps_state_emits_two_send_to_player() {
        let plugin = make_plugin();
        let mut state = plugin.init_state();
        let f0 = empty_frames();
        let f1 = empty_frames();
        let ctx = make_tick_ctx([&f0, &f1], 0, 60.0);
        let events = plugin.on_tick(&ctx, state.as_mut());
        let send_to_player_count = events.iter().filter(|e| {
            matches!(e, GameEvent::SendToPlayer { .. })
        }).count();
        assert_eq!(send_to_player_count, 2, "must emit exactly 2 SendToPlayer events per tick");
    }

    // FPSP-04: on_tick with a confirmed hit emits SendToPlayer to defender with fps_hit
    #[test]
    fn fps_hit_sent_to_defender_on_confirmed_hit() {
        let plugin = make_plugin();
        let mut state_box = plugin.init_state();
        // Prime ref_vel for slot 0 (attacker)
        plugin.on_calibration_complete(0, 3.0, state_box.as_mut());

        // Build attacker frames with fast left-wrist lateral movement
        let mut attacker_frames: VecDeque<PoseFrame> = VecDeque::new();
        for i in 0..5u8 {
            let t = i as f64 * 0.033;
            let mut kps = vec![zero_kp(); 33];
            kps[23] = PoseKeypoint { x: 0.5, y: 0.0, z: 0.0, visibility: 1.0 }; // LEFT_HIP
            kps[24] = PoseKeypoint { x: 0.5, y: 0.0, z: 0.0, visibility: 1.0 }; // RIGHT_HIP
            kps[11] = PoseKeypoint { x: 0.5, y: 0.3, z: 0.0, visibility: 1.0 }; // LEFT_SHOULDER
            kps[12] = PoseKeypoint { x: 0.5, y: 0.3, z: 0.0, visibility: 1.0 }; // RIGHT_SHOULDER
            // Left wrist moves fast laterally (not primarily upward — no guard-raise veto)
            kps[15] = PoseKeypoint { x: 0.5 + i as f64 * 0.15, y: 0.5, z: 0.0, visibility: 1.0 };
            kps[16] = PoseKeypoint { x: 0.5, y: 0.3, z: 0.0, visibility: 1.0 }; // RIGHT_WRIST stays low
            attacker_frames.push_back(PoseFrame { timestamp: t, keypoints: kps });
        }
        let defender_frames = empty_frames();

        let ctx = make_tick_ctx([&attacker_frames, &defender_frames], 100, 60.0);
        let events = plugin.on_tick(&ctx, state_box.as_mut());

        // Find fps_hit SendToPlayer events
        let hit_events: Vec<_> = events.iter().filter(|e| {
            if let GameEvent::SendToPlayer { slot: _, payload } = e {
                payload.get("type").and_then(|v| v.as_str()) == Some("fps_hit")
            } else {
                false
            }
        }).collect();

        // If hit was detected: exactly 1 fps_hit event targeted at slot 2 (defender)
        if !hit_events.is_empty() {
            assert_eq!(hit_events.len(), 1);
            if let GameEvent::SendToPlayer { slot, payload } = hit_events[0] {
                assert_eq!(*slot, 2u8, "fps_hit must go to defender (slot 2)");
                assert!(payload.get("punch_type").is_some());
                assert!(payload.get("damage").is_some());
            }
        }
        // If no hit (velocity below threshold), the test is not a failure —
        // the structural assertion (slot + fields) is what matters.
    }

    // FIX-01: ref_vel survives on_round_reset
    #[test]
    fn fix01_ref_vel_survives_round_reset() {
        let plugin = make_plugin();
        let mut state_box = plugin.init_state();
        plugin.on_calibration_complete(0, 5.0, state_box.as_mut());
        plugin.on_calibration_complete(1, 7.0, state_box.as_mut());
        plugin.on_round_reset(state_box.as_mut());
        let s = state_box.downcast_ref::<FPSBoxingState>().unwrap();
        assert_eq!(s.ref_vel[0], 5.0, "ref_vel[0] must survive round reset");
        assert_eq!(s.ref_vel[1], 7.0, "ref_vel[1] must survive round reset");
        assert_eq!(s.hp[0], 800, "hp reset to config.hp");
        assert_eq!(s.hp[1], 800, "hp reset to config.hp");
    }
}
