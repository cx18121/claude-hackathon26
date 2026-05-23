//! Target pose library for the dance scoring game.
//! All poses are defined in hip-centred Y-up coordinates — the same coordinate
//! system that the engine delivers to the plugin via TickContext.frames after
//! normalize_to_y_up (PLUG-06).
//!
//! Y-up reference:
//!   nose:       y ≈ +0.80  (above hip centre)
//!   shoulders:  y ≈ +0.35
//!   hips:       y ≈  0.00  (origin)
//!   knees:      y ≈ -0.45
//!   ankles:     y ≈ -0.90
//!
//! MediaPipe 33-landmark layout used throughout:
//!   0  nose          11/12 shoulders     13/14 elbows
//!   15/16 wrists     23/24 hips          25/26 knees
//!   27/28 ankles     1..10 face details  17..22 hand/foot details

use plugin_trait::PoseKeypoint;

/// Helper: construct a PoseKeypoint with z=0, visibility=1.0.
const fn kp(x: f64, y: f64) -> PoseKeypoint {
    PoseKeypoint { x, y, z: 0.0, visibility: 1.0 }
}

pub struct TargetPose {
    /// Human-readable pose name (used in Broadcast payload and SDK documentation).
    #[allow(dead_code)]
    pub name: &'static str,
    pub keypoints: [PoseKeypoint; 33],
}

// ---------------------------------------------------------------------------
// ARMS_UP: both wrists raised overhead, elbows above shoulders
// ---------------------------------------------------------------------------
pub const ARMS_UP: TargetPose = TargetPose {
    name: "ARMS_UP",
    keypoints: [
        kp(0.50,  0.80),  //  0  nose
        kp(0.54,  0.78),  //  1  left_eye_inner
        kp(0.55,  0.78),  //  2  left_eye
        kp(0.56,  0.78),  //  3  left_eye_outer
        kp(0.46,  0.78),  //  4  right_eye_inner
        kp(0.45,  0.78),  //  5  right_eye
        kp(0.44,  0.78),  //  6  right_eye_outer
        kp(0.58,  0.75),  //  7  left_ear
        kp(0.42,  0.75),  //  8  right_ear
        kp(0.54,  0.70),  //  9  mouth_left
        kp(0.46,  0.70),  // 10  mouth_right
        kp(0.60,  0.35),  // 11  left_shoulder
        kp(0.40,  0.35),  // 12  right_shoulder
        kp(0.65,  0.55),  // 13  left_elbow
        kp(0.35,  0.55),  // 14  right_elbow
        kp(0.68,  0.80),  // 15  left_wrist
        kp(0.32,  0.80),  // 16  right_wrist
        kp(0.70,  0.85),  // 17  left_pinky
        kp(0.30,  0.85),  // 18  right_pinky
        kp(0.70,  0.82),  // 19  left_index
        kp(0.30,  0.82),  // 20  right_index
        kp(0.69,  0.83),  // 21  left_thumb
        kp(0.31,  0.83),  // 22  right_thumb
        kp(0.55,  0.00),  // 23  left_hip
        kp(0.45,  0.00),  // 24  right_hip
        kp(0.55, -0.45),  // 25  left_knee
        kp(0.45, -0.45),  // 26  right_knee
        kp(0.55, -0.90),  // 27  left_ankle
        kp(0.45, -0.90),  // 28  right_ankle
        kp(0.57, -0.95),  // 29  left_heel
        kp(0.43, -0.95),  // 30  right_heel
        kp(0.57, -1.00),  // 31  left_foot_index
        kp(0.43, -1.00),  // 32  right_foot_index
    ],
};

