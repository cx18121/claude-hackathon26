use crate::room::RoomState;

/// Game tick stub — full implementation in Plan 04.
/// This is called from room_actor's 60Hz interval select! branch.
///
/// Plan 04 will implement:
/// - input_delay::compute_cutoff to drain pose buffers with RTT fairness (ENG-06)
/// - hit detection via game plugin trait
/// - round lifecycle (warmup gate, round end, match end)
pub fn game_tick(_state: &mut RoomState) {
    // Plan 04: call crate::input_delay::compute_cutoff(
    //   &state.players[0].rtt_samples,
    //   &state.players[1].rtt_samples,
    //   crate::input_delay::MAX_INPUT_DELAY_MS,
    // ) to get cutoff Instant, then drain pose_buffer into processed_frames
}
