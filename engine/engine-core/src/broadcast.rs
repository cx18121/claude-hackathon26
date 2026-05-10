use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::broadcast;
use crate::room::RoomSnapshot;

/// Forward game_rx and pose_rx to the WebSocket until either channel closes.
/// Handles RecvError::Lagged non-fatally (Pitfall 2 in RESEARCH.md).
pub async fn forward_broadcast_to_spectator(
    mut ws_sink: futures_util::stream::SplitSink<WebSocket, Message>,
    mut game_rx: broadcast::Receiver<String>,
    mut pose_rx: broadcast::Receiver<String>,
) {
    loop {
        // biased: prioritise game_rx (authoritative game state) over pose_rx.
        // Without biased, sustained 120-msg/sec pose traffic starves game_state
        // delivery to spectators under high-frequency pose bursts (WR-03).
        tokio::select! {
            biased;
            result = game_rx.recv() => match result {
                Ok(msg) => {
                    if ws_sink.send(Message::Text(msg.into())).await.is_err() {
                        break;
                    }
                }
                Err(RecvError::Lagged(n)) => {
                    // Non-fatal: receiver auto-repositioned at oldest available message (Pitfall 2)
                    tracing::warn!("spectator game_rx lagged by {} messages, continuing", n);
                }
                Err(RecvError::Closed) => break,
            },
            result = pose_rx.recv() => match result {
                Ok(msg) => {
                    if ws_sink.send(Message::Text(msg.into())).await.is_err() {
                        break;
                    }
                }
                Err(RecvError::Lagged(n)) => {
                    tracing::warn!("spectator pose_rx lagged by {} messages, continuing", n);
                }
                Err(RecvError::Closed) => break,
            },
        }
    }
}

/// Send the FIX-02 snapshot to a newly connected spectator.
/// Sends: lobby_update (always), then round_start + game_state if match is in progress.
/// game_state includes wins field (FIX-02) so overlay win counter survives reconnect.
pub async fn send_snapshot(
    ws_sink: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    snapshot: RoomSnapshot,
) -> bool {
    // lobby_update always sent
    if let Ok(json) = serde_json::to_string(&snapshot.lobby_update) {
        if ws_sink.send(Message::Text(json.into())).await.is_err() {
            return false;
        }
    }
    // round_start + game_state only if match in progress
    if let (Some(rs), Some(gs)) = (snapshot.round_start, snapshot.game_state) {
        if let Ok(json) = serde_json::to_string(&rs) {
            if ws_sink.send(Message::Text(json.into())).await.is_err() {
                return false;
            }
        }
        if let Ok(json) = serde_json::to_string(&gs) {
            if ws_sink.send(Message::Text(json.into())).await.is_err() {
                return false;
            }
        }
    }
    // Send plugin snapshot (e.g., dance_snapshot) after game_state, before live broadcast
    if let Some(snapshot_payload) = snapshot.plugin_snapshot {
        if let Ok(json) = serde_json::to_string(&snapshot_payload) {
            if ws_sink.send(Message::Text(json.into())).await.is_err() {
                return false;
            }
        }
    }
    true
}
