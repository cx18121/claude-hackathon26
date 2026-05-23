use std::collections::VecDeque;
use std::time::Instant;
use crate::room::RoomState;
use crate::protocol::*;
use plugin_trait::{GameEvent, TickContext, TickInfo, RoomView, SlotView, PoseFrame};
use plugin_trait::PoseKeypoint as PluginKeypoint;

// Constants ported from server/game_loop.py lines 26-28
pub const ROUND_DURATION: f64 = 90.0;
pub const ROUND_WARMUP: f64 = 3.8;

/// Transform a raw MediaPipe frame to hip-centred Y-up coordinates.
/// MediaPipe: Y positive = toward feet. After transform: Y positive = above hip centre.
/// Source: server/hit_detection.py _hip_mid_y (line 104) and _y_up (line 109).
/// PLUG-06: engine delivers normalized coords to plugin; plugin never transforms.
fn normalize_to_y_up(frame: &crate::protocol::MsgPoseFrame) -> PoseFrame {
    if frame.keypoints.len() < 25 {
        // Malformed frame — return as-is with no normalization to avoid panic (T-02-17)
        return PoseFrame {
            timestamp: frame.timestamp,
            keypoints: frame.keypoints.iter().map(|kp| PluginKeypoint {
                x: kp.x, y: kp.y, z: kp.z, visibility: kp.visibility,
            }).collect(),
        };
    }
    let hip_l = &frame.keypoints[23]; // LEFT_HIP
    let hip_r = &frame.keypoints[24]; // RIGHT_HIP
    let hip_mid_y = (hip_l.y + hip_r.y) / 2.0;
    let hip_mid_x = (hip_l.x + hip_r.x) / 2.0;
    PoseFrame {
        timestamp: frame.timestamp,
        keypoints: frame.keypoints.iter().map(|kp| PluginKeypoint {
            x: kp.x - hip_mid_x,
            y: hip_mid_y - kp.y,  // negate + shift: Y-up above hip
            z: kp.z,
            visibility: kp.visibility,
        }).collect(),
    }
}

/// Called from room_actor's select! tick arm (ENG-04).
/// Implements: warmup gate (ENG-09), round lifecycle (ENG-10), MsgGameState broadcast.
/// Phase 2: calls plugin.on_tick and dispatches all 5 GameEvent variants.
pub fn game_tick(state: &mut RoomState) {
    // `intended_solo` is the single source of truth — set once at PlayerConnect
    // from MsgJoin.solo. Do NOT re-derive from `!P2.connected`: a transient P2
    // disconnect during a two-player match must not flip the room to bot mode.
    let solo_mode = state.is_solo_match();
    let calibrated_ok = if solo_mode {
        // In solo mode, only player 0 must have calibrated (player 1 is a bot)
        state.players[0].reference_velocity.is_some()
    } else {
        // In two-player mode, both players must have calibrated
        state.players.iter().all(|p| p.reference_velocity.is_some())
    };
    let match_in_progress = calibrated_ok
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

    // Increment tick counter (PLUG-02)
    state.tick += 1;

    // ENG-06: Drain RTT-released frames into processed_frames
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
        // NOTE: do NOT clear processed_frames here (WR-05 placeholder removed).
        // Frames are cleared AFTER plugin.on_tick returns (see below).
    }

    // PLUG-06: normalize released frames to hip-centred Y-up before building TickContext
    let norm_frames: [VecDeque<PoseFrame>; 2] = [
        state.players[0].processed_frames.iter().map(normalize_to_y_up).collect(),
        state.players[1].processed_frames.iter().map(normalize_to_y_up).collect(),
    ];

    let ctx = TickContext {
        frames: [&norm_frames[0], &norm_frames[1]],
        tick_info: TickInfo {
            tick: state.tick,
            elapsed_secs: live_elapsed,
            remaining_secs: remaining_time,
        },
        room: RoomView {
            slots: [
                SlotView {
                    connected: state.players[0].connected,
                    reference_velocity: state.players[0].reference_velocity,
                },
                SlotView {
                    connected: state.players[1].connected,
                    reference_velocity: state.players[1].reference_velocity,
                },
            ],
            solo_mode: state.is_solo_match(),
        },
    };

    // Call plugin (synchronous — no await, no blocking) and dispatch returned events
    let events = state.plugin.on_tick(&ctx, &mut *state.plugin_state);

    // Clear processed frames AFTER plugin has consumed them (replaces WR-05 placeholder)
    for player in state.players.iter_mut() {
        player.processed_frames.clear();
    }

    // Clear recent_hits from previous tick before dispatch adds new hits
    state.recent_hits.clear();

    // Sync engine-side HP mirror from the plugin. The plugin is the source of
    // truth for HP — it's where damage is actually subtracted in `on_tick` and
    // where round-over is detected. Engine `state.hp` is purely a mirror used
    // for MsgGameState broadcasts and MsgRoundEnd.final_hp. Doing this BEFORE
    // dispatch_events means handle_round_over (called inside dispatch_events
    // for round-over events) sees the post-tick HP when assembling final_hp.
    if let Some(hp) = state.plugin.current_hp(state.plugin_state.as_ref()) {
        state.hp = hp;
    }

    dispatch_events(state, events);

    // Broadcast live game_state (poses always empty per _EMPTY_POSES pattern)
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
        tick: state.tick,  // was 0 in Phase 1
        hp: (state.hp[0], state.hp[1]),
        wins: (state.wins[0], state.wins[1]), // FIX-02: wins in snapshot prevents overlay desync on reconnect
        poses: (vec![], vec![]),              // _EMPTY_POSES — poses travel via pose_update fast path
        recent_hits: state.recent_hits.clone(),  // now populated by dispatch_events
        high_latency,
        remaining_time,
        max_wins: state.max_wins,
    }
}

