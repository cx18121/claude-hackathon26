use dance_plugin::{DancePlugin, DanceConfig};
use engine_core::{run, EngineConfig};
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let plugin = DancePlugin::new(DanceConfig { max_wins: 3 });
    run(Arc::new(plugin), EngineConfig {
        port: 8002,
        client_dist: "games/dance/client/dist".to_string(),
        game_name: "dance".to_string(),
    })
    .await;
}
