use std::any::Any;
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{broadcast, mpsc, oneshot};
use crate::protocol::{MsgPoseFrame, MsgLobbyUpdate, MsgGameState};
use crate::commentator;
use plugin_trait::GamePlugin;

pub struct PlayerSlot {
    pub tx: Option<mpsc::Sender<String>>,           // outbound task channel (ENG-05)
    pub reference_velocity: Option<f64>,            // None until calibrated
    pub connected: bool,
    pub rtt_samples: Vec<f64>,                      // for RTT fairness (ENG-06)
    pub pose_buffer: VecDeque<(Instant, MsgPoseFrame)>,  // (arrived_at, frame)
    pub processed_frames: VecDeque<MsgPoseFrame>,   // frames past RTT cutoff
}

impl PlayerSlot {
    pub fn new() -> Self {
        Self {
            tx: None,
            reference_velocity: None,
            connected: false,
            rtt_samples: Vec::new(),
            pose_buffer: VecDeque::with_capacity(180),
            processed_frames: VecDeque::new(),
        }
    }
}

pub struct RoomState {
    pub code: String,
    pub players: [PlayerSlot; 2],   // index 0 = player slot 1, index 1 = player slot 2
    pub round_number: u32,
    pub wins: [u32; 2],
    pub round_start_time: Option<Instant>,
    pub match_over: bool,
    /// Shared with RoomHandle so the expiry task can observe match completion (CR-03).
    pub match_over_flag: Arc<std::sync::atomic::AtomicBool>,
    /// Shared with RoomHandle — set to Some(Instant::now()) when last player disconnects (CR-01).
    pub last_player_disconnected_at: Arc<std::sync::Mutex<Option<Instant>>>,
    pub max_wins: u32,
    /// Set once at CalibrationDone when match starts (WR-01: avoid re-deriving per tick which
    /// would silently activate bot mode if P2 disconnects during a two-player match).
    pub solo_mode: bool,
    /// Set true when the first joining client sent `solo: true` in MsgJoin. Gates the
    /// solo auto-start branch in PlayerConnect — without this, the room would auto-start
    /// a solo match the moment P1 connects to any room (because P2 isn't connected yet),
    /// leaving a real P2 stuck on the waiting screen when they later join.
    pub intended_solo: bool,
    pub hp: [u32; 2],
    /// Starting HP per player — set from plugin.initial_hp() at creation; used on round reset (WR-01).
    pub initial_hp: u32,
    // Broadcast channel senders (rx subscribed by spectator handlers and outbound tasks)
    pub pose_tx: broadcast::Sender<String>,          // fast path (ENG-07, ENG-08)
    pub game_tx: broadcast::Sender<String>,          // slow path (ENG-08)
    /// Plugin instance shared across all rooms (one boxing plugin, many rooms). Arc for Clone.
    pub plugin: Arc<dyn GamePlugin + Send + Sync>,
    /// Per-room plugin state (opaque Box<dyn Any + Send>). Only the plugin downcasts this.
    pub plugin_state: Box<dyn Any + Send>,
    /// Monotonic tick counter (replaces hardcoded 0 in Phase 1 build_game_state). (PLUG-02)
    pub tick: u64,
    /// Hits accumulated this tick; broadcast in MsgGameState.recent_hits, then cleared.
    pub recent_hits: Vec<crate::protocol::HitEvent>,
    /// Commentary hint channel — send CommentaryHint events here; None when commentary disabled.
    pub commentary_tx: Option<mpsc::Sender<commentator::CommentaryHint>>,
    /// Game type identifier for this room — set once at creation from the plugin.
    pub game_type: String,
}

impl RoomState {
    pub fn new(
        code: String,
        max_wins: u32,
        pose_tx: broadcast::Sender<String>,
        game_tx: broadcast::Sender<String>,
        match_over_flag: Arc<std::sync::atomic::AtomicBool>,
        last_player_disconnected_at: Arc<std::sync::Mutex<Option<Instant>>>,
        plugin: Arc<dyn GamePlugin + Send + Sync>,
        game_type: String,
    ) -> Self {
        let initial_hp = plugin.initial_hp();
        let plugin_state = plugin.init_state();
        Self {
            code,
            players: [PlayerSlot::new(), PlayerSlot::new()],
            round_number: 1,
            wins: [0, 0],
            round_start_time: None,
            match_over: false,
            match_over_flag,
            last_player_disconnected_at,
            max_wins,
            solo_mode: false,
            intended_solo: false,
            hp: [initial_hp, initial_hp],
            initial_hp,
            pose_tx,
            game_tx,
            plugin,
            plugin_state,
            tick: 0,
            recent_hits: Vec::new(),
            commentary_tx: None, // Set by room_manager after spawning the commentary task
            game_type,
        }
    }
}