// ---------------------------------------------------------------------------
// ARMS_OUT: both wrists extended sideways at shoulder height
// ---------------------------------------------------------------------------
pub const ARMS_OUT: TargetPose = TargetPose {
    name: "ARMS_OUT",
    keypoints: [
        kp(0.50,  0.80),  //  0  nose
        kp(0.54,  0.78),  //  1  left_eye_inner
        kp(0.55,  0.78),  //  2  left_eye
        kp(0.56,  0.78),  //  3  left_eye_outer
        kp(0.46,  0.78),  //  4  right_eye_inner
        kp(0.45,  0.78),  //  5  right_eye
        kp(0.44,  0.78),  //  6  right_eye_outer
        kp(0.58,  0.75),  //  7  left_ear
        kp(0.42,  0.75),  //  8  right_ear
        kp(0.54,  0.70),  //  9  mouth_left
        kp(0.46,  0.70),  // 10  mouth_right
        kp(0.60,  0.35),  // 11  left_shoulder
        kp(0.40,  0.35),  // 12  right_shoulder
        kp(0.75,  0.35),  // 13  left_elbow
        kp(0.25,  0.35),  // 14  right_elbow
        kp(0.90,  0.35),  // 15  left_wrist (arms out, x ≈ ±0.70 from centre = 0.50±0.40)
        kp(0.10,  0.35),  // 16  right_wrist
        kp(0.93,  0.33),  // 17  left_pinky
        kp(0.07,  0.33),  // 18  right_pinky
        kp(0.92,  0.35),  // 19  left_index
        kp(0.08,  0.35),  // 20  right_index
        kp(0.91,  0.34),  // 21  left_thumb
        kp(0.09,  0.34),  // 22  right_thumb
        kp(0.55,  0.00),  // 23  left_hip
        kp(0.45,  0.00),  // 24  right_hip
        kp(0.55, -0.45),  // 25  left_knee
        kp(0.45, -0.45),  // 26  right_knee
        kp(0.55, -0.90),  // 27  left_ankle
        kp(0.45, -0.90),  // 28  right_ankle
        kp(0.57, -0.95),  // 29  left_heel
        kp(0.43, -0.95),  // 30  right_heel
        kp(0.57, -1.00),  // 31  left_foot_index
        kp(0.43, -1.00),  // 32  right_foot_index
    ],
};

// ---------------------------------------------------------------------------
// SQUAT: hips lowered, knees bent, ankles close
// ---------------------------------------------------------------------------
pub const SQUAT: TargetPose = TargetPose {
    name: "SQUAT",
    keypoints: [
        kp(0.50,  0.60),  //  0  nose (body compressed — head lower relative to hip origin)
        kp(0.54,  0.58),  //  1  left_eye_inner
        kp(0.55,  0.58),  //  2  left_eye
        kp(0.56,  0.58),  //  3  left_eye_outer
        kp(0.46,  0.58),  //  4  right_eye_inner
        kp(0.45,  0.58),  //  5  right_eye
        kp(0.44,  0.58),  //  6  right_eye_outer
        kp(0.58,  0.55),  //  7  left_ear
        kp(0.42,  0.55),  //  8  right_ear
        kp(0.54,  0.50),  //  9  mouth_left
        kp(0.46,  0.50),  // 10  mouth_right
        kp(0.60,  0.15),  // 11  left_shoulder
        kp(0.40,  0.15),  // 12  right_shoulder
        kp(0.62,  0.00),  // 13  left_elbow (arms hanging at sides)
        kp(0.38,  0.00),  // 14  right_elbow
        kp(0.62, -0.15),  // 15  left_wrist
        kp(0.38, -0.15),  // 16  right_wrist
        kp(0.63, -0.18),  // 17  left_pinky
        kp(0.37, -0.18),  // 18  right_pinky
        kp(0.63, -0.16),  // 19  left_index
        kp(0.37, -0.16),  // 20  right_index
        kp(0.62, -0.17),  // 21  left_thumb
        kp(0.38, -0.17),  // 22  right_thumb
        kp(0.58, -0.20),  // 23  left_hip (hips dropped to y ≈ -0.20 in squat)
        kp(0.42, -0.20),  // 24  right_hip
        kp(0.60, -0.55),  // 25  left_knee
        kp(0.40, -0.55),  // 26  right_knee
        kp(0.57, -0.80),  // 27  left_ankle (feet planted, ankles slightly higher)
        kp(0.43, -0.80),  // 28  right_ankle
        kp(0.57, -0.85),  // 29  left_heel
        kp(0.43, -0.85),  // 30  right_heel
        kp(0.57, -0.88),  // 31  left_foot_index
        kp(0.43, -0.88),  // 32  right_foot_index
    ],
};

