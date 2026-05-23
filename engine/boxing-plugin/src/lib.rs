//! Boxing game plugin — implements the GamePlugin trait for the boxing game.
//! This crate is the only place that contains boxing domain knowledge.
//! engine-core depends on this only at the BoxingPlugin::new construction site in main.rs.

use std::any::Any;
#[cfg(test)]
use std::collections::VecDeque;
use plugin_trait::{GamePlugin, GameEvent, TickContext, BodyRegion};
use serde_json::json;

use boxing_core::hit_detection;
use boxing_core::damage;
mod bot;

pub use bot::Difficulty;

/// Hit cooldown: 12 ticks = 200ms at 60Hz.
/// Source: server/game_loop.py line 22 _HIT_COOLDOWN_TICKS = 12.
const HIT_COOLDOWN_TICKS: i64 = 12;

// ---------------------------------------------------------------------------
// Config and state
// ---------------------------------------------------------------------------

/// Construction-time config for a boxing match.
/// Passed to BoxingPlugin::new in engine-core/main.rs (D-05, D-06).
pub struct BoxingConfig {
    /// Starting HP per player (default 800).
    pub hp: u32,
    /// Round duration in seconds (default 90.0).
    pub round_secs: f64,
    /// Wins required to win the match (default 3).
    pub max_wins: u32,
    /// Bot difficulty when in solo mode (default Normal).
    pub bot_difficulty: Difficulty,
}

/// Per-room mutable boxing state stored as Box<dyn Any + Send>.
/// All fields are owned (no references) — required for 'static bound on Box<dyn Any + Send>.
pub struct BoxingState {
    /// Current HP for each player slot. Cleared to config.hp on round reset.
    pub hp: [u32; 2],
    /// Clamped reference velocity per slot. NOT cleared in on_round_reset (FIX-01).
    /// Set by on_calibration_complete; survives the full room lifetime.
    pub ref_vel: [f64; 2],
    /// Tick number of last hit per attacker. -999 sentinel = never hit.
    pub last_hit_tick: [i64; 2],
    /// (last_hit_time_secs, count) combo tracker per attacker.
    pub combo: [(f64, u32); 2],
    /// Whether low_hp commentary has been announced for each player this round.
    pub low_hp_announced: [bool; 2],
    /// True until the first hit of the round lands.
    pub first_blood_pending: bool,
    /// Elapsed seconds when the bot should next fire a hit. 0.0 = fire immediately next tick.
    pub bot_next_hit_at: f64,
    /// True once the first RoundOver event has been emitted this round.
    /// Prevents redundant RoundOver broadcasts on every tick after a KO until on_round_reset.
    pub round_ended: bool,
}

// ---------------------------------------------------------------------------
// Plugin struct
// ---------------------------------------------------------------------------

pub struct BoxingPlugin {
    config: BoxingConfig,
}

impl BoxingPlugin {
    pub fn new(config: BoxingConfig) -> Self {
        Self { config }
    }
}

// ---------------------------------------------------------------------------
// GamePlugin implementation
// ---------------------------------------------------------------------------

impl GamePlugin for BoxingPlugin {
    fn init_state(&self) -> Box<dyn Any + Send> {
        Box::new(BoxingState {
            hp: [self.config.hp; 2],
            ref_vel: [0.0; 2],
            last_hit_tick: [-999; 2],
            combo: [(0.0, 0); 2],
            low_hp_announced: [false; 2],
            first_blood_pending: true,
            bot_next_hit_at: 2.0,
            round_ended: false,
        })
    }

