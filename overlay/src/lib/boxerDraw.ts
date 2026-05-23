import { BlurFilter, Container, Graphics } from 'pixi.js'
import type { PoseKeypoint } from '@shared/protocol'
import { CONNECTIONS } from './skeleton'

// =====================================================================
// Drawing helpers used by PixiCanvas to render the two boxer silhouettes
// and the dance-skeleton ghost. Pure functions over Pixi `Graphics` —
// no React, no hooks, no Pixi `Application` lifecycle. Extracted from
// PixiCanvas.tsx so the component itself stays focused on the Pixi
// lifecycle and tick orchestration.
// =====================================================================

export type Side = 'left' | 'right'

export interface ScreenPoint {
  x: number
  y: number
  visible: boolean
}

export interface ArmTrailSnapshot {
  pts: ScreenPoint[] // 6 entries in ARM_TRAIL_INDICES order
  valid: boolean
}

export interface PlayerLayers {
  shadow: Graphics
  trail: Graphics
  glow: Graphics
  rim: Graphics
  main: Graphics
}

export const SILHOUETTE_COLOR = 0xffffff
export const PLAYER_GLOW_COLORS = [0x33aaff, 0xff3322] as const
export const SKELETON_COLOR = 0x524a42   // --text-dim hex (~oklch(38% 0.006 85))
export const SKELETON_ALPHA = 0.4
export const VISIBILITY_THRESHOLD = 0.3

// Fighter projection. Pose keypoints are MediaPipe BlazePose worldLandmarks
// (hip-centered, metres) — same coords the server uses in hit_detection.py.
// 1 world-metre therefore renders as `PLAYER_SCALE_Y * height` pixels.
export const PLAYER_SCALE_Y = 0.55
export const PLAYER_CENTER_Y = 0.575

// Half-gap between fighter spines, measured in world metres so fighters stay
// the same physical distance apart regardless of viewport aspect ratio.
//
// Picked from human anatomy and typical boxing motion (averages):
//   - Shoulder half-width:  ~0.18 m  → silhouettes at ±0.40 m leave ~0.44 m
//                                       of empty air between idle stances.
//   - Moderate punch reach: wrist lateral .x ≈ ±0.40 m at extension, so the
//                                       two wrists meet at the screen midline
//                                       when both fighters punch.
//   - Hook reach:          wrist lateral .x ≈ ±0.55 m, which overlaps the
//                                       opponent's torso by ~0.15 m — reads
//                                       visually as a landed strike.
// Previously hard-coded as fractions of width (0.25/0.75, then 0.36/0.64),
// which made the gap aspect-dependent and 0.91 m on a 16:9 1080p canvas —
// too far for moderate punches to connect.
export const PLAYER_HALF_GAP_METERS = 0.40
export const TRAIL_VEL_THRESHOLD_PX = 4

// MediaPipe BlazePose landmark indices
export const NOSE = 0
export const LEFT_SHOULDER = 11
export const RIGHT_SHOULDER = 12
export const LEFT_ELBOW = 13
export const RIGHT_ELBOW = 14
export const LEFT_WRIST = 15
export const RIGHT_WRIST = 16
export const LEFT_HIP = 23
export const RIGHT_HIP = 24
export const LEFT_KNEE = 25
export const RIGHT_KNEE = 26
export const LEFT_ANKLE = 27
export const RIGHT_ANKLE = 28

// Indices into the ArmTrailSnapshot.pts array (order matches ARM_TRAIL_INDICES)
export const TRAIL_LEFT_SHOULDER = 0
export const TRAIL_RIGHT_SHOULDER = 1
export const TRAIL_LEFT_WRIST = 4
export const TRAIL_RIGHT_WRIST = 5

export const ARM_TRAIL_INDICES = [
  LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_ELBOW, RIGHT_ELBOW, LEFT_WRIST, RIGHT_WRIST,
]

export function fighterCenterX(side: Side, width: number, height: number): number {
  const halfGapPx = PLAYER_HALF_GAP_METERS * height * PLAYER_SCALE_Y
  return width / 2 + (side === 'left' ? -halfGapPx : halfGapPx)
}

// Both players' silhouettes are mirrored. P1 was fixed in 3cd9642 so the
// "Face right" UI instruction renders correctly; P2 needs the same mirror
// so the "Face left" UI instruction works for symmetric positioning.
const HORIZONTAL_FLIP = -1