// ---------------------------------------------------------------------------
// LEFT_LEAN: torso shifted left — nose x ≈ 0.35, hips x ≈ 0.45
// ---------------------------------------------------------------------------
pub const LEFT_LEAN: TargetPose = TargetPose {
    name: "LEFT_LEAN",
    keypoints: [
        kp(0.35,  0.80),  //  0  nose
        kp(0.39,  0.78),  //  1  left_eye_inner
        kp(0.40,  0.78),  //  2  left_eye
        kp(0.41,  0.78),  //  3  left_eye_outer
        kp(0.31,  0.78),  //  4  right_eye_inner
        kp(0.30,  0.78),  //  5  right_eye
        kp(0.29,  0.78),  //  6  right_eye_outer
        kp(0.43,  0.75),  //  7  left_ear
        kp(0.27,  0.75),  //  8  right_ear
        kp(0.39,  0.70),  //  9  mouth_left
        kp(0.31,  0.70),  // 10  mouth_right
        kp(0.45,  0.35),  // 11  left_shoulder
        kp(0.25,  0.35),  // 12  right_shoulder
        kp(0.47,  0.10),  // 13  left_elbow
        kp(0.27,  0.10),  // 14  right_elbow
        kp(0.47, -0.10),  // 15  left_wrist
        kp(0.27, -0.10),  // 16  right_wrist
        kp(0.48, -0.13),  // 17  left_pinky
        kp(0.28, -0.13),  // 18  right_pinky
        kp(0.48, -0.11),  // 19  left_index
        kp(0.28, -0.11),  // 20  right_index
        kp(0.47, -0.12),  // 21  left_thumb
        kp(0.28, -0.12),  // 22  right_thumb
        kp(0.55,  0.00),  // 23  left_hip
        kp(0.35,  0.00),  // 24  right_hip (hips centred at x ≈ 0.45 mean)
        kp(0.55, -0.45),  // 25  left_knee
        kp(0.35, -0.45),  // 26  right_knee
        kp(0.55, -0.90),  // 27  left_ankle
        kp(0.35, -0.90),  // 28  right_ankle
        kp(0.57, -0.95),  // 29  left_heel
        kp(0.33, -0.95),  // 30  right_heel
        kp(0.57, -1.00),  // 31  left_foot_index
        kp(0.33, -1.00),  // 32  right_foot_index
    ],
};

// ---------------------------------------------------------------------------
// RIGHT_LEAN: torso shifted right — nose x ≈ 0.65, hips x ≈ 0.55
// ---------------------------------------------------------------------------
pub const RIGHT_LEAN: TargetPose = TargetPose {
    name: "RIGHT_LEAN",
    keypoints: [
        kp(0.65,  0.80),  //  0  nose
        kp(0.69,  0.78),  //  1  left_eye_inner
        kp(0.70,  0.78),  //  2  left_eye
        kp(0.71,  0.78),  //  3  left_eye_outer
        kp(0.61,  0.78),  //  4  right_eye_inner
        kp(0.60,  0.78),  //  5  right_eye
        kp(0.59,  0.78),  //  6  right_eye_outer
        kp(0.73,  0.75),  //  7  left_ear
        kp(0.57,  0.75),  //  8  right_ear
        kp(0.69,  0.70),  //  9  mouth_left
        kp(0.61,  0.70),  // 10  mouth_right
        kp(0.75,  0.35),  // 11  left_shoulder
        kp(0.55,  0.35),  // 12  right_shoulder
        kp(0.73,  0.10),  // 13  left_elbow
        kp(0.53,  0.10),  // 14  right_elbow
        kp(0.73, -0.10),  // 15  left_wrist
        kp(0.53, -0.10),  // 16  right_wrist
        kp(0.74, -0.13),  // 17  left_pinky
        kp(0.54, -0.13),  // 18  right_pinky
        kp(0.74, -0.11),  // 19  left_index
        kp(0.54, -0.11),  // 20  right_index
        kp(0.73, -0.12),  // 21  left_thumb
        kp(0.54, -0.12),  // 22  right_thumb
        kp(0.65,  0.00),  // 23  left_hip (hips centred at x ≈ 0.55 mean)
        kp(0.45,  0.00),  // 24  right_hip
        kp(0.65, -0.45),  // 25  left_knee
        kp(0.45, -0.45),  // 26  right_knee
        kp(0.65, -0.90),  // 27  left_ankle
        kp(0.45, -0.90),  // 28  right_ankle
        kp(0.67, -0.95),  // 29  left_heel
        kp(0.43, -0.95),  // 30  right_heel
        kp(0.67, -1.00),  // 31  left_foot_index
        kp(0.43, -1.00),  // 32  right_foot_index
    ],
};

