use std::collections::VecDeque;
use std::time::Instant;
use tokio::sync::{broadcast, mpsc, oneshot};
use crate::protocol::{MsgPoseFrame, MsgLobbyUpdate, MsgGameState};

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
    pub max_wins: u32,
    pub hp: [u32; 2],
    // Broadcast channel senders (rx subscribed by spectator handlers and outbound tasks)
    pub pose_tx: broadcast::Sender<String>,          // fast path (ENG-07, ENG-08)
    pub game_tx: broadcast::Sender<String>,          // slow path (ENG-08)
}

impl RoomState {
    pub fn new(code: String, max_wins: u32, pose_tx: broadcast::Sender<String>, game_tx: broadcast::Sender<String>) -> Self {
        Self {
            code,
            players: [PlayerSlot::new(), PlayerSlot::new()],
            round_number: 1,
            wins: [0, 0],
            round_start_time: None,
            match_over: false,
            max_wins,
            hp: [800, 800],
            pose_tx,
            game_tx,
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
}

pub enum RoomCmd {
    PlayerConnect {
        slot: usize,
        tx: mpsc::Sender<String>,
        reply: oneshot::Sender<Option<ConnectResult>>,
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
    if state.round_start_time.is_some() {
        let rs = MsgRoundStart {
            msg_type: "round_start".to_string(),
            round_number: state.round_number,
        };
        let elapsed = state.round_start_time.map_or(0.0, |t| t.elapsed().as_secs_f64());
        let remaining = (90.0_f64 - elapsed).max(0.0);
        let gs = MsgGameState {
            msg_type: "game_state".to_string(),
            tick: 0,
            hp: (state.hp[0], state.hp[1]),
            wins: (state.wins[0], state.wins[1]),  // FIX-02: include wins in snapshot
            poses: (vec![], vec![]),
            recent_hits: vec![],
            high_latency: false,
            remaining_time: remaining,
            max_wins: state.max_wins,
        };
        RoomSnapshot { lobby_update: lobby, round_start: Some(rs), game_state: Some(gs) }
    } else {
        RoomSnapshot { lobby_update: lobby, round_start: None, game_state: None }
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
        RoomCmd::PlayerConnect { slot, tx, reply } => {
            if state.players[slot].connected {
                let _ = reply.send(None);
                return;
            }
            state.players[slot].tx = Some(tx);
            state.players[slot].connected = true;
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
            // If both players are now connected, send calibration_start to both (ENG-11)
            // Mobile clients wait for this message before transitioning out of lobby phase.
            if state.players[0].connected && state.players[1].connected {
                use crate::protocol::MsgCalibrationStart;
                if let Ok(json) = serde_json::to_string(&MsgCalibrationStart {
                    msg_type: "calibration_start".to_string(),
                }) {
                    send_to_slot(state, 0, &json);
                    send_to_slot(state, 1, &json);
                    tracing::info!("room {} calibration started", state.code);
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
            tracing::info!("player {} calibrated ref_vel={:.2}", slot + 1, reference_velocity);
            // Check if both players are calibrated
            let both_calibrated = state.players.iter().all(|p| p.reference_velocity.is_some());
            if both_calibrated && state.round_start_time.is_none() {
                // Start match — game_loop will handle warmup gate
                use crate::protocol::*;
                if let Ok(json) = serde_json::to_string(&MsgMatchStart { msg_type: "match_start".to_string() }) {
                    broadcast_all(state, &json);
                }
                if let Ok(json) = serde_json::to_string(&MsgRoundStart { msg_type: "round_start".to_string(), round_number: state.round_number }) {
                    broadcast_all(state, &json);
                }
                state.round_start_time = Some(Instant::now());
                tracing::info!("room {} match started", state.code);
            }
        }
        RoomCmd::RecordPong { slot, original_t } => {
            crate::input_delay::record_pong(&mut state.players[slot].rtt_samples, original_t);
        }
        RoomCmd::PlayerDisconnect { slot } => {
            state.players[slot].connected = false;
            state.players[slot].tx = None;
            tracing::info!("player {} disconnected from room {}", slot + 1, state.code);
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