/// Result sent back to the WS handler on PlayerConnect
pub struct ConnectResult {
    pub slot: usize,       // 0-indexed slot assigned
    pub room_code: String,
    pub opponent_connected: bool,
}

/// Snapshot for FIX-02: sent to spectators on connect
pub struct RoomSnapshot {
    pub lobby_update: MsgLobbyUpdate,
    pub round_start: Option<crate::protocol::MsgRoundStart>,
    pub game_state: Option<MsgGameState>,
    pub game_type: String,                              // new — DANCE-02
    pub plugin_snapshot: Option<serde_json::Value>,    // new — DANCE-05
}

pub enum RoomCmd {
    PlayerConnect {
        slot: usize,
        tx: mpsc::Sender<String>,
        reply: oneshot::Sender<Option<ConnectResult>>,
        /// True if the joining client signalled solo intent (MsgJoin.solo). Only the
        /// first connecting player can set this — once a real opponent has joined, the
        /// room can't be retroactively turned into a solo session.
        solo: bool,
    },
    PoseFrame {
        slot: usize,
        frame: MsgPoseFrame,
        arrived_at: Instant,
    },
    CalibrationDone {
        slot: usize,
        reference_velocity: f64,
    },
    RecordPong {
        slot: usize,
        original_t: f64,
    },
    PlayerDisconnect {
        slot: usize,
    },
    GetSnapshot {
        reply: oneshot::Sender<RoomSnapshot>,
    },
    MarkMatchOver,
}

/// Helper to send a message to a player slot's outbound task.
/// Silently drops if the channel is full or the player is disconnected.
fn send_to_slot(state: &RoomState, slot_idx: usize, json: &str) {
    if let Some(tx) = &state.players[slot_idx].tx {
        let _ = tx.try_send(json.to_string());
    }
}

/// Broadcast to spectators (slow path) and all connected players.
fn broadcast_all(state: &RoomState, json: &str) {
    let _ = state.game_tx.send(json.to_string());
    for slot in &state.players {
        if let Some(tx) = &slot.tx {
            let _ = tx.try_send(json.to_string());
        }
    }
}

fn build_snapshot(state: &RoomState) -> RoomSnapshot {
    use crate::protocol::*;
    let lobby = MsgLobbyUpdate {
        msg_type: "lobby_update".to_string(),
        p1: state.players[0].connected,
        p2: state.players[1].connected,
    };
    let plugin_snapshot = if state.round_start_time.is_some() {
        state.plugin.spectator_snapshot(&*state.plugin_state)
    } else {
        None
    };
    if state.round_start_time.is_some() {
        let rs = MsgRoundStart {
            msg_type: "round_start".to_string(),
            round_number: state.round_number,
        };
        // WR-02: subtract warmup period and use shared constant (avoids drift if ROUND_DURATION changes)
        use crate::game_loop::{ROUND_DURATION, ROUND_WARMUP};
        let elapsed = state.round_start_time.map_or(0.0, |t| t.elapsed().as_secs_f64());
        let live_elapsed = (elapsed - ROUND_WARMUP).max(0.0);
        let remaining = (ROUND_DURATION - live_elapsed).max(0.0);
        let gs = MsgGameState {
            msg_type: "game_state".to_string(),
            tick: state.tick,
            hp: (state.hp[0], state.hp[1]),
            wins: (state.wins[0], state.wins[1]),  // FIX-02: include wins in snapshot
            poses: (vec![], vec![]),
            recent_hits: state.recent_hits.clone(),
            high_latency: false,
            remaining_time: remaining,
            max_wins: state.max_wins,
        };
        RoomSnapshot {
            lobby_update: lobby,
            round_start: Some(rs),
            game_state: Some(gs),
            game_type: state.game_type.clone(),
            plugin_snapshot,
        }
    } else {
        RoomSnapshot {
            lobby_update: lobby,
            round_start: None,
            game_state: None,
            game_type: state.game_type.clone(),
            plugin_snapshot: None,
        }
    }
}