export function projectKeypoint(
  keypoint: PoseKeypoint,
  side: Side,
  width: number,
  height: number,
  out: ScreenPoint,
) {
  const scale = height * PLAYER_SCALE_Y
  const centerX = fighterCenterX(side, width, height)
  const centerY = height * PLAYER_CENTER_Y
  out.x = centerX + keypoint.x * scale * HORIZONTAL_FLIP
  out.y = centerY + keypoint.y * scale
  out.visible = keypoint.visibility >= VISIBILITY_THRESHOLD
}

export function projectXY(
  point: { x: number; y: number },
  side: Side,
  width: number,
  height: number,
): { x: number; y: number } {
  const scale = height * PLAYER_SCALE_Y
  const centerX = fighterCenterX(side, width, height)
  const centerY = height * PLAYER_CENTER_Y
  return {
    x: centerX + point.x * scale * HORIZONTAL_FLIP,
    y: centerY + point.y * scale,
  }
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay)
}

function circleTriad(layers: PlayerLayers, x: number, y: number, radius: number) {
  layers.main.circle(x, y, radius).fill({ color: SILHOUETTE_COLOR })
  layers.glow.circle(x, y, radius * 1.05).fill({ color: SILHOUETTE_COLOR })
  layers.rim.circle(x, y, radius * 1.22).fill({ color: SILHOUETTE_COLOR })
}

function paintCapsule(
  gfx: Graphics,
  ax: number, ay: number, bx: number, by: number,
  radius: number, color: number,
) {
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  if (len < 0.5) {
    gfx.circle(ax, ay, radius).fill({ color })
    return
  }
  const nx = (-dy / len) * radius
  const ny = (dx / len) * radius
  gfx.poly([ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny]).fill({ color })
  gfx.circle(ax, ay, radius).fill({ color })
  gfx.circle(bx, by, radius).fill({ color })
}

function capsuleTriad(
  layers: PlayerLayers,
  ax: number, ay: number, bx: number, by: number,
  radius: number,
) {
  paintCapsule(layers.main, ax, ay, bx, by, radius, SILHOUETTE_COLOR)
  paintCapsule(layers.glow, ax, ay, bx, by, radius * 1.06, SILHOUETTE_COLOR)
  paintCapsule(layers.rim, ax, ay, bx, by, radius * 1.20, SILHOUETTE_COLOR)
}

function ellipseTriad(layers: PlayerLayers, x: number, y: number, rx: number, ry: number) {
  layers.main.ellipse(x, y, rx, ry).fill({ color: SILHOUETTE_COLOR })
  layers.glow.ellipse(x, y, rx * 1.06, ry * 1.06).fill({ color: SILHOUETTE_COLOR })
  layers.rim.ellipse(x, y, rx * 1.20, ry * 1.20).fill({ color: SILHOUETTE_COLOR })
}

function quadTriad(
  layers: PlayerLayers,
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
) {
  const v = [ax, ay, bx, by, cx, cy, dx, dy]
  layers.main.poly(v).fill({ color: SILHOUETTE_COLOR })
  layers.glow.poly(v).fill({ color: SILHOUETTE_COLOR })
  layers.rim.poly(v).fill({ color: SILHOUETTE_COLOR })
}