/// Dispatch all GameEvent variants returned by plugin.on_tick.
/// Defers RoundOver processing to avoid borrow conflicts on state.
fn dispatch_events(state: &mut RoomState, events: Vec<GameEvent>) {
    // Collect RoundOver separately — process after other events (avoids borrow conflict on state.hp)
    let mut round_over_winner: Option<Option<u8>> = None;

    for event in events {
        match event {
            GameEvent::Hit { attacker, defender, region, damage, position } => {
                // HP is owned by the plugin (BoxingState/FPSBoxingState) and mirrored
                // into state.hp by the per-tick current_hp() sync above. Subtracting
                // here too would double-count damage on the spectator-visible mirror,
                // making the HP bar drain at 2× the actual gameplay rate.
                // Accumulate the hit record for MsgGameState.recent_hits broadcast.
                state.recent_hits.push(crate::protocol::HitEvent {
                    player: attacker,
                    region: region.to_wire().to_string(), // CR-05: snake_case via to_wire()
                    damage: damage as f64,
                    position: crate::protocol::Position {
                        x: position[0] as f64,
                        y: position[1] as f64,
                        z: 0.0,
                    },
                });
                tracing::info!(
                    "room {} hit: p{} hit p{} region={:?} damage={}",
                    state.code, attacker, defender, region, damage
                );
            }
            GameEvent::RoundOver { winner } => {
                // First-wins: on simultaneous events in one tick (e.g., a double-KO),
                // record the first reported winner and ignore subsequent RoundOvers
                // so the wrong player's win isn't latched by overwrite.
                if round_over_winner.is_none() {
                    round_over_winner = Some(winner);
                }
            }
            GameEvent::SendToPlayer { slot, payload } => {
                // T-02-16: bounds-check slot index before tx lookup; drops silently if out of range
                let slot_idx = (slot - 1) as usize;
                if slot_idx < 2 {
                    if let Some(tx) = &state.players[slot_idx].tx {
                        if let Ok(json) = serde_json::to_string(&payload) {
                            if tx.try_send(json).is_err() {
                                tracing::warn!(
                                    "room {} player {} outbound channel full, dropping SendToPlayer",
                                    state.code, slot
                                );
                            }
                        }
                    }
                }
            }
            GameEvent::Broadcast { payload } => {
                if let Ok(json) = serde_json::to_string(&payload) {
                    let _ = state.game_tx.send(json.clone());
                    // Also deliver to connected players (dance_beat / dance_score must reach mobile)
                    for slot in &state.players {
                        if let Some(tx) = &slot.tx {
                            let _ = tx.try_send(json.clone());
                        }
                    }
                }
            }
            GameEvent::CommentaryHint { kind, payload } => {
                if let Some(tx) = &state.commentary_tx {
                    let hint = crate::commentator::CommentaryHint { kind, payload };
                    if tx.try_send(hint).is_err() {
                        tracing::debug!("room {}: commentary channel full, dropping hint", state.code);
                    }
                }
            }
        }
    }

    // Process deferred RoundOver
    if let Some(winner) = round_over_winner {
        handle_round_over(state, winner);
    }
}

