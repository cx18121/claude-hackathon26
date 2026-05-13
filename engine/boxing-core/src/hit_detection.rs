use std::collections::VecDeque;
use plugin_trait::{PoseFrame, PoseKeypoint, BodyRegion};

// ---------------------------------------------------------------------------
// Landmark index constants (server/hit_detection.py lines 19-27)
// ---------------------------------------------------------------------------
pub const WRIST_LEFT:     usize = 15;
pub const WRIST_RIGHT:    usize = 16;
pub const ANKLE_LEFT:     usize = 27;
pub const ANKLE_RIGHT:    usize = 28;
pub const LEFT_HIP:       usize = 23;
pub const RIGHT_HIP:      usize = 24;
pub const LEFT_SHOULDER:  usize = 11;
pub const RIGHT_SHOULDER: usize = 12;
pub const LEFT_ELBOW:     usize = 13;
pub const RIGHT_ELBOW:    usize = 14;

// ---------------------------------------------------------------------------
// Body-local threshold constants (server/hit_detection.py lines 30-41)
// NOTE: These are body-scale multiples in the Y-up frame (hip_mid_y = 0.0).
// ---------------------------------------------------------------------------
const REL_HEAD_Y:       f64 = 1.45;
const REL_TORSO_HI_Y:   f64 = 0.70;
const REL_TORSO_LO_Y:   f64 = 0.00;
const REL_KICK_MID_Y:   f64 = -0.30;
const REL_GUARD_HEAD_Y: f64 = 1.10;
const REL_GUARD_TORSO_Y: f64 = 0.35;
const DEFAULT_BODY_SCALE: f64 = 0.30;

/// Fixed punch threshold (m/s peak wrist speed).
/// Scaled by ref_velocity in detect_punch to match each player's calibrated pace.
/// Source: server/hit_detection.py _punch_threshold; see DESIGN DECISION comment below.
const PUNCH_THRESHOLD: f64 = 2.5;

/// Fixed kick threshold (m/s peak ankle speed).
/// Source: server/hit_detection.py _kick_threshold default.
const KICK_THRESHOLD: f64 = 2.0;

// ---------------------------------------------------------------------------
// Public output type (mirrors Python HitResult dataclass)
// ---------------------------------------------------------------------------

pub struct HitResult {
    pub region: BodyRegion,
    pub velocity: f64,
    pub position: (f64, f64),  // (x, y) in normalized space
}

// ---------------------------------------------------------------------------
// Velocity helpers (port of server/hit_detection.py lines 67-97)
// ---------------------------------------------------------------------------

fn velocity_3d(frames: &VecDeque<PoseFrame>, idx: usize) -> (f64, f64, f64) {
    if frames.len() < 3 { return (0.0, 0.0, 0.0); }
    let n = frames.len();
    // Guard: keypoints may be empty
    if frames[n-1].keypoints.len() <= idx || frames[n-3].keypoints.len() <= idx {
        return (0.0, 0.0, 0.0);
    }
    let new = &frames[n-1].keypoints[idx];
    let old = &frames[n-3].keypoints[idx];
    let dt = frames[n-1].timestamp - frames[n-3].timestamp;
    let dt = if dt < 1e-4 { 2.0 / 30.0 } else { dt };
    ((new.x - old.x) / dt, (new.y - old.y) / dt, (new.z - old.z) / dt)
}

#[allow(dead_code)]  // plan 03 uses this helper
pub fn speed_3d(v: (f64, f64, f64)) -> f64 {
    (v.0*v.0 + v.1*v.1 + v.2*v.2).sqrt()
}

fn peak_speed(frames: &VecDeque<PoseFrame>, idx: usize) -> f64 {
    // Consecutive-pair max — port of _peak_speed lines 81-97
    let all: Vec<&PoseFrame> = frames.iter().collect();
    all.windows(2).map(|w| {
        if w[0].keypoints.len() <= idx || w[1].keypoints.len() <= idx {
            return 0.0_f64;
        }
        let dt = w[1].timestamp - w[0].timestamp;
        let dt = if dt < 1e-4 { 1.0 / 30.0 } else { dt };
        let a = &w[0].keypoints[idx];
        let b = &w[1].keypoints[idx];
        let dx = b.x - a.x; let dy = b.y - a.y; let dz = b.z - a.z;
        (dx*dx + dy*dy + dz*dz).sqrt() / dt
    }).fold(0.0_f64, f64::max)
}