    fn on_tick(&self, ctx: &TickContext, state: &mut dyn Any) -> Vec<GameEvent> {
        let s = state.downcast_mut::<BoxingState>()
            .expect("boxing plugin: state type mismatch — expected BoxingState");

        let mut events: Vec<GameEvent> = Vec::new();

        // --- Bot mode (D-04, BOX-10) ---
        // WR-01: use stable solo_mode from RoomView (set once at match start, not re-derived per tick)
        let solo_mode = ctx.room.solo_mode;
        if solo_mode {
            let mut bot_events = bot::tick_bot(
                self.config.bot_difficulty,
                &mut s.bot_next_hit_at,
                ctx.tick_info.elapsed_secs,
            );
            // Bot events include Hit and SendToPlayer; apply HP damage from bot Hit
            for ev in &bot_events {
                if let GameEvent::Hit { defender, damage, .. } = ev {
                    let idx = (defender - 1) as usize;
                    if idx < 2 {
                        s.hp[idx] = s.hp[idx].saturating_sub(*damage as u32);
                    }
                }
            }
            events.append(&mut bot_events);
        }

        // --- Hit detection for human attackers (BOX-01..04, BOX-05, BOX-07) ---
        for (attacker_idx, defender_idx) in [(0usize, 1usize), (1, 0)] {
            // BOX-07: 12-tick hit cooldown per attacker
            if (ctx.tick_info.tick as i64) - s.last_hit_tick[attacker_idx] < HIT_COOLDOWN_TICKS {
                continue;
            }

            let ref_vel = if s.ref_vel[attacker_idx] > 0.0 {
                Some(s.ref_vel[attacker_idx])
            } else {
                None
            };

            // In bot mode, slot 2 frames are empty; skip attacker_idx=1 in solo mode
            if solo_mode && attacker_idx == 1 {
                continue;
            }

            let hit = hit_detection::detect_punch(
                ctx.frames[attacker_idx],
                ctx.frames[defender_idx],
                ref_vel,
            ).or_else(|| hit_detection::detect_kick(
                ctx.frames[attacker_idx],
                ctx.frames[defender_idx],
                ref_vel,
            ));

            if let Some(h) = hit {
                let dmg = damage::compute_damage(h.region.clone(), h.velocity, ref_vel);
                s.hp[defender_idx] = s.hp[defender_idx].saturating_sub(dmg);
                s.last_hit_tick[attacker_idx] = ctx.tick_info.tick as i64;

                // Commentary hint (emitted; consumed by v2 commentary engine)
                emit_commentary_hint(&mut events, s, attacker_idx, defender_idx, &h.region, dmg, ctx.tick_info.elapsed_secs, self.config.hp);

                events.push(GameEvent::Hit {
                    attacker: (attacker_idx + 1) as u8,
                    defender: (defender_idx + 1) as u8,
                    region: h.region,
                    damage: dmg as f32,
                    position: [h.position.0 as f32, h.position.1 as f32],
                });
                events.push(GameEvent::SendToPlayer {
                    slot: (defender_idx + 1) as u8,
                    payload: json!({
                        "type": "you_were_hit",
                        "region": h.region.to_wire(), // CR-04: include region to match bot path and protocol struct
                        "damage": dmg,
                    }),
                });
            }
        }

        // --- Round-over check (BOX-06, BOX-08, ENG-10) ---
        if let Some(ev) = check_round_over(&s.hp, ctx.tick_info.remaining_secs) {
            if !s.round_ended {
                s.round_ended = true;
                events.push(ev);
            }
        }

        events
    }

    fn on_calibration_complete(&self, slot: u8, ref_vel: f64, state: &mut dyn Any) {
        let s = state.downcast_mut::<BoxingState>()
            .expect("boxing plugin: state type mismatch");
        // D-08: clamp to [0.5, 15.0] — prevents near-zero ref (phantom hits) and extreme ref (all-miss)
        s.ref_vel[slot as usize] = ref_vel.clamp(0.5, 15.0);
    }

    fn on_round_reset(&self, state: &mut dyn Any) {
        let s = state.downcast_mut::<BoxingState>()
            .expect("boxing plugin: state type mismatch");
        // FIX-01: clear ONLY round-scoped state. DO NOT touch ref_vel.
        // Bug reference: server/rooms.py line 64 `slot.reference_velocity = None` — do NOT replicate.
        s.hp = [self.config.hp; 2];
        s.last_hit_tick = [-999; 2];
        s.combo = [(0.0, 0); 2];
        s.low_hp_announced = [false; 2];
        s.first_blood_pending = true;
        s.round_ended = false;
        // bot_next_hit_at is intentionally NOT reset — bot continues its timer from the round break
        // This matches Python _tick_bot behavior which does not reset the interval on rematch.
    }

    fn max_wins(&self) -> u32 {
        self.config.max_wins
    }

    fn on_player_join(&self, slot: u8, _state: &mut dyn Any) {
        tracing::info!("boxing: player {} joined", slot + 1);
    }

    fn on_player_leave(&self, slot: u8, _state: &mut dyn Any) {
        tracing::info!("boxing: player {} left", slot + 1);
    }

    fn game_type(&self) -> &'static str { "boxing" }
    fn initial_hp(&self) -> u32 { self.config.hp }
    // requires_calibration uses default true — no override needed
    // spectator_snapshot uses default None — no override needed
}

// ---------------------------------------------------------------------------
// Round-over check (BOX-06, BOX-08)
// ---------------------------------------------------------------------------

