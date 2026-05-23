//! Bot mode for solo play (BOX-10, D-04).
//! Engine has no concept of a bot. When slot 2 is unoccupied (RoomView.slots[1].connected == false),
//! the boxing plugin fabricates Hit events at difficulty-tuned random intervals.
//! Source: server/game_loop.py lines 31-256.

use rand::Rng;
use plugin_trait::{PoseKeypoint, BodyRegion, GameEvent};
use serde_json::json;

/// Three selectable difficulty tiers. Stored in BoxingConfig (D-06).
#[derive(Clone, Copy, Debug)]
pub enum Difficulty { Easy, Normal, Hard }

/// Hit timer interval range (seconds) per difficulty.
/// Source: server/game_loop.py line 31 _BOT_INTERVALS.
fn bot_interval(d: Difficulty) -> (f64, f64) {
    match d {
        Difficulty::Easy   => (4.5, 7.0),
        Difficulty::Normal => (2.5, 4.5),
        Difficulty::Hard   => (1.0, 2.5),
    }
}

/// Damage range per difficulty.
/// Source: server/game_loop.py line 36 _BOT_DAMAGES.
fn bot_damage_range(d: Difficulty) -> (u32, u32) {
    match d {
        Difficulty::Easy   => (15, 35),
        Difficulty::Normal => (30, 55),
        Difficulty::Hard   => (50, 80),
    }
}

/// Region distribution for bot hits.
/// Source: server/game_loop.py line 41 _BOT_REGIONS.
const BOT_REGIONS: [BodyRegion; 6] = [
    BodyRegion::TorsoLower, BodyRegion::TorsoLower,
    BodyRegion::TorsoUpper, BodyRegion::TorsoUpper,
    BodyRegion::HeadFace,   BodyRegion::TorsoLower,
];

/// Static neutral standing pose for P2 bot slot.
/// All 33 MediaPipe landmarks. Raw coordinates (engine normalizes for TickContext).
/// Source: server/game_loop.py lines 49-83 _BOT_KPS.
pub const BOT_KPS: [PoseKeypoint; 33] = [
    PoseKeypoint { x: 0.50, y: 0.10, z: 0.0, visibility: 1.0 }, // 0  nose
    PoseKeypoint { x: 0.52, y: 0.08, z: 0.0, visibility: 1.0 }, // 1  left_eye_inner
    PoseKeypoint { x: 0.53, y: 0.08, z: 0.0, visibility: 1.0 }, // 2  left_eye
    PoseKeypoint { x: 0.55, y: 0.08, z: 0.0, visibility: 1.0 }, // 3  left_eye_outer
    PoseKeypoint { x: 0.48, y: 0.08, z: 0.0, visibility: 1.0 }, // 4  right_eye_inner
    PoseKeypoint { x: 0.47, y: 0.08, z: 0.0, visibility: 1.0 }, // 5  right_eye
    PoseKeypoint { x: 0.45, y: 0.08, z: 0.0, visibility: 1.0 }, // 6  right_eye_outer
    PoseKeypoint { x: 0.57, y: 0.12, z: 0.0, visibility: 1.0 }, // 7  left_ear
    PoseKeypoint { x: 0.43, y: 0.12, z: 0.0, visibility: 1.0 }, // 8  right_ear
    PoseKeypoint { x: 0.52, y: 0.15, z: 0.0, visibility: 1.0 }, // 9  mouth_left
    PoseKeypoint { x: 0.48, y: 0.15, z: 0.0, visibility: 1.0 }, // 10 mouth_right
    PoseKeypoint { x: 0.62, y: 0.30, z: 0.0, visibility: 1.0 }, // 11 left_shoulder
    PoseKeypoint { x: 0.38, y: 0.30, z: 0.0, visibility: 1.0 }, // 12 right_shoulder
    PoseKeypoint { x: 0.65, y: 0.46, z: 0.0, visibility: 1.0 }, // 13 left_elbow
    PoseKeypoint { x: 0.35, y: 0.46, z: 0.0, visibility: 1.0 }, // 14 right_elbow
    PoseKeypoint { x: 0.67, y: 0.62, z: 0.0, visibility: 1.0 }, // 15 left_wrist
    PoseKeypoint { x: 0.33, y: 0.62, z: 0.0, visibility: 1.0 }, // 16 right_wrist
    PoseKeypoint { x: 0.67, y: 0.64, z: 0.0, visibility: 1.0 }, // 17 left_pinky
    PoseKeypoint { x: 0.33, y: 0.64, z: 0.0, visibility: 1.0 }, // 18 right_pinky
    PoseKeypoint { x: 0.68, y: 0.63, z: 0.0, visibility: 1.0 }, // 19 left_index
    PoseKeypoint { x: 0.32, y: 0.63, z: 0.0, visibility: 1.0 }, // 20 right_index
    PoseKeypoint { x: 0.67, y: 0.63, z: 0.0, visibility: 1.0 }, // 21 left_thumb
    PoseKeypoint { x: 0.33, y: 0.63, z: 0.0, visibility: 1.0 }, // 22 right_thumb
    PoseKeypoint { x: 0.59, y: 0.60, z: 0.0, visibility: 1.0 }, // 23 left_hip
    PoseKeypoint { x: 0.41, y: 0.60, z: 0.0, visibility: 1.0 }, // 24 right_hip
    PoseKeypoint { x: 0.60, y: 0.75, z: 0.0, visibility: 1.0 }, // 25 left_knee
    PoseKeypoint { x: 0.40, y: 0.75, z: 0.0, visibility: 1.0 }, // 26 right_knee
    PoseKeypoint { x: 0.60, y: 0.90, z: 0.0, visibility: 1.0 }, // 27 left_ankle
    PoseKeypoint { x: 0.40, y: 0.90, z: 0.0, visibility: 1.0 }, // 28 right_ankle
    PoseKeypoint { x: 0.60, y: 0.93, z: 0.0, visibility: 1.0 }, // 29 left_heel
    PoseKeypoint { x: 0.40, y: 0.93, z: 0.0, visibility: 1.0 }, // 30 right_heel
    PoseKeypoint { x: 0.61, y: 0.95, z: 0.0, visibility: 1.0 }, // 31 left_foot_index
    PoseKeypoint { x: 0.39, y: 0.95, z: 0.0, visibility: 1.0 }, // 32 right_foot_index
];