pub async fn room_actor(
    mut cmd_rx: mpsc::Receiver<RoomCmd>,
    mut state: RoomState,
) {
    use tokio::time::{interval, Duration, MissedTickBehavior};
    let mut tick_interval = interval(Duration::from_millis(1000 / 60));
    tick_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);  // ENG-04

    loop {
        tokio::select! {
            Some(cmd) = cmd_rx.recv() => {
                handle_cmd(&mut state, cmd);
            }
            _ = tick_interval.tick() => {
                crate::game_loop::game_tick(&mut state);
            }
            else => break,
        }
    }
    tracing::info!("room actor {} stopped", state.code);
}

fn handle_cmd(state: &mut RoomState, cmd: RoomCmd) {
    match cmd {
        RoomCmd::PlayerConnect { slot, tx, reply, solo } => {
            if state.players[slot].connected {
                let _ = reply.send(None);
                return;
            }
            state.players[slot].tx = Some(tx);
            state.players[slot].connected = true;
            // Latch intended_solo from the first join that requests it. Subsequent
            // joins can't turn it on (a real P2 connecting must mean two-player),
            // and can't turn it off either (P1 already committed to solo).
            if solo && !state.players[1 - slot].connected {
                state.intended_solo = true;
            }
            state.plugin.on_player_join(slot as u8, &mut *state.plugin_state);
            let opponent_idx = 1 - slot;
            let result = ConnectResult {
                slot,
                room_code: state.code.clone(),
                opponent_connected: state.players[opponent_idx].connected,
            };
            // Broadcast lobby update to spectators
            if let Ok(json) = serde_json::to_string(&MsgLobbyUpdate {
                msg_type: "lobby_update".to_string(),
                p1: state.players[0].connected,
                p2: state.players[1].connected,
            }) {
                let _ = state.game_tx.send(json);
            }
            // Two-player mode: both players connected — send calibration_start to both (ENG-11).
            // Solo mode: only player 0 connected (player 1 is a bot) — send calibration_start to
            // slot 0 only. The solo branch is now gated on state.intended_solo (set from the
            // first MsgJoin.solo) — without this, the server treats any first-joiner as solo
            // and a real P2 joining later sits on the waiting screen forever because the
            // calibration_start gate (round_start_time.is_none()) has already fired.
            // Dance rooms: skip calibration entirely; set sentinel velocities and start match now.
            let solo_mode = state.intended_solo && !state.players[1].connected;
            if state.players[0].connected && state.players[1].connected
                && state.round_start_time.is_none()  // CR-02: guard against restarting an already-running match when P2 joins late
            {
                if state.plugin.requires_calibration() {
                    use crate::protocol::MsgCalibrationStart;
                    if let Ok(json) = serde_json::to_string(&MsgCalibrationStart {
                        msg_type: "calibration_start".to_string(),
                    }) {
                        send_to_slot(state, 0, &json);
                        send_to_slot(state, 1, &json);
                        tracing::info!("room {} calibration started (two-player)", state.code);
                    }
                } else {
                    // Dance: skip calibration handshake; set sentinel velocities so game_loop::game_tick
                    // calibrated_ok check passes (Pitfall 1 — reference_velocity.is_some() gate).
                    // Some(0.0) clearly signals "calibration bypassed"; dance plugin ignores this value.
                    state.players[0].reference_velocity = Some(0.0);
                    state.players[1].reference_velocity = Some(0.0);
                    state.solo_mode = false;
                    use crate::protocol::*;
                    if let Ok(json) = serde_json::to_string(&MsgMatchStart {
                        msg_type: "match_start".to_string(),
                    }) {
                        broadcast_all(state, &json);
                    }
                    if let Ok(json) = serde_json::to_string(&MsgRoundStart {
                        msg_type: "round_start".to_string(),
                        round_number: state.round_number,
                    }) {
                        broadcast_all(state, &json);
                    }
                    state.round_start_time = Some(Instant::now());
                    tracing::info!("room {} dance match started (no calibration)", state.code);
                }
            } else if solo_mode && slot == 0 && state.round_start_time.is_none() {
                if state.plugin.requires_calibration() {
                    use crate::protocol::MsgCalibrationStart;
                    if let Ok(json) = serde_json::to_string(&MsgCalibrationStart {
                        msg_type: "calibration_start".to_string(),
                    }) {
                        send_to_slot(state, 0, &json);
                        tracing::info!("room {} calibration started (solo/bot mode)", state.code);
                    }
                } else {
                    // Dance solo: skip calibration; set sentinel velocity for slot 0 only
                    state.players[0].reference_velocity = Some(0.0);
                    state.solo_mode = true;
                    use crate::protocol::*;
                    if let Ok(json) = serde_json::to_string(&MsgMatchStart {
                        msg_type: "match_start".to_string(),
                    }) {
                        broadcast_all(state, &json);
                    }
                    if let Ok(json) = serde_json::to_string(&MsgRoundStart {
                        msg_type: "round_start".to_string(),
                        round_number: state.round_number,
                    }) {
                        broadcast_all(state, &json);
                    }
                    state.round_start_time = Some(Instant::now());
                    tracing::info!("room {} dance solo match started (no calibration)", state.code);
                }
            }
            let _ = reply.send(Some(result));
        }
        RoomCmd::PoseFrame { slot, frame, arrived_at } => {
            // Fan-out to spectators happens in the WS handler (ENG-07) before this cmd is sent
            let buf = &mut state.players[slot].pose_buffer;
            if buf.len() >= 180 { buf.pop_front(); }
            buf.push_back((arrived_at, frame));
        }
        RoomCmd::CalibrationDone { slot, reference_velocity } => {
            state.players[slot].reference_velocity = Some(reference_velocity);
            state.plugin.on_calibration_complete(slot as u8, reference_velocity, &mut *state.plugin_state);
            tracing::info!("player {} calibrated ref_vel={:.2}", slot + 1, reference_velocity);
            // Determine if match can start.
            // Solo mode: player 2 is not connected — one calibrated player (slot 0) suffices.
            // Two-player mode: both players must have calibrated.
            let solo_mode = !state.players[1].connected;
            let ready_to_start = if solo_mode {
                // In solo mode, the connecting player (slot 0) calibrating is sufficient.
                // Player 1 (the bot) never connects and never calibrates.
                state.players[0].reference_velocity.is_some()
            } else {
                // In two-player mode, both players must have calibrated.
                state.players.iter().all(|p| p.reference_velocity.is_some())
            };
            if ready_to_start && state.round_start_time.is_none() {
                // WR-01: record solo_mode once at match start; do not re-derive per tick
                state.solo_mode = solo_mode;
                // Start match — game_loop will handle warmup gate
                use crate::protocol::*;
                if let Ok(json) = serde_json::to_string(&MsgMatchStart { msg_type: "match_start".to_string() }) {
                    broadcast_all(state, &json);
                }
                if let Ok(json) = serde_json::to_string(&MsgRoundStart { msg_type: "round_start".to_string(), round_number: state.round_number }) {
                    broadcast_all(state, &json);
                }
                state.round_start_time = Some(Instant::now());
                if solo_mode {
                    tracing::info!("room {} solo/bot match started", state.code);
                } else {
                    tracing::info!("room {} match started", state.code);
                }
            }
        }
        RoomCmd::RecordPong { slot, original_t } => {
            crate::input_delay::record_pong(&mut state.players[slot].rtt_samples, original_t);
        }
        RoomCmd::PlayerDisconnect { slot } => {
            state.players[slot].connected = false;
            state.players[slot].tx = None;
            state.plugin.on_player_leave(slot as u8, &mut *state.plugin_state);
            tracing::info!("player {} disconnected from room {}", slot + 1, state.code);
            // CR-01: record disconnect time when the last player leaves so the expiry task fires
            let any_connected = state.players.iter().any(|p| p.connected);
            if !any_connected {
                if let Ok(mut guard) = state.last_player_disconnected_at.lock() {
                    *guard = Some(Instant::now());
                }
            }
            // WR-05: send player_disconnected to the remaining connected player
            use crate::protocol::MsgPlayerDisconnected;
            let remaining = 1 - slot;
            if state.players[remaining].connected {
                if let Ok(json) = serde_json::to_string(&MsgPlayerDisconnected {
                    msg_type: "player_disconnected".to_string(),
                    player: (slot + 1) as u8,
                }) {
                    send_to_slot(state, remaining, &json);
                }
            }
            // Broadcast lobby update
            if let Ok(json) = serde_json::to_string(&MsgLobbyUpdate {
                msg_type: "lobby_update".to_string(),
                p1: state.players[0].connected,
                p2: state.players[1].connected,
            }) {
                let _ = state.game_tx.send(json);
            }
        }
        RoomCmd::GetSnapshot { reply } => {
            let _ = reply.send(build_snapshot(state));
        }
        RoomCmd::MarkMatchOver => {
            state.match_over = true;
        }
    }
}