// ---------------------------------------------------------------------------
// STAR_JUMP: arms up (wrists y ≈ +0.80) AND legs spread (ankles x ≈ ±0.35 from centre)
// ---------------------------------------------------------------------------
pub const STAR_JUMP: TargetPose = TargetPose {
    name: "STAR_JUMP",
    keypoints: [
        kp(0.50,  0.80),  //  0  nose
        kp(0.54,  0.78),  //  1  left_eye_inner
        kp(0.55,  0.78),  //  2  left_eye
        kp(0.56,  0.78),  //  3  left_eye_outer
        kp(0.46,  0.78),  //  4  right_eye_inner
        kp(0.45,  0.78),  //  5  right_eye
        kp(0.44,  0.78),  //  6  right_eye_outer
        kp(0.58,  0.75),  //  7  left_ear
        kp(0.42,  0.75),  //  8  right_ear
        kp(0.54,  0.70),  //  9  mouth_left
        kp(0.46,  0.70),  // 10  mouth_right
        kp(0.60,  0.35),  // 11  left_shoulder
        kp(0.40,  0.35),  // 12  right_shoulder
        kp(0.65,  0.55),  // 13  left_elbow (arms up)
        kp(0.35,  0.55),  // 14  right_elbow
        kp(0.68,  0.80),  // 15  left_wrist (arms raised overhead)
        kp(0.32,  0.80),  // 16  right_wrist
        kp(0.70,  0.85),  // 17  left_pinky
        kp(0.30,  0.85),  // 18  right_pinky
        kp(0.70,  0.82),  // 19  left_index
        kp(0.30,  0.82),  // 20  right_index
        kp(0.69,  0.83),  // 21  left_thumb
        kp(0.31,  0.83),  // 22  right_thumb
        kp(0.55,  0.00),  // 23  left_hip
        kp(0.45,  0.00),  // 24  right_hip
        kp(0.65, -0.45),  // 25  left_knee (legs spread: x ≈ 0.50±0.35)
        kp(0.35, -0.45),  // 26  right_knee
        kp(0.85, -0.90),  // 27  left_ankle (spread: x ≈ 0.50±0.35)
        kp(0.15, -0.90),  // 28  right_ankle
        kp(0.87, -0.95),  // 29  left_heel
        kp(0.13, -0.95),  // 30  right_heel
        kp(0.88, -1.00),  // 31  left_foot_index
        kp(0.12, -1.00),  // 32  right_foot_index
    ],
};

// ---------------------------------------------------------------------------
// Pose library — 6 target poses cycled through during a round
// ---------------------------------------------------------------------------
pub const POSE_LIBRARY: [&TargetPose; 6] = [
    &ARMS_UP,
    &ARMS_OUT,
    &SQUAT,
    &LEFT_LEAN,
    &RIGHT_LEAN,
    &STAR_JUMP,
];