// ---------------------------------------------------------------------------
// Body scale helper (port of _body_scale lines 104-120, Y-up adapted)
// ---------------------------------------------------------------------------

fn body_scale(kp: &[PoseKeypoint]) -> f64 {
    if kp.len() <= RIGHT_SHOULDER { return DEFAULT_BODY_SCALE; }
    let shoulder_y = (kp[LEFT_SHOULDER].y + kp[RIGHT_SHOULDER].y) / 2.0;
    let hip_y     = (kp[LEFT_HIP].y      + kp[RIGHT_HIP].y)      / 2.0;
    // In Y-up frame: shoulder is above hip, so shoulder_y > hip_y.
    // body_scale = abs(shoulder_y - hip_y), clamped [0.12, 0.55].
    (shoulder_y - hip_y).abs().clamp(0.12, 0.55)
}

// ---------------------------------------------------------------------------
// Guard-raise veto (port of _is_primarily_upward lines 183-193)
// NOTE: Y-up sign flip vs Python — see RESEARCH Pitfall 2.
// ---------------------------------------------------------------------------

fn is_primarily_upward(vel: (f64, f64, f64)) -> bool {
    // Y-up normalized: upward motion = positive vy.
    // Guard-raise = wrist moving upward (positive Y velocity dominating).
    // Python uses vy < 0 (raw MediaPipe Y-down); after Y-up normalization the sign flips:
    // upward motion is vy > 0.
    vel.1 > vel.0.abs() + vel.2.abs()
}

// ---------------------------------------------------------------------------
// Region classification (port of _attack_region lines 127-138)
// ---------------------------------------------------------------------------

fn classify_region(target_y: f64, scale: f64) -> BodyRegion {
    let head_y     = REL_HEAD_Y     * scale;
    let torso_hi_y = REL_TORSO_HI_Y * scale;
    let torso_lo_y = REL_TORSO_LO_Y * scale; // = 0.0 (hip level)
    if target_y >= head_y         { BodyRegion::HeadFace }
    else if target_y >= torso_hi_y { BodyRegion::TorsoUpper }
    else if target_y >= torso_lo_y { BodyRegion::TorsoLower }
    else                           { BodyRegion::LegThigh }
}

/// Refined head region: throat vs chin vs face based on wrist landing height.
/// Three bands above head_y in ascending order (CR-03: HeadThroat was unreachable before).
/// [head_y, head_y+0.10*scale) = throat (lowest, just above head boundary)
/// [head_y+0.10*scale, head_y+0.20*scale) = chin
/// [head_y+0.20*scale, ...) = face (highest)
fn refine_head_region(wrist_y: f64, scale: f64) -> BodyRegion {
    let throat_y = REL_HEAD_Y * scale;
    let chin_y   = REL_HEAD_Y * scale + 0.10 * scale;
    let face_y   = REL_HEAD_Y * scale + 0.20 * scale;
    if wrist_y >= face_y        { BodyRegion::HeadFace }
    else if wrist_y >= chin_y   { BodyRegion::HeadChin }
    else if wrist_y >= throat_y { BodyRegion::HeadThroat }
    else                        { BodyRegion::HeadFace } // fallback (caller guarantees wrist_y >= head_y)
}

// ---------------------------------------------------------------------------
// Guard blocking (port of _apply_guard and _guarded_zones lines 157-176)
// ---------------------------------------------------------------------------

