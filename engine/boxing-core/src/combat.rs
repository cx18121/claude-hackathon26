//! Combat harness shared by `boxing-plugin` and `fps-boxing-plugin`.
//!
//! Both plugins ran an identical attacker→defender pass with these steps:
//!   1. Cooldown gate     (12 ticks = 200ms at 60Hz)
//!   2. detect_punch     (+ optional detect_kick for boxing)
//!   3. compute_damage
//!   4. saturating_sub on defender HP
//!   5. record `last_hit_tick`
//!
//! `process_attacker` does exactly that and returns the landed hit. Each
//! plugin then translates the returned [`LandedHit`] into its own
//! plugin-specific events (boxing emits commentary + you_were_hit;
//! fps-boxing emits an MsgFpsHit payload).

use std::collections::VecDeque;
use plugin_trait::{BodyRegion, PoseFrame};
use crate::{hit_detection, damage};

/// Default hit cooldown: 12 ticks = 200ms at 60Hz.
/// Source: server/game_loop.py line 22 `_HIT_COOLDOWN_TICKS = 12`.
pub const DEFAULT_HIT_COOLDOWN_TICKS: i64 = 12;

/// Outcome of one successful attacker pass — the hit metadata plus the
/// damage that was just applied to defender HP.
#[derive(Debug, Clone)]
pub struct LandedHit {
    pub region: BodyRegion,
    pub velocity: f64,
    pub position: (f64, f64),
    pub damage: u32,
}

/// Run one attacker→defender hit-detection pass.
///
/// Mutates:
///   - `hp[defender_idx]` (saturating_sub by computed damage on hit)
///   - `last_hit_tick[attacker_idx]` (set to `current_tick` on hit)
///
/// Returns `None` if the cooldown gate is still active or no hit was
/// detected. Returns `Some(LandedHit)` after damage has been applied; the
/// caller is responsible for emitting any plugin-specific events.
pub fn process_attacker(
    attacker_idx: usize,
    defender_idx: usize,
    frames: [&VecDeque<PoseFrame>; 2],
    hp: &mut [u32; 2],
    ref_vel: Option<f64>,
    last_hit_tick: &mut [i64; 2],
    current_tick: u64,
    cooldown_ticks: i64,
    include_kicks: bool,
) -> Option<LandedHit> {
    if (current_tick as i64) - last_hit_tick[attacker_idx] < cooldown_ticks {
        return None;
    }
    let hit = if include_kicks {
        hit_detection::detect_punch(frames[attacker_idx], frames[defender_idx], ref_vel)
            .or_else(|| hit_detection::detect_kick(frames[attacker_idx], frames[defender_idx], ref_vel))
    } else {
        hit_detection::detect_punch(frames[attacker_idx], frames[defender_idx], ref_vel)
    };
    let h = hit?;
    let dmg = damage::compute_damage(h.region.clone(), h.velocity, ref_vel);
    hp[defender_idx] = hp[defender_idx].saturating_sub(dmg);
    last_hit_tick[attacker_idx] = current_tick as i64;
    Some(LandedHit {
        region: h.region,
        velocity: h.velocity,
        position: h.position,
        damage: dmg,
    })
}
