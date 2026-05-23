use fps_boxing_plugin::{FPSBoxingPlugin, FPSBoxingConfig};
use engine_core::{run, EngineConfig};
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let plugin = FPSBoxingPlugin::new(FPSBoxingConfig {
        hp: 800,
        round_secs: 90.0,
        max_wins: 3,
    });
    run(Arc::new(plugin), EngineConfig {
        port: 8003,
        client_dist: "games/fps-boxing/client/dist".to_string(),
        game_name: "fps_boxing".to_string(),
    })
    .await;
}
