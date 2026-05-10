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
    pub game_type: String,
}

impl RoomHandle {
    pub fn is_expired(&self) -> bool {
        if !self.match_over.load(std::sync::atomic::Ordering::Relaxed) {
            return false;
        }
        // WR-06: recover gracefully from a poisoned mutex — a panic in any
        // prior holder must not propagate panic into the expiry task and
        // poison every subsequent expiry check. We treat a poisoned lock
        // as "no expiry timestamp recorded" (false) so the room stays
        // alive until normal cleanup catches it.
        let guard = match self.last_player_disconnected_at.lock() {
            Ok(g) => g,
            Err(poisoned) => {
                tracing::warn!(
                    "is_expired: recovering from poisoned last_player_disconnected_at mutex"
                );
                poisoned.into_inner()
            }
        };
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
    pub fn create_room(&self, room_code: String, plugin: Arc<dyn GamePlugin + Send + Sync>, game_type: String) -> String {
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
                    let mut state = RoomState::new(
                        code.clone(),
                        plugin.max_wins(), // CR-02: use value from plugin config
                        pose_tx.clone(),
                        game_tx.clone(),
                        Arc::clone(&match_over_flag),
                        Arc::clone(&last_disconnect),
                        Arc::clone(&plugin),
                        plugin.game_type().to_string(),
                    );
                    // Spawn commentary task now (inside tokio runtime context) and wire into state.
                    state.commentary_tx = Some(crate::commentator::spawn(game_tx.clone(), code.clone()));
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
                        game_type,
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

    /// Returns the game_type for a room without holding DashMap guard across await.
    pub fn get_room_game_type(&self, code: &str) -> Option<String> {
        self.rooms.get(code).map(|h| h.game_type.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use boxing_plugin::{BoxingPlugin, BoxingConfig, Difficulty};

    fn boxing_plugin() -> Arc<dyn GamePlugin + Send + Sync> {
        Arc::new(BoxingPlugin::new(BoxingConfig {
            hp: 100, round_secs: 10.0, max_wins: 1, bot_difficulty: Difficulty::Normal,
        }))
    }

    #[tokio::test]
    async fn create_room_uses_provided_code() {
        let mgr = RoomManager::new();
        let code = mgr.create_room("TESTAB".to_string(), boxing_plugin(), "boxing".to_string());
        assert_eq!(code, "TESTAB");
        assert!(mgr.rooms.contains_key("TESTAB"), "room must be stored under provided code");
    }

    #[tokio::test]
    async fn create_room_collision_generates_new_code() {
        let mgr = RoomManager::new();
        // Occupy "AAAABB" first
        let first = mgr.create_room("AAAABB".to_string(), boxing_plugin(), "boxing".to_string());
        assert_eq!(first, "AAAABB");
        // Request the same code — should get a different 6-char random code
        let second = mgr.create_room("AAAABB".to_string(), boxing_plugin(), "boxing".to_string());
        assert_ne!(second, "AAAABB", "collision must produce a different code");
        assert_eq!(second.len(), 6);
        assert!(second.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[tokio::test]
    async fn create_room_stores_lookup_entry() {
        let mgr = RoomManager::new();
        let code = mgr.create_room("LOOKUP".to_string(), boxing_plugin(), "boxing".to_string());
        assert!(mgr.get_cmd_tx(&code).is_some(), "get_cmd_tx must find newly created room");
    }

    #[tokio::test]
    async fn room_not_expired_when_match_not_over() {
        let mgr = RoomManager::new();
        let code = mgr.create_room("EXPIRY".to_string(), boxing_plugin(), "boxing".to_string());
        let handle = mgr.rooms.get(&code).unwrap();
        assert!(!handle.is_expired(), "fresh room must not be expired");
    }

    #[tokio::test]
    async fn room_not_expired_when_disconnect_is_recent() {
        let mgr = RoomManager::new();
        let code = mgr.create_room("RECENT".to_string(), boxing_plugin(), "boxing".to_string());
        {
            let handle = mgr.rooms.get(&code).unwrap();
            // Simulate match over + player just disconnected
            handle.match_over.store(true, std::sync::atomic::Ordering::Relaxed);
            *handle.last_player_disconnected_at.lock().unwrap() = Some(std::time::Instant::now());
        }
        let handle = mgr.rooms.get(&code).unwrap();
        assert!(!handle.is_expired(), "room with recent disconnect must not expire for 10 minutes");
    }

    #[tokio::test]
    async fn subscribe_spectator_returns_none_for_missing_room() {
        let mgr = RoomManager::new();
        assert!(mgr.subscribe_spectator("NOPE00").is_none());
    }

    #[tokio::test]
    async fn subscribe_spectator_returns_channels_for_existing_room() {
        let mgr = RoomManager::new();
        let code = mgr.create_room("SPECTR".to_string(), boxing_plugin(), "boxing".to_string());
        assert!(mgr.subscribe_spectator(&code).is_some());
    }
}

/// Background task: scan for expired rooms every 60 seconds and remove them (D-08, ENG-13).
///
/// WR-06: previously this iterated `rooms.iter()` and called `is_expired()`
/// inside the filter closure. `dashmap::iter()` holds a shard read-lock for
/// the lifetime of each yielded entry, and `is_expired()` takes a
/// `std::sync::Mutex` — so the predicate held both a DashMap shard read
/// lock AND a per-room mutex simultaneously. That pairing creates a
/// deadlock invariant for any caller that takes them in the opposite
/// order, plus a poisoned-mutex panic propagation path.
///
/// Refactored to a two-phase scan: snapshot all candidate keys first
/// (releasing every shard lock as the iterator drops), then re-acquire
/// each key individually via `rooms.get()` for the `is_expired()` check.
/// Each `get()` holds the shard lock only for the duration of that one
/// call, and `is_expired()` runs against the per-room mutex without an
/// outer DashMap lock alive.
pub async fn expiry_task(rooms: Arc<DashMap<String, RoomHandle>>) {
    let mut interval = tokio::time::interval(Duration::from_secs(60));
    loop {
        interval.tick().await;
        // Phase 1: snapshot the current set of keys. The iter() lock is
        // released as soon as `candidates` is fully populated.
        let candidates: Vec<String> = rooms.iter().map(|e| e.key().clone()).collect();
        // Phase 2: per-key expiry check. Each rooms.get() acquires and
        // releases its shard lock independently; is_expired() runs under
        // its own per-room mutex with no outer lock held.
        let expired_codes: Vec<String> = candidates
            .into_iter()
            .filter(|code| rooms.get(code).map(|h| h.is_expired()).unwrap_or(false))
            .collect();
        for code in expired_codes {
            if let Some((_, handle)) = rooms.remove(&code) {
                handle.join_handle.abort();  // ENG-13
                tracing::info!("room {} expired and removed", code);
            }
        }
    }
}
