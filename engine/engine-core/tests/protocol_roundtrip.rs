// Golden-file roundtrip tests for all wire message types.
// Each test deserializes a fixture JSON, re-serializes it, and asserts key fields.
// Fixtures live at engine-core/tests/fixtures/*.json
// Run: cargo test --test protocol_roundtrip
use engine_core::protocol::*;
use std::fs;

fn fixture(name: &str) -> String {
    let path = format!(
        "{}/tests/fixtures/{}.json",
        env!("CARGO_MANIFEST_DIR"),
        name
    );
    fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("fixture missing: {path} — run scripts/capture_fixtures.py first"))
}

fn assert_type_field(json: &serde_json::Value, expected: &str) {
    assert_eq!(
        json["type"].as_str().expect("type field must be a string"),
        expected,
        "type field mismatch"
    );
}

#[test]
fn msg_ping_roundtrip() {
    let raw = fixture("msg_ping");
    let msg: MsgPing = serde_json::from_str(&raw).expect("deserialize msg_ping");
    let re = serde_json::to_string(&msg).expect("serialize");
    let orig: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let round: serde_json::Value = serde_json::from_str(&re).unwrap();
    assert_type_field(&round, "ping");
    assert_eq!(orig["t"], round["t"]);
}

#[test]
fn msg_pong_roundtrip() {
    let raw = fixture("msg_pong");
    let msg: MsgPong = serde_json::from_str(&raw).expect("deserialize msg_pong");
    let re = serde_json::to_string(&msg).expect("serialize");
    let round: serde_json::Value = serde_json::from_str(&re).unwrap();
    assert_type_field(&round, "pong");
}

#[test]
fn msg_joined_roundtrip() {
    let raw = fixture("msg_joined");
    let msg: MsgJoined = serde_json::from_str(&raw).expect("deserialize");
    let re = serde_json::to_string(&msg).expect("serialize");
    let orig: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let round: serde_json::Value = serde_json::from_str(&re).unwrap();
    assert_type_field(&round, "joined");
    assert_eq!(orig["room_code"], round["room_code"]);
    assert_eq!(orig["player_slot"], round["player_slot"]);
    assert_eq!(orig["opponent_connected"], round["opponent_connected"]);
    assert_eq!(orig["game_type"], round["game_type"]);
}

#[test]
fn msg_pose_frame_roundtrip() {
    let raw = fixture("msg_pose_frame");
    let msg: MsgPoseFrame = serde_json::from_str(&raw).expect("deserialize");
    let re = serde_json::to_string(&msg).expect("serialize");
    let orig: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let round: serde_json::Value = serde_json::from_str(&re).unwrap();
    assert_type_field(&round, "pose_frame");
    assert_eq!(
        orig["keypoints"].as_array().unwrap().len(),
        round["keypoints"].as_array().unwrap().len()
    );
}

#[test]
fn msg_game_state_roundtrip() {
    let raw = fixture("msg_game_state");
    let msg: MsgGameState = serde_json::from_str(&raw).expect("deserialize");
    let re = serde_json::to_string(&msg).expect("serialize");
    let orig: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let round: serde_json::Value = serde_json::from_str(&re).unwrap();
    assert_type_field(&round, "game_state");
    assert_eq!(orig["hp"], round["hp"]);
    assert_eq!(orig["tick"], round["tick"]);
    // wins must survive roundtrip (FIX-02)
    assert!(round["wins"].is_array(), "wins must be an array");
    assert_eq!(round["wins"].as_array().unwrap().len(), 2, "wins must have 2 elements");
    // poses must be an array of two arrays
    assert!(round["poses"].is_array());
    assert_eq!(round["poses"].as_array().unwrap().len(), 2);
}

#[test]
fn msg_lobby_update_roundtrip() {
    let raw = fixture("msg_lobby_update");
    let msg: MsgLobbyUpdate = serde_json::from_str(&raw).expect("deserialize");
    let re = serde_json::to_string(&msg).expect("serialize");
    let round: serde_json::Value = serde_json::from_str(&re).unwrap();
    assert_type_field(&round, "lobby_update");
}

#[test]
fn msg_round_start_roundtrip() {
    let raw = fixture("msg_round_start");
    let msg: MsgRoundStart = serde_json::from_str(&raw).expect("deserialize");
    let re = serde_json::to_string(&msg).expect("serialize");
    let round: serde_json::Value = serde_json::from_str(&re).unwrap();
    assert_type_field(&round, "round_start");
    assert_eq!(round["round_number"].as_u64().unwrap(), 1);
}

#[test]
fn msg_round_end_winner_roundtrip() {
    let raw = fixture("msg_round_end");
    let msg: MsgRoundEnd = serde_json::from_str(&raw).expect("deserialize");
    let re = serde_json::to_string(&msg).expect("serialize");
    let orig: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let round: serde_json::Value = serde_json::from_str(&re).unwrap();
    assert_type_field(&round, "round_end");
    assert_eq!(orig["winner"], round["winner"]);
    assert_eq!(orig["final_hp"], round["final_hp"]);
}