/// Handle a RoundOver event: broadcast round_end, increment wins, check match over or reset.
/// Called from dispatch_events after all other events are processed.
fn handle_round_over(state: &mut RoomState, winner: Option<u8>) {
    // Broadcast round end
    let round_end = MsgRoundEnd {
        msg_type: "round_end".to_string(),
        winner,
        final_hp: (state.hp[0], state.hp[1]),
    };
    if let Ok(json) = serde_json::to_string(&round_end) {
        let _ = state.game_tx.send(json.clone());
        for (slot, player) in state.players.iter().enumerate() {
            if let Some(tx) = &player.tx {
                if tx.try_send(json.clone()).is_err() {
                    tracing::warn!("room {} player {} outbound channel full, dropping round_end", state.code, slot + 1);
                }
            }
        }
    }

    // Increment win counter (BOX-09: engine tracks wins, ENG-10)
    if let Some(w) = winner {
        state.wins[(w - 1) as usize] += 1;
    }

    // Check match over
    if state.wins.iter().any(|&w| w >= state.max_wins) {
        let match_winner = state.wins.iter().enumerate()
            .max_by_key(|(_, &w)| w)
            .map(|(i, _)| (i + 1) as u8)
            .unwrap_or(1);
        let match_end = MsgMatchEnd {
            msg_type: "match_end".to_string(),
            winner: match_winner,
        };
        if let Ok(json) = serde_json::to_string(&match_end) {
            let _ = state.game_tx.send(json.clone());
            for (slot, player) in state.players.iter().enumerate() {
                if let Some(tx) = &player.tx {
                    if tx.try_send(json.clone()).is_err() {
                        tracing::warn!("room {} player {} outbound channel full, dropping match_end", state.code, slot + 1);
                    }
                }
            }
        }
        state.match_over = true;
        state.match_over_flag.store(true, std::sync::atomic::Ordering::Relaxed);
        tracing::info!("room {} match ended, winner player {}", state.code, match_winner);
        return;
    }

    // Reset for next round
    state.round_number += 1;
    state.hp = [state.initial_hp, state.initial_hp]; // WR-01: use config value, not hardcoded 800
    state.round_start_time = Some(Instant::now());
    for player in state.players.iter_mut() {
        player.pose_buffer.clear();
        player.processed_frames.clear();
    }
    // FIX-01: call plugin's on_round_reset (clears HP/cooldowns in plugin state but NOT ref_vel)
    state.plugin.on_round_reset(&mut *state.plugin_state);

    let round_start = MsgRoundStart {
        msg_type: "round_start".to_string(),
        round_number: state.round_number,
    };
    if let Ok(json) = serde_json::to_string(&round_start) {
        let _ = state.game_tx.send(json.clone());
        for (slot, player) in state.players.iter().enumerate() {
            if let Some(tx) = &player.tx {
                if tx.try_send(json.clone()).is_err() {
                    tracing::warn!("room {} player {} outbound channel full, dropping round_start", state.code, slot + 1);
                }
            }
        }
    }
    tracing::info!("room {} round {} started", state.code, state.round_number);
}

#[cfg(test)]
mod solo_mode_tests {
    use std::sync::Arc;
    use std::sync::atomic::AtomicBool;
    use tokio::sync::broadcast;
    use boxing_plugin::{BoxingPlugin, BoxingConfig, Difficulty};
    use crate::room::RoomState;

    fn make_room_state() -> RoomState {
        let (pose_tx, _) = broadcast::channel(64);
        let (game_tx, _) = broadcast::channel(64);
        let match_over_flag = Arc::new(AtomicBool::new(false));
        let last_disconnect = Arc::new(std::sync::Mutex::new(None::<std::time::Instant>));
        let plugin: Arc<dyn plugin_trait::GamePlugin + Send + Sync> = Arc::new(
            BoxingPlugin::new(BoxingConfig {
                hp: 800,
                round_secs: 90.0,
                max_wins: 3,
                bot_difficulty: Difficulty::Normal,
            })
        );
        RoomState::new(
            "TEST".to_string(),
            3,
            pose_tx,
            game_tx,
            match_over_flag,
            last_disconnect,
            plugin,
            "boxing".to_string(),
        )
    }

    /// BOX-10: solo mode gate — slot 0 calibrated, slot 1 never connected,
    /// `intended_solo` latched. game_tick must NOT return early once
    /// round_start_time is set.
    #[test]
    fn box10_solo_mode_gate_allows_single_player() {
        let mut state = make_room_state();

        state.intended_solo = true;
        state.players[0].connected = true;
        state.players[0].reference_velocity = Some(5.0);

        let solo_mode = state.is_solo_match();
        let ready_to_start = if solo_mode {
            state.players[0].reference_velocity.is_some()
        } else {
            state.players.iter().all(|p| p.reference_velocity.is_some())
        };
        assert!(ready_to_start, "solo room: slot 0 calibrated alone should be ready_to_start");

        state.round_start_time = Some(std::time::Instant::now());

        let calibrated_ok = if solo_mode {
            state.players[0].reference_velocity.is_some()
        } else {
            state.players.iter().all(|p| p.reference_velocity.is_some())
        };
        let match_in_progress = calibrated_ok
            && state.round_start_time.is_some()
            && !state.match_over;

        assert!(match_in_progress, "BOX-10: match_in_progress must be true in solo mode once calibrated");
    }