export function drawBoxer(
  layers: PlayerLayers,
  keypoints: PoseKeypoint[],
  side: Side,
  width: number,
  height: number,
  screenPoints: ScreenPoint[],
  glowColor: number,
) {
  layers.main.clear()
  layers.glow.clear()
  layers.rim.clear()
  layers.shadow.clear()

  layers.main.tint = 0x000000
  layers.glow.tint = glowColor
  layers.rim.tint = glowColor

  if (keypoints.length === 0) {
    return
  }

  for (let i = 0; i < keypoints.length; i += 1) {
    const point = screenPoints[i] ?? { x: 0, y: 0, visible: false }
    projectKeypoint(keypoints[i], side, width, height, point)
    screenPoints[i] = point
  }

  const sl = screenPoints[LEFT_SHOULDER]
  const sr = screenPoints[RIGHT_SHOULDER]
  const lh = screenPoints[LEFT_HIP]
  const rh = screenPoints[RIGHT_HIP]
  const nose = screenPoints[NOSE]
  const le = screenPoints[LEFT_ELBOW]
  const re = screenPoints[RIGHT_ELBOW]
  const lw = screenPoints[LEFT_WRIST]
  const rw = screenPoints[RIGHT_WRIST]
  const lk = screenPoints[LEFT_KNEE]
  const rk = screenPoints[RIGHT_KNEE]
  const la = screenPoints[LEFT_ANKLE]
  const ra = screenPoints[RIGHT_ANKLE]

  let bodyScale = height * 0.11
  if (sl?.visible && sr?.visible) {
    bodyScale = Math.max(bodyScale, distance(sl.x, sl.y, sr.x, sr.y))
  } else if (lh?.visible && rh?.visible) {
    bodyScale = Math.max(bodyScale, distance(lh.x, lh.y, rh.x, rh.y) * 1.2)
  }

  const torsoThick = bodyScale * 0.10
  const upperArmThick = bodyScale * 0.068
  const forearmThick = bodyScale * 0.052
  const thighThick = bodyScale * 0.095
  const calfThick = bodyScale * 0.070
  const gloveR = bodyScale * 0.15
  const footRx = bodyScale * 0.13
  const footRy = bodyScale * 0.065
  const headR = bodyScale * 0.25
  const jointR = bodyScale * 0.060

  // Ground shadow
  let footY = 0, footCount = 0
  if (la?.visible) { footY += la.y; footCount += 1 }
  if (ra?.visible) { footY += ra.y; footCount += 1 }
  let bodyCenterX = 0
  if (sl?.visible && sr?.visible) bodyCenterX = (sl.x + sr.x) / 2
  else if (lh?.visible && rh?.visible) bodyCenterX = (lh.x + rh.x) / 2
  else if (nose?.visible) bodyCenterX = nose.x
  if (footCount > 0 && bodyCenterX !== 0) {
    const groundY = footY / footCount + footRy * 0.6
    layers.shadow
      .ellipse(bodyCenterX, groundY, bodyScale * 1.3, bodyScale * 0.35)
      .fill({ color: 0x000000, alpha: 0.45 })
  }

  // Legs (behind torso)
  if (lh?.visible && lk?.visible) capsuleTriad(layers, lh.x, lh.y, lk.x, lk.y, thighThick)
  if (lk?.visible && la?.visible) capsuleTriad(layers, lk.x, lk.y, la.x, la.y, calfThick)
  if (la?.visible) ellipseTriad(layers, la.x, la.y + footRy * 0.4, footRx, footRy)
  if (rh?.visible && rk?.visible) capsuleTriad(layers, rh.x, rh.y, rk.x, rk.y, thighThick)
  if (rk?.visible && ra?.visible) capsuleTriad(layers, rk.x, rk.y, ra.x, ra.y, calfThick)
  if (ra?.visible) ellipseTriad(layers, ra.x, ra.y + footRy * 0.4, footRx, footRy)

  // Torso
  if (sl?.visible && sr?.visible && lh?.visible && rh?.visible) {
    quadTriad(layers, sl.x, sl.y, sr.x, sr.y, rh.x, rh.y, lh.x, lh.y)
  } else {
    if (sl?.visible && lh?.visible) capsuleTriad(layers, sl.x, sl.y, lh.x, lh.y, torsoThick)
    if (sr?.visible && rh?.visible) capsuleTriad(layers, sr.x, sr.y, rh.x, rh.y, torsoThick)
  }
  if (lh?.visible && rh?.visible) capsuleTriad(layers, lh.x, lh.y, rh.x, rh.y, torsoThick * 0.9)
  if (sl?.visible && sr?.visible) capsuleTriad(layers, sl.x, sl.y, sr.x, sr.y, torsoThick)

  // Neck + head
  if (sl?.visible && sr?.visible) {
    const neckX = (sl.x + sr.x) / 2
    const neckY = (sl.y + sr.y) / 2
    const headX = nose?.visible ? nose.x : neckX
    const headY = nose?.visible ? nose.y - headR * 0.05 : neckY - headR * 1.05
    capsuleTriad(layers, neckX, neckY, headX, headY + headR * 0.5, torsoThick * 0.8)
    circleTriad(layers, headX, headY, headR)
  } else if (nose?.visible) {
    circleTriad(layers, nose.x, nose.y, headR)
  }

  // Arms (on top so gloves render over torso)
  if (sl?.visible && le?.visible) capsuleTriad(layers, sl.x, sl.y, le.x, le.y, upperArmThick)
  if (le?.visible && lw?.visible) capsuleTriad(layers, le.x, le.y, lw.x, lw.y, forearmThick)
  if (lw?.visible) circleTriad(layers, lw.x, lw.y, gloveR)
  if (sr?.visible && re?.visible) capsuleTriad(layers, sr.x, sr.y, re.x, re.y, upperArmThick)
  if (re?.visible && rw?.visible) capsuleTriad(layers, re.x, re.y, rw.x, rw.y, forearmThick)
  if (rw?.visible) circleTriad(layers, rw.x, rw.y, gloveR)

  // Joint dots
  if (le?.visible) circleTriad(layers, le.x, le.y, jointR)
  if (re?.visible) circleTriad(layers, re.x, re.y, jointR)
  if (lk?.visible) circleTriad(layers, lk.x, lk.y, jointR * 0.85)
  if (rk?.visible) circleTriad(layers, rk.x, rk.y, jointR * 0.85)
}