/// Generate bot hit events if the scripted timer has elapsed.
/// Bot is "attacker=2 (slot 2), defender=1 (slot 1)".
/// Source: server/game_loop.py lines 231-256 _tick_bot.
pub fn tick_bot(
    difficulty: Difficulty,
    bot_next_hit_at: &mut f64,
    elapsed_secs: f64,
) -> Vec<GameEvent> {
    if elapsed_secs < *bot_next_hit_at {
        return vec![];
    }
    let mut rng = rand::thread_rng();
    let (lo, hi) = bot_interval(difficulty);
    *bot_next_hit_at = elapsed_secs + rng.gen_range(lo..hi);

    let (dmg_lo, dmg_hi) = bot_damage_range(difficulty);
    let dmg = rng.gen_range(dmg_lo..=dmg_hi);
    let region_idx = rng.gen_range(0..BOT_REGIONS.len());
    let region = BOT_REGIONS[region_idx].clone();

    vec![
        GameEvent::Hit {
            attacker: 2,
            defender: 1,
            region: region.clone(),
            damage: dmg as f32,
            position: [0.5, 0.4],
        },
        GameEvent::SendToPlayer {
            slot: 1,
            payload: json!({
                "type": "you_were_hit",
                "region": region.to_wire(), // CR-05: snake_case via to_wire()
                "damage": dmg
            }),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use plugin_trait::GameEvent;

    #[test]
    fn tick_bot_fires_when_timer_elapsed() {
        let mut next_hit_at = 0.0_f64;
        // elapsed > 0.0 so timer has already expired on first call
        let events = tick_bot(Difficulty::Normal, &mut next_hit_at, 1.0);
        assert_eq!(events.len(), 2, "should emit Hit + SendToPlayer");
        assert!(matches!(events[0], GameEvent::Hit { attacker: 2, defender: 1, .. }));
        assert!(matches!(events[1], GameEvent::SendToPlayer { slot: 1, .. }));
    }

    #[test]
    fn tick_bot_no_fire_before_timer() {
        let mut next_hit_at = 999.0_f64; // far in the future
        let events = tick_bot(Difficulty::Normal, &mut next_hit_at, 0.0);
        assert!(events.is_empty(), "should not fire before timer expires");
    }

    #[test]
    fn tick_bot_advances_timer_after_firing() {
        let mut next_hit_at = 0.0_f64;
        tick_bot(Difficulty::Normal, &mut next_hit_at, 5.0);
        // After firing at elapsed=5.0, next_hit_at must be > 5.0
        assert!(next_hit_at > 5.0, "timer must advance after firing, got {}", next_hit_at);
    }

    #[test]
    fn tick_bot_easy_damage_in_range() {
        let (lo, hi) = (15_f32, 35_f32);
        for _ in 0..50 {
            let mut next_hit_at = 0.0_f64;
            let events = tick_bot(Difficulty::Easy, &mut next_hit_at, 1.0);
            if let GameEvent::Hit { damage, .. } = events[0] {
                assert!(damage >= lo && damage <= hi, "Easy damage {} out of [{},{}]", damage, lo, hi);
            }
        }
    }

    #[test]
    fn tick_bot_hard_damage_in_range() {
        let (lo, hi) = (50_f32, 80_f32);
        for _ in 0..50 {
            let mut next_hit_at = 0.0_f64;
            let events = tick_bot(Difficulty::Hard, &mut next_hit_at, 1.0);
            if let GameEvent::Hit { damage, .. } = events[0] {
                assert!(damage >= lo && damage <= hi, "Hard damage {} out of [{},{}]", damage, lo, hi);
            }
        }
    }

    #[test]
    fn tick_bot_attacker_is_always_slot2() {
        for _ in 0..20 {
            let mut next_hit_at = 0.0_f64;
            let events = tick_bot(Difficulty::Normal, &mut next_hit_at, 1.0);
            if let GameEvent::Hit { attacker, defender, .. } = events[0] {
                assert_eq!(attacker, 2);
                assert_eq!(defender, 1);
            }
        }
    }
}

