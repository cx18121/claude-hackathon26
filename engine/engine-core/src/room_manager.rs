use std::sync::Arc;
use std::time::{Duration, Instant};
use dashmap::DashMap;
use dashmap::mapref::entry::Entry;
use rand::{distributions::Alphanumeric, Rng};
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;

use crate::room::{RoomCmd, RoomState, room_actor};
use plugin_trait::GamePlugin;

pub struct RoomHandle {
    pub cmd_tx: mpsc::Sender<RoomCmd>,
    pub join_handle: JoinHandle<()>,      // ENG-13: abort on teardown
    /// Shared Arc with RoomState — set to true by game_loop when match ends (CR-03).
    pub match_over: Arc<std::sync::atomic::AtomicBool>,
    /// Shared Arc with RoomState — set when last player disconnects (CR-01).
    pub last_player_disconnected_at: Arc<std::sync::Mutex<Option<Instant>>>,
    pub pose_tx: broadcast::Sender<String>,
    pub game_tx: broadcast::Sender<String>,
    pub created_at: Instant,
}

impl RoomHandle {
    pub fn is_expired(&self) -> bool {
        if !self.match_over.load(std::sync::atomic::Ordering::Relaxed) {
            return false;
        }
        let guard = self.last_player_disconnected_at.lock().unwrap();
        guard.map_or(false, |t| t.elapsed() > Duration::from_secs(600)) // 10 minutes
    }
}

pub struct RoomManager {
    pub rooms: Arc<DashMap<String, RoomHandle>>,
}

impl RoomManager {
    pub fn new() -> Self {
        Self { rooms: Arc::new(DashMap::new()) }
    }

    /// Create a room with the given room code (or generate a random one if
    /// the provided code is already taken). Returns the actual room code used.
    /// The caller provides the client-supplied 6-char code from the URL; we
    /// use it directly if available to match Python server on-demand semantics.
    ///
    /// Uses DashMap entry API to atomically claim the slot and prevent TOCTOU
    /// races between concurrent join requests for the same new room (WR-01).
    pub fn create_room(&self, room_code: String, plugin: Arc<dyn GamePlugin + Send + Sync>) -> String {
        // Candidate codes: try the requested code first, then random fallbacks.
        let mut candidate = room_code.clone();
        loop {
            match self.rooms.entry(candidate.clone()) {
                Entry::Vacant(slot) => {
                    // Atomically claimed — build channels, state, and actor.
                    let code = candidate.clone();
                    let (cmd_tx, cmd_rx) = mpsc::channel::<RoomCmd>(128);
                    let (pose_tx, _) = broadcast::channel::<String>(64);   // ENG-08 fast path
                    let (game_tx, _) = broadcast::channel::<String>(128);  // ENG-08 slow path
                    // Shared flag between RoomState and RoomHandle — set by game_loop on match end (CR-03)
                    let match_over_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
                    // Shared disconnect timestamp between RoomState and RoomHandle — set when last player disconnects (CR-01)
                    let last_disconnect = Arc::new(std::sync::Mutex::new(None::<Instant>));
                    let state = RoomState::new(
                        code.clone(),
                        plugin.max_wins(), // CR-02: use value from plugin config
                        pose_tx.clone(),
                        game_tx.clone(),
                        Arc::clone(&match_over_flag),
                        Arc::clone(&last_disconnect),
                        Arc::clone(&plugin),
                    );
                    // Spawn actor — DO NOT hold DashMap guard across this spawn (Pitfall 4).
                    // We drop the entry guard after insert, so the guard is held only during insert.
                    let join_handle = tokio::spawn(room_actor(cmd_rx, state));
                    let handle = RoomHandle {
                        cmd_tx,
                        join_handle,
                        match_over: match_over_flag,
                        last_player_disconnected_at: last_disconnect,
                        pose_tx,
                        game_tx,
                        created_at: Instant::now(),
                    };
                    slot.insert(handle);
                    tracing::info!("room {} created", code);
                    return code;
                }
                Entry::Occupied(_) => {
                    // Slot occupied — generate a new random candidate and retry.
                    candidate = rand::thread_rng()
                        .sample_iter(&Alphanumeric)
                        .take(6)
                        .map(|c| char::from(c).to_ascii_uppercase())
                        .collect();
                }
            }
        }
    }

    /// Clone the cmd_tx for a room without holding the DashMap guard across await (Pitfall 4).
    pub fn get_cmd_tx(&self, code: &str) -> Option<mpsc::Sender<RoomCmd>> {
        self.rooms.get(code).map(|h| h.cmd_tx.clone())
    }

    /// Subscribe to a room's broadcast channels without holding DashMap guard.
    pub fn subscribe_spectator(&self, code: &str) -> Option<(broadcast::Receiver<String>, broadcast::Receiver<String>, mpsc::Sender<RoomCmd>)> {
        self.rooms.get(code).map(|h| {
            (h.game_tx.subscribe(), h.pose_tx.subscribe(), h.cmd_tx.clone())
        })
    }
}

/// Background task: scan for expired rooms every 60 seconds and remove them (D-08, ENG-13).
pub async fn expiry_task(rooms: Arc<DashMap<String, RoomHandle>>) {
    let mut interval = tokio::time::interval(Duration::from_secs(60));
    loop {
        interval.tick().await;
        let expired_codes: Vec<String> = rooms
            .iter()
            .filter(|entry| entry.value().is_expired())
            .map(|entry| entry.key().clone())
            .collect();
        for code in expired_codes {
            if let Some((_, handle)) = rooms.remove(&code) {
                handle.join_handle.abort();  // ENG-13
                tracing::info!("room {} expired and removed", code);
            }
        }
    }
}