#[test]
fn msg_round_end_draw_roundtrip() {
    let raw = fixture("msg_round_end_draw");
    let msg: MsgRoundEnd = serde_json::from_str(&raw).expect("deserialize draw");
    let re = serde_json::to_string(&msg).expect("serialize");
    let round: serde_json::Value = serde_json::from_str(&re).unwrap();
    assert_type_field(&round, "round_end");
    // winner must be null for a draw
    assert!(round["winner"].is_null(), "draw winner must serialize as null, got {}", round["winner"]);
}

#[test]
fn msg_pose_update_roundtrip() {
    let raw = fixture("msg_pose_update");
    let msg: MsgPoseUpdate = serde_json::from_str(&raw).expect("deserialize");
    let re = serde_json::to_string(&msg).expect("serialize");
    let round: serde_json::Value = serde_json::from_str(&re).unwrap();
    assert_type_field(&round, "pose_update");
}

#[test]
fn msg_calibration_done_roundtrip() {
    let raw = fixture("msg_calibration_done");
    let msg: MsgCalibrationDone = serde_json::from_str(&raw).expect("deserialize");
    let re = serde_json::to_string(&msg).expect("serialize");
    let round: serde_json::Value = serde_json::from_str(&re).unwrap();
    assert_type_field(&round, "calibration_done");
}

#[test]
fn msg_match_start_roundtrip() {
    let raw = fixture("msg_match_start");
    let msg: MsgMatchStart = serde_json::from_str(&raw).expect("deserialize");
    let re = serde_json::to_string(&msg).expect("serialize");
    let round: serde_json::Value = serde_json::from_str(&re).unwrap();
    assert_type_field(&round, "match_start");
}

#[test]
fn msg_match_end_roundtrip() {
    let raw = fixture("msg_match_end");
    let msg: MsgMatchEnd = serde_json::from_str(&raw).expect("deserialize");
    let re = serde_json::to_string(&msg).expect("serialize");
    let orig: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let round: serde_json::Value = serde_json::from_str(&re).unwrap();
    assert_type_field(&round, "match_end");
    assert_eq!(orig["winner"], round["winner"]);
}

#[test]
fn msg_player_disconnected_roundtrip() {
    let raw = fixture("msg_player_disconnected");
    let msg: MsgPlayerDisconnected = serde_json::from_str(&raw).expect("deserialize");
    let re = serde_json::to_string(&msg).expect("serialize");
    let orig: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let round: serde_json::Value = serde_json::from_str(&re).unwrap();
    assert_type_field(&round, "player_disconnected");
    assert_eq!(orig["player"], round["player"]);
}

#[test]
fn msg_calibration_start_roundtrip() {
    let raw = fixture("msg_calibration_start");
    let msg: MsgCalibrationStart = serde_json::from_str(&raw).expect("deserialize");
    let re = serde_json::to_string(&msg).expect("serialize");
    let round: serde_json::Value = serde_json::from_str(&re).unwrap();
    assert_type_field(&round, "calibration_start");
}

#[test]
fn msg_rematch_start_roundtrip() {
    let raw = fixture("msg_rematch_start");
    let msg: MsgRematchStart = serde_json::from_str(&raw).expect("deserialize");
    let re = serde_json::to_string(&msg).expect("serialize");
    let round: serde_json::Value = serde_json::from_str(&re).unwrap();
    assert_type_field(&round, "rematch_start");
}

#[test]
fn msg_you_were_hit_roundtrip() {
    let raw = fixture("msg_you_were_hit");
    let msg: MsgYouWereHit = serde_json::from_str(&raw).expect("deserialize");
    let re = serde_json::to_string(&msg).expect("serialize");
    let orig: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let round: serde_json::Value = serde_json::from_str(&re).unwrap();
    assert_type_field(&round, "you_were_hit");
    assert_eq!(orig["region"], round["region"]);
    assert_eq!(orig["damage"], round["damage"]);
}

#[test]
fn inbound_mobile_msg_discriminator() {
    // All 5 inbound variants must deserialize via InboundMobileMsg
    let cases = vec![
        r#"{"type":"join","room_code":"ABC123","player_slot":1}"#,
        r#"{"type":"pose_frame","timestamp":1746.0,"keypoints":[]}"#,
        r#"{"type":"calibration_done","reference_velocity":4.5}"#,
        r#"{"type":"ping","t":1746172800.0}"#,
        r#"{"type":"pong","t":1746172800.0}"#,
    ];
    for raw in cases {
        let _: InboundMobileMsg = serde_json::from_str(raw)
            .unwrap_or_else(|e| panic!("failed to parse inbound: {raw}\nerror: {e}"));
    }
}