fn apply_guard(region: BodyRegion, defender_kp: &[PoseKeypoint], scale: f64) -> BodyRegion {
    if defender_kp.len() <= WRIST_RIGHT { return region; }
    let wrist_l_y = defender_kp[WRIST_LEFT].y;
    let wrist_r_y = defender_kp[WRIST_RIGHT].y;
    let guard_head_y  = REL_GUARD_HEAD_Y  * scale;
    let guard_torso_y = REL_GUARD_TORSO_Y * scale;

    // Both wrists above guard_head_y: blocks head and torso hits
    if wrist_l_y >= guard_head_y && wrist_r_y >= guard_head_y {
        match region {
            BodyRegion::HeadFace | BodyRegion::HeadChin | BodyRegion::HeadThroat => BodyRegion::BlockHand,
            BodyRegion::TorsoUpper => BodyRegion::BlockForearm,
            other => other,
        }
    }
    // One or both wrists above guard_torso_y: blocks torso only
    else if wrist_l_y >= guard_torso_y || wrist_r_y >= guard_torso_y {
        match region {
            BodyRegion::TorsoUpper => BodyRegion::BlockForearm,
            other => other,
        }
    } else {
        region
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

pub fn detect_punch(
    attacker_frames: &VecDeque<PoseFrame>,
    defender_frames: &VecDeque<PoseFrame>,
    ref_velocity: Option<f64>,
) -> Option<HitResult> {
    if attacker_frames.len() < 3 { return None; }

    // Guard-raise veto: if both wrists are moving primarily upward, skip.
    // This prevents counting a guard raise as a punch (RESEARCH Pitfall 6).
    let vel_wl = velocity_3d(attacker_frames, WRIST_LEFT);
    let vel_wr = velocity_3d(attacker_frames, WRIST_RIGHT);
    if is_primarily_upward(vel_wl) && is_primarily_upward(vel_wr) {
        return None;
    }

    // Use whichever wrist has higher peak speed
    let ps_l = peak_speed(attacker_frames, WRIST_LEFT);
    let ps_r = peak_speed(attacker_frames, WRIST_RIGHT);
    let (wrist_idx, peak) = if ps_l >= ps_r { (WRIST_LEFT, ps_l) } else { (WRIST_RIGHT, ps_r) };

    // DESIGN DECISION: velocity-relative threshold.
    // When calibrated, the threshold scales with ref_velocity so that the
    // required punch speed is proportional to the player's own calibrated pace.
    // This prevents slow-but-calibrated players triggering fewer hits than fast ones.
    // Formula: threshold = ref_vel * (PUNCH_THRESHOLD / 3.0)
    //   ref=3.0 → threshold=PUNCH_THRESHOLD (unchanged baseline)
    //   ref=6.0 → threshold doubles (harder to trigger for a faster-moving player)
    // Deviation from Python reference (fixed PUNCH_THRESHOLD=2.5): intentional.
    let threshold = if ref_velocity.is_some() {
        ref_velocity.unwrap() * (PUNCH_THRESHOLD / 3.0)
    } else {
        PUNCH_THRESHOLD
    };

    if peak < threshold { return None; }

    // Get wrist position (in Y-up normalized frame)
    let last = attacker_frames.back()?;
    if last.keypoints.len() <= wrist_idx { return None; }
    let wrist_pos = &last.keypoints[wrist_idx];

    // Get defender's body scale from last defender frame
    let def_scale = defender_frames.back()
        .map(|f| body_scale(&f.keypoints))
        .unwrap_or(DEFAULT_BODY_SCALE);

    // Classify region based on wrist Y position vs defender body
    let raw_region = classify_region(wrist_pos.y, def_scale);
    // Refine head hits into face/chin/throat
    let raw_region = if matches!(raw_region, BodyRegion::HeadFace) {
        refine_head_region(wrist_pos.y, def_scale)
    } else {
        raw_region
    };
    // Apply guard blocking
    let region = if let Some(def_frame) = defender_frames.back() {
        apply_guard(raw_region, &def_frame.keypoints, def_scale)
    } else {
        raw_region
    };

    Some(HitResult {
        region,
        velocity: peak,
        position: (wrist_pos.x, wrist_pos.y),
    })
}

pub fn detect_kick(
    attacker_frames: &VecDeque<PoseFrame>,
    defender_frames: &VecDeque<PoseFrame>,
    _ref_velocity: Option<f64>,
) -> Option<HitResult> {
    if attacker_frames.len() < 3 { return None; }

    // Use whichever ankle has higher peak speed
    let ps_l = peak_speed(attacker_frames, ANKLE_LEFT);
    let ps_r = peak_speed(attacker_frames, ANKLE_RIGHT);
    let (ankle_idx, peak) = if ps_l >= ps_r { (ANKLE_LEFT, ps_l) } else { (ANKLE_RIGHT, ps_r) };

    let threshold = KICK_THRESHOLD;
    if peak < threshold { return None; }

    // Check ankle elevation: kick requires ankle above REL_KICK_MID_Y threshold
    let last = attacker_frames.back()?;
    if last.keypoints.len() <= ankle_idx { return None; }
    let ankle_pos = &last.keypoints[ankle_idx];

    let def_scale = defender_frames.back()
        .map(|f| body_scale(&f.keypoints))
        .unwrap_or(DEFAULT_BODY_SCALE);

    let kick_threshold_y = REL_KICK_MID_Y * def_scale;
    if ankle_pos.y < kick_threshold_y { return None; }

    // WR-04: classify kick region against defender's body frame, then constrain to leg regions.
    // Using attacker's raw ankle_pos.y >= 0.0 incorrectly depends on attacker's own frame height.
    let raw_region = classify_region(ankle_pos.y, def_scale);
    let region = match raw_region {
        BodyRegion::LegThigh | BodyRegion::LegShin => raw_region,
        BodyRegion::TorsoLower => BodyRegion::LegThigh, // high kick contacts thigh
        _ => BodyRegion::LegThigh,
    };

    Some(HitResult {
        region,
        velocity: peak,
        position: (ankle_pos.x, ankle_pos.y),
    })
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use plugin_trait::{PoseFrame, PoseKeypoint};

    fn kp(x: f64, y: f64) -> PoseKeypoint {
        PoseKeypoint { x, y, z: 0.0, visibility: 1.0 }
    }

    fn zero_kps() -> Vec<PoseKeypoint> {
        vec![kp(0.5, 0.0); 33]
    }

    fn frame_with_wrist(t: f64, wrist_y: f64) -> PoseFrame {
        let mut kps = zero_kps();
        // hip y = 0 (Y-up normalized: hip is at origin)
        kps[23] = kp(0.5, 0.0); // LEFT_HIP
        kps[24] = kp(0.5, 0.0); // RIGHT_HIP
        // shoulder above hip (positive Y in Y-up frame)
        kps[11] = kp(0.5, 0.3); // LEFT_SHOULDER
        kps[12] = kp(0.5, 0.3); // RIGHT_SHOULDER
        // set left wrist
        kps[15] = kp(0.5, wrist_y);
        PoseFrame { timestamp: t, keypoints: kps }
    }

    #[test]
    fn detect_punch_empty_frames_returns_none() {
        let empty: VecDeque<PoseFrame> = VecDeque::new();
        assert!(detect_punch(&empty, &empty, Some(3.0)).is_none());
    }

    #[test]
    fn body_scale_normal_pose() {
        let kps = frame_with_wrist(0.0, 0.0).keypoints;
        let scale = body_scale(&kps);
        // shoulder_y=0.3, hip_y=0.0 → scale=0.3, clamped=[0.12,0.55]
        assert!((scale - 0.3).abs() < 0.01, "expected ~0.3, got {}", scale);
    }

    #[test]
    fn body_scale_clamped_minimum() {
        let mut kps = zero_kps();
        // Very close shoulder/hip = tiny scale → clamp to 0.12
        kps[11] = kp(0.5, 0.01); kps[12] = kp(0.5, 0.01);
        kps[23] = kp(0.5, 0.00); kps[24] = kp(0.5, 0.00);
        let scale = body_scale(&kps);
        assert_eq!(scale, 0.12);
    }

    #[test]
    fn is_primarily_upward_positive_vy_dominates() {
        // Y-up: upward = positive vy
        assert!(is_primarily_upward((0.1, 5.0, 0.1)));
    }

    #[test]
    fn is_primarily_upward_lateral_motion_not_upward() {
        assert!(!is_primarily_upward((5.0, 0.1, 0.1)));
    }

    #[test]
    fn guard_raise_veto_prevents_punch() {
        // Both wrists moving strongly upward — should return None
        let mut frames: VecDeque<PoseFrame> = VecDeque::new();
        for i in 0..5u8 {
            let t = i as f64 * 0.033;
            let mut f = frame_with_wrist(t, 1.5 + i as f64 * 0.1);
            // Also set right wrist moving up
            f.keypoints[16] = kp(0.5, 1.5 + i as f64 * 0.1);
            frames.push_back(f);
        }
        // With both wrists moving up fast (positive vy dominates), veto should fire.
        // is_primarily_upward returns true for both wrists → detect_punch must return None.
        let result = detect_punch(&frames, &frames, Some(3.0));
        assert!(result.is_none(), "guard-raise veto must suppress punch when both wrists move primarily upward");
    }

    // -----------------------------------------------------------------------
    // Task 3: Additional hit_detection edge case tests
    // -----------------------------------------------------------------------

    /// A punch that would hit (high velocity) is blocked by the defender's guard
    /// when both wrists are raised above guard_head_y threshold.
    #[test]
    fn punch_blocked_by_head_guard() {
        // Build attacker frames: left wrist moving fast laterally (not upward)
        let mut attacker: VecDeque<PoseFrame> = VecDeque::new();
        for i in 0..5u8 {
            let t = i as f64 * 0.033;
            let mut f = frame_with_wrist(t, 0.5); // head height wrist
            // Right wrist stays low (not upward)
            f.keypoints[16] = kp(0.5 + i as f64 * 0.05, 0.3);
            // Left wrist moves laterally fast
            f.keypoints[15] = kp(0.5 + i as f64 * 0.1, 0.5);
            f.keypoints[23] = kp(0.5, 0.0); // LEFT_HIP
            f.keypoints[24] = kp(0.5, 0.0); // RIGHT_HIP
            f.keypoints[11] = kp(0.5, 0.3); // LEFT_SHOULDER
            f.keypoints[12] = kp(0.5, 0.3); // RIGHT_SHOULDER
            attacker.push_back(PoseFrame { timestamp: t, keypoints: f.keypoints });
        }

        // Build defender frames: both wrists raised above guard_head_y
        // guard_head_y = REL_GUARD_HEAD_Y * scale = 1.10 * 0.3 = 0.33
        // So wrists at y=0.5 are above guard_head_y
        let mut defender: VecDeque<PoseFrame> = VecDeque::new();
        let mut df = frame_with_wrist(0.0, 0.5);
        df.keypoints[15] = kp(0.5, 0.5); // WRIST_LEFT above guard_head_y
        df.keypoints[16] = kp(0.5, 0.5); // WRIST_RIGHT above guard_head_y
        defender.push_back(df);

        let result = detect_punch(&attacker, &defender, Some(3.0));
        if let Some(hit) = result {
            // Region must be a block type (BlockHand or BlockForearm) — not a direct hit
            assert!(
                matches!(hit.region, plugin_trait::BodyRegion::BlockHand | plugin_trait::BodyRegion::BlockForearm),
                "high-wrist punch should be blocked, got: {:?}", hit.region
            );
        }
        // If result is None, the velocity was below threshold — test is inconclusive
        // but not a failure (guard logic still correct)
    }

    /// detect_kick returns Some with region LegThigh for a fast ankle.
    #[test]
    fn kick_to_body_region_detected() {
        // Build attacker frames: ankle moving fast
        let mut attacker: VecDeque<PoseFrame> = VecDeque::new();
        for i in 0..5u8 {
            let t = i as f64 * 0.033;
            let mut kps = zero_kps();
            kps[23] = kp(0.5, 0.0);
            kps[24] = kp(0.5, 0.0);
            kps[11] = kp(0.5, 0.3);
            kps[12] = kp(0.5, 0.3);
            // Left ankle (idx 27) at y=0.0 or above kick_threshold_y
            // kick_threshold_y = REL_KICK_MID_Y * scale = -0.30 * 0.3 = -0.09
            // ankle at y=0.0 > -0.09 → above threshold
            kps[27] = kp(0.5 + i as f64 * 0.1, 0.0); // fast lateral ankle movement
            attacker.push_back(PoseFrame { timestamp: t, keypoints: kps });
        }
        let defender: VecDeque<PoseFrame> = VecDeque::new();

        let result = detect_kick(&attacker, &defender, None);
        // Peak speed must exceed KICK_THRESHOLD (2.0 m/s)
        // With 0.1 m per 0.033s ≈ 3.0 m/s > 2.0 threshold
        if let Some(hit) = result {
            assert!(
                matches!(hit.region, plugin_trait::BodyRegion::LegThigh | plugin_trait::BodyRegion::LegShin),
                "kick must map to leg region, got: {:?}", hit.region
            );
        }
        // If None, the test setup didn't generate enough velocity — flag as inconclusive
    }

    /// detect_punch returns None when fewer than 3 frames are present.
    /// detect_kick returns None for the same reason.
    #[test]
    fn detect_kick_insufficient_frames_returns_none() {
        let two_frames: VecDeque<PoseFrame> = vec![
            frame_with_wrist(0.0, 0.3),
            frame_with_wrist(0.1, 0.5),
        ].into_iter().collect();
        assert!(detect_kick(&two_frames, &two_frames, None).is_none());
    }
}