export function createPoseBuffer(): PoseKeypoint[] {
  return Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }))
}

export function createScreenPointBuffer(): ScreenPoint[] {
  return Array.from({ length: 33 }, () => ({ x: 0, y: 0, visible: false }))
}

export function createArmTrail(): ArmTrailSnapshot {
  return {
    pts: Array.from({ length: ARM_TRAIL_INDICES.length }, () => ({ x: 0, y: 0, visible: false })),
    valid: false,
  }
}

export function drawArmTrailFromPts(g: Graphics, pts: ScreenPoint[], lineW: number): void {
  const sl = pts[TRAIL_LEFT_SHOULDER]
  const sr = pts[TRAIL_RIGHT_SHOULDER]
  const le = pts[2]
  const re = pts[3]
  const lw = pts[TRAIL_LEFT_WRIST]
  const rw = pts[TRAIL_RIGHT_WRIST]
  if (!sl || !sr || !le || !re || !lw || !rw) return

  if (sl.visible && le.visible)
    g.moveTo(sl.x, sl.y).lineTo(le.x, le.y).stroke({ width: lineW, color: SILHOUETTE_COLOR })
  if (le.visible && lw.visible)
    g.moveTo(le.x, le.y).lineTo(lw.x, lw.y).stroke({ width: lineW, color: SILHOUETTE_COLOR })
  if (lw.visible)
    g.circle(lw.x, lw.y, lineW * 2).fill({ color: SILHOUETTE_COLOR })

  if (sr.visible && re.visible)
    g.moveTo(sr.x, sr.y).lineTo(re.x, re.y).stroke({ width: lineW, color: SILHOUETTE_COLOR })
  if (re.visible && rw.visible)
    g.moveTo(re.x, re.y).lineTo(rw.x, rw.y).stroke({ width: lineW, color: SILHOUETTE_COLOR })
  if (rw.visible)
    g.circle(rw.x, rw.y, lineW * 2).fill({ color: SILHOUETTE_COLOR })
}

export function drawTargetPoseSkeleton(
  gfx: Graphics,
  targetPose: Array<[number, number, number, number]>,
  width: number,
  height: number,
): void {
  gfx.clear()
  const centerX = width / 2
  const centerY = height * PLAYER_CENTER_Y
  const scale = height * PLAYER_SCALE_Y
  const KEYPOINT_RADIUS = scale * 0.02

  // Draw bones
  for (const [a, b] of CONNECTIONS) {
    const kpA = targetPose[a]
    const kpB = targetPose[b]
    if (!kpA || !kpB || kpA[3] < 0.5 || kpB[3] < 0.5) continue
    const ax = centerX + kpA[0] * scale * HORIZONTAL_FLIP
    const ay = centerY + kpA[1] * scale
    const bx = centerX + kpB[0] * scale * HORIZONTAL_FLIP
    const by = centerY + kpB[1] * scale
    gfx.moveTo(ax, ay).lineTo(bx, by).stroke({ width: 2, color: SKELETON_COLOR })
  }

  // Draw keypoints
  for (const [x, y, , visibility] of targetPose) {
    if (visibility < 0.5) continue
    const sx = centerX + x * scale * HORIZONTAL_FLIP
    const sy = centerY + y * scale
    gfx.circle(sx, sy, KEYPOINT_RADIUS).fill({ color: SKELETON_COLOR })
  }
}

export function createPlayerLayers(parent: Container): PlayerLayers {
  const playerContainer = new Container()
  const shadow = new Graphics()
  const trail = new Graphics()
  const rim = new Graphics()
  const glow = new Graphics()
  const main = new Graphics()

  rim.filters = [new BlurFilter({ strength: 10, quality: 3 })]
  rim.alpha = 0.50

  glow.filters = [new BlurFilter({ strength: 4, quality: 3 })]
  glow.alpha = 0.70

  trail.filters = [new BlurFilter({ strength: 6, quality: 2 })]

  playerContainer.addChild(shadow)
  playerContainer.addChild(trail)
  playerContainer.addChild(rim)
  playerContainer.addChild(glow)
  playerContainer.addChild(main)
  parent.addChild(playerContainer)

  return { shadow, trail, rim, glow, main }
}

export function destroyPlayerLayers(layers: PlayerLayers) {
  layers.shadow.destroy()
  layers.trail.destroy()
  layers.rim.destroy()
  layers.glow.destroy()
  layers.main.destroy()
}
