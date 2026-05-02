use std::sync::Arc;
use std::time::{Duration, Instant};
use dashmap::DashMap;
use rand::{distributions::Alphanumeric, Rng};
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;

use crate::room::{RoomCmd, RoomState, room_actor};

pub struct RoomHandle {
    pub cmd_tx: mpsc::Sender<RoomCmd>,
    pub join_handle: JoinHandle<()>,      // ENG-13: abort on teardown
    pub match_over: std::sync::atomic::AtomicBool,
    pub last_player_disconnected_at: std::sync::Mutex<Option<Instant>>,
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
    pub fn create_room(&self, room_code: String) -> String {
        // If the requested code is free, use it directly.
        // Otherwise fall back to generating a new unique code.
        let code = if !self.rooms.contains_key(&room_code) {
            room_code
        } else {
            loop {
                let generated: String = rand::thread_rng()
                    .sample_iter(&Alphanumeric)
                    .take(6)
                    .map(|c| char::from(c).to_ascii_uppercase())
                    .collect();
                if !self.rooms.contains_key(&generated) {
                    break generated;
                }
            }
        };
        // Create channels
        let (cmd_tx, cmd_rx) = mpsc::channel::<RoomCmd>(128);
        let (pose_tx, _) = broadcast::channel::<String>(64);   // ENG-08 fast path
        let (game_tx, _) = broadcast::channel::<String>(128);  // ENG-08 slow path
        let state = RoomState::new(
            code.clone(),
            2, // default max_wins
            pose_tx.clone(),
            game_tx.clone(),
        );
        // Spawn actor — DO NOT hold DashMap guard across this spawn (Pitfall 4)
        let join_handle = tokio::spawn(room_actor(cmd_rx, state));
        let handle = RoomHandle {
            cmd_tx,
            join_handle,
            match_over: std::sync::atomic::AtomicBool::new(false),
            last_player_disconnected_at: std::sync::Mutex::new(None),
            pose_tx,
            game_tx,
            created_at: Instant::now(),
        };
        self.rooms.insert(code.clone(), handle);
        tracing::info!("room {} created", code);
        code
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
