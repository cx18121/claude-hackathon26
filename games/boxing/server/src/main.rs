use boxing_plugin::{BoxingPlugin, BoxingConfig, Difficulty};
use engine_core::{run, EngineConfig};
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let plugin = BoxingPlugin::new(BoxingConfig {
        hp: 800,
        round_secs: 90.0,
        max_wins: 3,
        bot_difficulty: Difficulty::Normal,
    });
    run(Arc::new(plugin), EngineConfig {
        port: 8001,
        client_dist: "games/boxing/client/dist".to_string(),
        game_name: "boxing".to_string(),
    })
    .await;
}
