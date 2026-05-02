use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const MAX_INPUT_DELAY_MS: f64 = 60.0;

/// Record a pong arrival and return the measured RTT in milliseconds.
/// `original_t` is the Unix float seconds value from the ping message.
/// Keeps only the last 10 samples.
pub fn record_pong(samples: &mut Vec<f64>, original_t: f64) -> f64 {
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64();
    let rtt = (now_secs - original_t) * 1000.0;
    samples.push(rtt);
    if samples.len() > 10 {
        let drain_to = samples.len() - 10;
        samples.drain(0..drain_to);
    }
    rtt
}

/// Median RTT of samples in milliseconds. Returns 0.0 for empty samples.
pub fn median_rtt(samples: &[f64]) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    let mut s = samples.to_vec();
    s.sort_by(f64::total_cmp);
    let mid = s.len() / 2;
    if s.len() % 2 == 0 {
        (s[mid - 1] + s[mid]) / 2.0
    } else {
        s[mid]
    }
}

/// Compute the fairness input delay cutoff.
/// Returns (cutoff_instant, rtt_a_ms, rtt_b_ms).
/// The cutoff is `now - max(rtt_a, rtt_b).min(max_delay_ms)` ms in the past.
/// Frames with arrived_at <= cutoff are "released" (both players' frames are available).
pub fn compute_cutoff(
    samples_p1: &[f64],
    samples_p2: &[f64],
    max_delay_ms: f64,
) -> (Instant, f64, f64) {
    let rtt_a = median_rtt(samples_p1);
    let rtt_b = median_rtt(samples_p2);
    let max_rtt_ms = rtt_a.max(rtt_b).min(max_delay_ms);
    let cutoff = Instant::now()
        .checked_sub(Duration::from_secs_f64(max_rtt_ms / 1000.0))
        .unwrap_or_else(Instant::now);
    (cutoff, rtt_a, rtt_b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn median_rtt_empty() {
        assert_eq!(median_rtt(&[]), 0.0);
    }

    #[test]
    fn median_rtt_odd() {
        assert_eq!(median_rtt(&[10.0, 30.0, 20.0]), 20.0);
    }

    #[test]
    fn median_rtt_even() {
        assert_eq!(median_rtt(&[10.0, 20.0, 30.0, 40.0]), 25.0);
    }

    #[test]
    fn record_pong_caps_at_10() {
        let mut samples = vec![1.0; 15];
        record_pong(&mut samples, 0.0); // forces real now - 0 which will be large
        // After recording, len should be <= 10
        assert!(samples.len() <= 10, "samples must be capped at 10, got {}", samples.len());
    }

    #[test]
    fn compute_cutoff_caps_at_max_delay() {
        // 200ms RTT but max is 60ms — cutoff should only go back 60ms
        let samples_p1 = vec![200.0];
        let samples_p2 = vec![200.0];
        let (cutoff, rtt_a, _rtt_b) = compute_cutoff(&samples_p1, &samples_p2, 60.0);
        assert_eq!(rtt_a, 200.0);
        // cutoff should be approximately 60ms ago (Instant::now() - 60ms)
        let elapsed = cutoff.elapsed();
        // elapsed since cutoff should be roughly 60ms (with some tolerance)
        assert!(elapsed.as_millis() <= 80, "cutoff too far back: {}ms", elapsed.as_millis());
    }
}