    /// Two-player room: both slots must calibrate.
    #[test]
    fn two_player_mode_still_requires_both_calibrated() {
        let mut state = make_room_state();
        // intended_solo stays false — this is a two-player room
        state.players[0].connected = true;
        state.players[0].reference_velocity = Some(5.0);
        state.players[1].connected = true;

        let ready_to_start = if state.is_solo_match() {
            state.players[0].reference_velocity.is_some()
        } else {
            state.players.iter().all(|p| p.reference_velocity.is_some())
        };

        assert!(!ready_to_start, "two-player room: only one slot calibrated must NOT be ready_to_start");
    }

    /// Regression: a two-player room where P2 disconnects between PlayerConnect
    /// and CalibrationDone must NOT silently start in bot mode. With the old
    /// `solo_mode = !players[1].connected` derivation, slot 0 calibrating alone
    /// would have flipped the room to solo. Now `intended_solo` stays false.
    #[test]
    fn two_player_room_with_transient_p2_disconnect_does_not_become_solo() {
        let mut state = make_room_state();
        // Two-player room (intended_solo=false). P1 connected, P2 connected
        // then dropped before calibration completed.
        state.players[0].connected = true;
        state.players[0].reference_velocity = Some(5.0);
        state.players[1].connected = false;

        assert!(!state.is_solo_match(), "intended_solo must remain false");

        let ready_to_start = if state.is_solo_match() {
            state.players[0].reference_velocity.is_some()
        } else {
            state.players.iter().all(|p| p.reference_velocity.is_some())
        };
        assert!(
            !ready_to_start,
            "transient P2 disconnect must not auto-start a bot match"
        );
    }
}

#[cfg(test)]
mod hp_sync_tests {
    //! Regression coverage for the double-subtract bug fixed by introducing
    //! `GamePlugin::current_hp` and removing the engine-side HP decrement
    //! from `dispatch_events`'s Hit arm. Before the fix, every Hit event
    //! drained `RoomState.hp` once from the plugin's `on_tick` (which
    //! subtracts in `BoxingState.hp`) and once from `dispatch_events`,
    //! making the spectator HP bar drain 2× as fast as the actual game.

    use std::sync::Arc;
    use std::sync::atomic::AtomicBool;
    use tokio::sync::broadcast;
    use boxing_plugin::{BoxingPlugin, BoxingConfig, Difficulty};
    use plugin_trait::{GameEvent, BodyRegion, GamePlugin};
    use crate::room::RoomState;
    use super::dispatch_events;

    fn make_room_state() -> RoomState {
        let (pose_tx, _) = broadcast::channel(64);
        let (game_tx, _) = broadcast::channel(64);
        let plugin: Arc<dyn plugin_trait::GamePlugin + Send + Sync> = Arc::new(
            BoxingPlugin::new(BoxingConfig {
                hp: 800,
                round_secs: 90.0,
                max_wins: 3,
                bot_difficulty: Difficulty::Normal,
            })
        );
        RoomState::new(
            "TEST".to_string(),
            3,
            pose_tx,
            game_tx,
            Arc::new(AtomicBool::new(false)),
            Arc::new(std::sync::Mutex::new(None)),
            plugin,
            "boxing".to_string(),
        )
    }

    /// dispatch_events must NOT mutate `state.hp` on a Hit event. HP is owned
    /// by the plugin and synced into `state.hp` by the per-tick `current_hp`
    /// call in `game_tick` (before dispatch_events runs).
    #[test]
    fn dispatch_events_does_not_subtract_hp_on_hit() {
        let mut state = make_room_state();
        state.hp = [800, 800];

        let events = vec![GameEvent::Hit {
            attacker: 1,
            defender: 2,
            region: BodyRegion::HeadFace,
            damage: 50.0,
            position: [0.0, 0.0],
        }];

        dispatch_events(&mut state, events);

        assert_eq!(state.hp, [800, 800],
            "dispatch_events must not mutate state.hp on Hit — HP is plugin-owned and synced separately");
        assert_eq!(state.recent_hits.len(), 1, "the hit must still be recorded in recent_hits");
    }

    /// BoxingPlugin::current_hp must read live HP out of BoxingState, not just
    /// initial_hp. This is the trait surface the engine relies on for syncing.
    #[test]
    fn boxing_plugin_current_hp_reflects_live_state() {
        use boxing_plugin::BoxingState;

        let plugin = BoxingPlugin::new(BoxingConfig {
            hp: 800,
            round_secs: 90.0,
            max_wins: 3,
            bot_difficulty: Difficulty::Normal,
        });
        let mut state = plugin.init_state();
        // Mutate the plugin's internal HP to a non-initial value.
        state.downcast_mut::<BoxingState>().unwrap().hp = [600, 250];

        let hp = plugin.current_hp(state.as_ref());
        assert_eq!(hp, Some([600, 250]),
            "current_hp must read s.hp out of the live BoxingState, not return initial_hp");
    }
}