fn check_round_over(hp: &[u32; 2], remaining_secs: f64) -> Option<GameEvent> {
    // KO: either player reaches 0 HP
    if hp[0] == 0 { return Some(GameEvent::RoundOver { winner: Some(2) }); }
    if hp[1] == 0 { return Some(GameEvent::RoundOver { winner: Some(1) }); }
    // Time limit: decision by HP; equal HP = draw (BOX-08)
    if remaining_secs <= 0.0 {
        let winner = match hp[0].cmp(&hp[1]) {
            std::cmp::Ordering::Greater => Some(1),
            std::cmp::Ordering::Less    => Some(2),
            std::cmp::Ordering::Equal   => None,  // draw
        };
        return Some(GameEvent::RoundOver { winner });
    }
    None
}

// ---------------------------------------------------------------------------
// Commentary hints (emitted by boxing; consumed by v2 commentary engine)
// ---------------------------------------------------------------------------

fn emit_commentary_hint(
    events: &mut Vec<GameEvent>,
    s: &mut BoxingState,
    attacker: usize,
    defender: usize,
    _region: &BodyRegion,
    damage: u32,
    elapsed: f64,
    max_hp: u32, // WR-02: pass self.config.hp from caller so percentage thresholds scale correctly
) {
    // Combo tracking: server/game_loop.py lines 430-437
    let (last_t, count) = s.combo[attacker];
    let new_count = if elapsed - last_t <= 1.8 { count + 1 } else { 1 };
    s.combo[attacker] = (elapsed, new_count);
    s.combo[defender] = (0.0, 0); // reset opponent combo on being hit

    let max_hp = max_hp as f64;
    let defender_hp_pct = s.hp[defender] as f64 / max_hp;
    let attacker_hp_pct = s.hp[attacker] as f64 / max_hp;

    let kind = if s.first_blood_pending {
        s.first_blood_pending = false;
        "first_blood"
    } else if new_count >= 3 {
        "combo"
    } else if attacker_hp_pct < 0.3 && defender_hp_pct >= attacker_hp_pct {
        "comeback"
    } else if defender_hp_pct <= 0.25 && !s.low_hp_announced[defender] {
        s.low_hp_announced[defender] = true;
        "low_hp"
    } else {
        "hit"
    };

    events.push(GameEvent::CommentaryHint {
        kind: kind.to_string(),
        payload: json!({
            "attacker": attacker + 1,
            "defender": defender + 1,
            "damage": damage,
            "combo_count": if kind == "combo" { new_count } else { 0 },
        }),
    });
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use plugin_trait::{TickContext, TickInfo, RoomView, SlotView};

    fn test_config() -> BoxingConfig {
        BoxingConfig {
            hp: 800,
            round_secs: 90.0,
            max_wins: 3,
            bot_difficulty: Difficulty::Normal,
        }
    }

    fn empty_tick_ctx() -> (VecDeque<plugin_trait::PoseFrame>, VecDeque<plugin_trait::PoseFrame>) {
        (VecDeque::new(), VecDeque::new())
    }

    #[test]
    fn fix01_ref_vel_survives_round_reset() {
        // FIX-01 regression: calibration persists through rematch
        let plugin = BoxingPlugin::new(test_config());
        let mut state = plugin.init_state();
        plugin.on_calibration_complete(0, 4.5, &mut *state);
        plugin.on_round_reset(&mut *state);
        let s = state.downcast_ref::<BoxingState>().unwrap();
        assert_eq!(s.ref_vel[0], 4.5, "FIX-01: ref_vel[0] must survive on_round_reset");
    }

    #[test]
    fn fix01_ref_vel_slot1_also_survives_reset() {
        let plugin = BoxingPlugin::new(test_config());
        let mut state = plugin.init_state();
        plugin.on_calibration_complete(0, 4.5, &mut *state);
        plugin.on_calibration_complete(1, 3.2, &mut *state);
        plugin.on_round_reset(&mut *state);
        let s = state.downcast_ref::<BoxingState>().unwrap();
        assert_eq!(s.ref_vel[0], 4.5, "ref_vel[0] must survive reset");
        assert_eq!(s.ref_vel[1], 3.2, "ref_vel[1] must survive reset");
    }

    #[test]
    fn d08_ref_vel_clamped_below_minimum() {
        let plugin = BoxingPlugin::new(test_config());
        let mut state = plugin.init_state();
        plugin.on_calibration_complete(0, 0.1, &mut *state);
        let s = state.downcast_ref::<BoxingState>().unwrap();
        assert_eq!(s.ref_vel[0], 0.5, "D-08: ref_vel below 0.5 must clamp to 0.5");
    }

    #[test]
    fn d08_ref_vel_clamped_above_maximum() {
        let plugin = BoxingPlugin::new(test_config());
        let mut state = plugin.init_state();
        plugin.on_calibration_complete(0, 20.0, &mut *state);
        let s = state.downcast_ref::<BoxingState>().unwrap();
        assert_eq!(s.ref_vel[0], 15.0, "D-08: ref_vel above 15.0 must clamp to 15.0");
    }

    #[test]
    fn on_round_reset_clears_hp_to_config_value() {
        let plugin = BoxingPlugin::new(test_config());
        let mut state = plugin.init_state();
        // Manually reduce HP
        state.downcast_mut::<BoxingState>().unwrap().hp[0] = 500;
        plugin.on_round_reset(&mut *state);
        let s = state.downcast_ref::<BoxingState>().unwrap();
        assert_eq!(s.hp[0], 800);
        assert_eq!(s.hp[1], 800);
    }

    #[test]
    fn on_round_reset_clears_cooldowns() {
        let plugin = BoxingPlugin::new(test_config());
        let mut state = plugin.init_state();
        state.downcast_mut::<BoxingState>().unwrap().last_hit_tick[0] = 100;
        plugin.on_round_reset(&mut *state);
        let s = state.downcast_ref::<BoxingState>().unwrap();
        assert_eq!(s.last_hit_tick[0], -999);
    }

    #[test]
    fn check_round_over_ko_player1() {
        let hp = [0u32, 800u32];
        let ev = check_round_over(&hp, 45.0).unwrap();
        match ev {
            GameEvent::RoundOver { winner: Some(2) } => {}
            other => panic!("expected RoundOver{{winner:Some(2)}}, got {:?}", other),
        }
    }

    #[test]
    fn check_round_over_ko_player2() {
        let hp = [800u32, 0u32];
        let ev = check_round_over(&hp, 45.0).unwrap();
        match ev {
            GameEvent::RoundOver { winner: Some(1) } => {}
            other => panic!("expected RoundOver{{winner:Some(1)}}, got {:?}", other),
        }
    }

    #[test]
    fn check_round_over_draw_equal_hp() {
        // BOX-08: equal HP at time expiry = draw
        let hp = [400u32, 400u32];
        let ev = check_round_over(&hp, 0.0).unwrap();
        match ev {
            GameEvent::RoundOver { winner: None } => {}
            other => panic!("expected draw RoundOver{{winner:None}}, got {:?}", other),
        }
    }

    #[test]
    fn check_round_over_decision_by_hp() {
        let hp = [600u32, 400u32];
        let ev = check_round_over(&hp, 0.0).unwrap();
        match ev {
            GameEvent::RoundOver { winner: Some(1) } => {}
            other => panic!("expected RoundOver{{winner:Some(1)}} for higher HP, got {:?}", other),
        }
    }

    #[test]
    fn object_safety_box_dyn_game_plugin() {
        // PLUG-05: Box<dyn GamePlugin + Send + Sync> must compile
        let plugin = BoxingPlugin::new(test_config());
        let _boxed: Box<dyn GamePlugin + Send + Sync> = Box::new(plugin);
        // If this test compiles, Box<dyn GamePlugin + Send + Sync> is valid
    }

    #[test]
    fn on_tick_time_expired_returns_round_over() {
        let plugin = BoxingPlugin::new(test_config());
        let mut state = plugin.init_state();
        plugin.on_calibration_complete(0, 3.0, &mut *state);
        plugin.on_calibration_complete(1, 3.0, &mut *state);
        // Set HP to non-zero so KO doesn't fire
        {
            let s = state.downcast_mut::<BoxingState>().unwrap();
            s.hp = [700, 400]; // player 1 has more HP
        }
        let (frames0, frames1) = empty_tick_ctx();
        let ctx = TickContext {
            frames: [&frames0, &frames1],
            tick_info: TickInfo { tick: 5400, elapsed_secs: 90.0, remaining_secs: 0.0 },
            room: RoomView {
                slots: [
                    SlotView { connected: true, reference_velocity: Some(3.0) },
                    SlotView { connected: true, reference_velocity: Some(3.0) },
                ],
                solo_mode: false,
            },
        };
        let events = plugin.on_tick(&ctx, &mut *state);
        let round_over = events.iter().any(|e| matches!(e, GameEvent::RoundOver { winner: Some(1) }));
        assert!(round_over, "expected RoundOver{{winner:Some(1)}} for p1 winning by HP");
    }
}