#[cfg(test)]
mod player_connect_tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::AtomicBool;
    use tokio::sync::{broadcast, mpsc};
    use boxing_plugin::{BoxingPlugin, BoxingConfig, Difficulty};

    fn make_state() -> RoomState {
        let (pose_tx, _) = broadcast::channel(64);
        let (game_tx, _) = broadcast::channel(64);
        let flag = Arc::new(AtomicBool::new(false));
        let last_disconnect = Arc::new(std::sync::Mutex::new(None::<std::time::Instant>));
        let plugin: Arc<dyn plugin_trait::GamePlugin + Send + Sync> = Arc::new(
            BoxingPlugin::new(BoxingConfig {
                hp: 800,
                round_secs: 90.0,
                max_wins: 3,
                bot_difficulty: Difficulty::Normal,
            })
        );
        RoomState::new("T01".to_string(), 3, pose_tx, game_tx, flag, last_disconnect, plugin, "boxing".to_string())
    }

    fn drain_channel(rx: &mut mpsc::Receiver<String>) -> Vec<String> {
        let mut msgs = Vec::new();
        while let Ok(msg) = rx.try_recv() {
            msgs.push(msg);
        }
        msgs
    }

    fn has_calibration_start(msgs: &[String]) -> bool {
        msgs.iter().any(|m| m.contains("\"calibration_start\""))
    }

    /// BOX-10 / CR-01: solo player (slot 0) must receive calibration_start on connect
    /// when player 1 is not present.
    #[test]
    fn box10_solo_player_connect_sends_calibration_start() {
        let mut state = make_state();
        // Slot 0 outbound channel (capacity 16 — enough for lobby_update + calibration_start)
        let (tx0, mut rx0) = mpsc::channel::<String>(16);

        // Player 0 connects with solo=true; player 1 is never connected.
        let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
        handle_cmd(
            &mut state,
            RoomCmd::PlayerConnect { slot: 0, tx: tx0, reply: reply_tx, solo: true },
        );
        // reply_rx is a oneshot; we don't need the value, just confirm handle_cmd ran.
        drop(reply_rx);

        let msgs = drain_channel(&mut rx0);
        assert!(
            has_calibration_start(&msgs),
            "BOX-10/CR-01: solo player 0 must receive calibration_start on connect; got: {:?}",
            msgs
        );
    }

    /// Two-player mode: calibration_start sent to both slots after both connect.
    #[test]
    fn two_player_connect_sends_calibration_start_to_both() {
        let mut state = make_state();
        let (tx0, mut rx0) = mpsc::channel::<String>(16);
        let (tx1, mut rx1) = mpsc::channel::<String>(16);

        // Player 0 connects WITHOUT solo flag — server must NOT auto-start solo mode.
        // (This is the regression test for the "P2 stuck on waiting" bug.)
        let (r0_tx, r0_rx) = tokio::sync::oneshot::channel();
        handle_cmd(&mut state, RoomCmd::PlayerConnect { slot: 0, tx: tx0, reply: r0_tx, solo: false });
        drop(r0_rx);
        let early = drain_channel(&mut rx0);
        assert!(
            !has_calibration_start(&early),
            "regression: P1 joining a two-player room must NOT receive calibration_start before P2; got: {:?}",
            early
        );

        // Player 1 connects — now both are connected. Two-player calibration_start sent to both.
        let (r1_tx, r1_rx) = tokio::sync::oneshot::channel();
        handle_cmd(&mut state, RoomCmd::PlayerConnect { slot: 1, tx: tx1, reply: r1_tx, solo: false });
        drop(r1_rx);

        let msgs0 = drain_channel(&mut rx0);
        let msgs1 = drain_channel(&mut rx1);
        assert!(
            has_calibration_start(&msgs0),
            "two-player: slot 0 must receive calibration_start after both connect; got: {:?}",
            msgs0
        );
        assert!(
            has_calibration_start(&msgs1),
            "two-player: slot 1 must receive calibration_start after both connect; got: {:?}",
            msgs1
        );
    }

    /// Idempotency: solo player reconnects after match has started — no second calibration_start.
    #[test]
    fn solo_reconnect_after_match_started_does_not_resend_calibration_start() {
        let mut state = make_state();
        // Simulate match already in progress (round_start_time is set)
        state.round_start_time = Some(std::time::Instant::now());

        let (tx0, mut rx0) = mpsc::channel::<String>(16);
        let (r_tx, r_rx) = tokio::sync::oneshot::channel();
        handle_cmd(&mut state, RoomCmd::PlayerConnect { slot: 0, tx: tx0, reply: r_tx, solo: true });
        drop(r_rx);

        let msgs = drain_channel(&mut rx0);
        assert!(
            !has_calibration_start(&msgs),
            "solo reconnect after match start must NOT re-send calibration_start; got: {:?}",
            msgs
        );
    }
}
