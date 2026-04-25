import { useEffect, useRef } from 'react'
import { Application, BlurFilter, Container, Graphics } from 'pixi.js'
import { extrapolatePosesInto, interpolatePosesInto } from '../lib/interpolate'
import { sfx } from '../lib/sfx'
import { SparkEmitter } from '../lib/sparks'
import type { HitEvent, MsgGameState, PoseKeypoint } from '../protocol'

interface PixiCanvasProps {
  gameState: MsgGameState | null
}

type Side = 'left' | 'right'
interface ScreenPoint {
  x: number
  y: number
  visible: boolean
}
interface ArmTrailSnapshot {
  pts: ScreenPoint[]  // 6 entries in ARM_TRAIL_INDICES order
  valid: boolean
}
interface PlayerLayers {
  shadow: Graphics
  trail: Graphics
  glow: Graphics
  rim: Graphics
  main: Graphics
}

const SILHOUETTE_COLOR = 0xffffff
const VISIBILITY_THRESHOLD = 0.3
const DEFAULT_TICK_INTERVAL_MS = 16
const TICK_EWMA_ALPHA = 0.1
const MAX_EXTRAPOLATION_T = 1.5
const TRAIL_VEL_THRESHOLD_PX = 4

// MediaPipe BlazePose landmark indices
const NOSE = 0
const LEFT_SHOULDER = 11
const RIGHT_SHOULDER = 12
const LEFT_ELBOW = 13
const RIGHT_ELBOW = 14
const LEFT_WRIST = 15
const RIGHT_WRIST = 16
const LEFT_HIP = 23
const RIGHT_HIP = 24
const LEFT_KNEE = 25
const RIGHT_KNEE = 26
const LEFT_ANKLE = 27
const RIGHT_ANKLE = 28

// Indices into the ArmTrailSnapshot.pts array (order matches ARM_TRAIL_INDICES)
const TRAIL_LEFT_SHOULDER = 0
const TRAIL_RIGHT_SHOULDER = 1
const TRAIL_LEFT_WRIST = 4
const TRAIL_RIGHT_WRIST = 5

const ARM_TRAIL_INDICES = [LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_ELBOW, RIGHT_ELBOW, LEFT_WRIST, RIGHT_WRIST]

function projectKeypoint(
  keypoint: PoseKeypoint,
  side: Side,
  width: number,
  height: number,
  out: ScreenPoint,
) {
  // Body spans ~1.1 world units top-to-bottom (±0.55 from hip origin).
  // Reserve 14% top (HUD) + 4% bottom as padding and fit within the rest.
  const usable = height * 0.82
  const scale = usable / 1.1
  const centerX = side === 'left' ? width * 0.25 : width * 0.75
  // Position lower: top of usable zone + 58% of usable height
  const centerY = height * 0.14 + usable * 0.58
  const flip = side === 'right' ? -1 : 1
  out.x = centerX + keypoint.x * scale * flip
  out.y = centerY + keypoint.y * scale
  out.visible = keypoint.visibility >= VISIBILITY_THRESHOLD
}

function projectXY(
  point: { x: number; y: number },
  side: Side,
  width: number,
  height: number,
): { x: number; y: number } {
  const usable = height * 0.82
  const scale = usable / 1.1
  const centerX = side === 'left' ? width * 0.25 : width * 0.75
  const centerY = height * 0.14 + usable * 0.58
  const flip = side === 'right' ? -1 : 1
  return {
    x: centerX + point.x * scale * flip,
    y: centerY + point.y * scale,
  }
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay)
}

function circleTriad(
  layers: PlayerLayers,
  x: number,
  y: number,
  radius: number,
) {
  layers.main.circle(x, y, radius).fill({ color: SILHOUETTE_COLOR })
  layers.glow.circle(x, y, radius * 1.05).fill({ color: SILHOUETTE_COLOR })
  layers.rim.circle(x, y, radius * 1.22).fill({ color: SILHOUETTE_COLOR })
}

function lineTriad(
  layers: PlayerLayers,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  lineW: number,
) {
  layers.main.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: lineW, color: SILHOUETTE_COLOR })
  layers.glow.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: lineW * 2.5, color: SILHOUETTE_COLOR })
  layers.rim.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: lineW * 6, color: SILHOUETTE_COLOR })
}

function drawBoxer(
  layers: PlayerLayers,
  keypoints: PoseKeypoint[],
  side: Side,
  width: number,
  height: number,
  screenPoints: ScreenPoint[],
) {
  layers.main.clear()
  layers.glow.clear()
  layers.rim.clear()
  layers.shadow.clear()

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

  let bodyScale = height * 0.18
  if (sl?.visible && sr?.visible) {
    bodyScale = Math.max(bodyScale, distance(sl.x, sl.y, sr.x, sr.y))
  } else if (lh?.visible && rh?.visible) {
    bodyScale = Math.max(bodyScale, distance(lh.x, lh.y, rh.x, rh.y) * 1.2)
  }

  const lineW = Math.max(4, bodyScale * 0.04)
  const jointR = bodyScale * 0.075
  const gloveR = bodyScale * 0.13
  const headR = bodyScale * 0.22

  // Spine and hip/shoulder cross-bars
  if (sl?.visible && sr?.visible && lh?.visible && rh?.visible) {
    const neckX = (sl.x + sr.x) / 2
    const neckY = (sl.y + sr.y) / 2
    const hipX = (lh.x + rh.x) / 2
    const hipY = (lh.y + rh.y) / 2
    lineTriad(layers, neckX, neckY, hipX, hipY, lineW)
    lineTriad(layers, sl.x, sl.y, sr.x, sr.y, lineW)
    lineTriad(layers, lh.x, lh.y, rh.x, rh.y, lineW)
  } else {
    if (sl?.visible && lh?.visible) lineTriad(layers, sl.x, sl.y, lh.x, lh.y, lineW)
    if (sr?.visible && rh?.visible) lineTriad(layers, sr.x, sr.y, rh.x, rh.y, lineW)
  }

  // Legs
  if (lh?.visible && lk?.visible) lineTriad(layers, lh.x, lh.y, lk.x, lk.y, lineW)
  if (lk?.visible && la?.visible) lineTriad(layers, lk.x, lk.y, la.x, la.y, lineW)
  if (rh?.visible && rk?.visible) lineTriad(layers, rh.x, rh.y, rk.x, rk.y, lineW)
  if (rk?.visible && ra?.visible) lineTriad(layers, rk.x, rk.y, ra.x, ra.y, lineW)

  // Arms
  if (sl?.visible && le?.visible) lineTriad(layers, sl.x, sl.y, le.x, le.y, lineW)
  if (le?.visible && lw?.visible) lineTriad(layers, le.x, le.y, lw.x, lw.y, lineW)
  if (sr?.visible && re?.visible) lineTriad(layers, sr.x, sr.y, re.x, re.y, lineW)
  if (re?.visible && rw?.visible) lineTriad(layers, re.x, re.y, rw.x, rw.y, lineW)

  // Neck + head
  if (sl?.visible && sr?.visible) {
    const neckX = (sl.x + sr.x) / 2
    const neckY = (sl.y + sr.y) / 2
    const headX = nose?.visible ? nose.x : neckX
    const headY = nose?.visible ? nose.y : neckY - headR
    lineTriad(layers, neckX, neckY, headX, headY, lineW)
    circleTriad(layers, headX, headY, headR)
  } else if (nose?.visible) {
    circleTriad(layers, nose.x, nose.y, headR)
  }

  // Joints
  if (le?.visible) circleTriad(layers, le.x, le.y, jointR)
  if (re?.visible) circleTriad(layers, re.x, re.y, jointR)
  if (lk?.visible) circleTriad(layers, lk.x, lk.y, jointR)
  if (rk?.visible) circleTriad(layers, rk.x, rk.y, jointR)

  // Hands (gloves) and feet
  if (lw?.visible) circleTriad(layers, lw.x, lw.y, gloveR)
  if (rw?.visible) circleTriad(layers, rw.x, rw.y, gloveR)
  if (la?.visible) circleTriad(layers, la.x, la.y, jointR * 0.7)
  if (ra?.visible) circleTriad(layers, ra.x, ra.y, jointR * 0.7)
}

function createPoseBuffer() {
  return Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }))
}

function createScreenPointBuffer() {
  return Array.from({ length: 33 }, () => ({ x: 0, y: 0, visible: false }))
}

function createArmTrail(): ArmTrailSnapshot {
  return {
    pts: Array.from({ length: ARM_TRAIL_INDICES.length }, () => ({ x: 0, y: 0, visible: false })),
    valid: false,
  }
}

function drawArmTrailFromPts(g: Graphics, pts: ScreenPoint[], lineW: number): void {
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

function createPlayerLayers(parent: Container): PlayerLayers {
  const playerContainer = new Container()
  const shadow = new Graphics()
  const trail = new Graphics()
  const rim = new Graphics()
  const glow = new Graphics()
  const main = new Graphics()

  rim.filters = [new BlurFilter({ strength: 20, quality: 4 })]
  rim.alpha = 0.40

  glow.filters = [new BlurFilter({ strength: 8, quality: 4 })]
  glow.alpha = 0.75

  trail.filters = [new BlurFilter({ strength: 6, quality: 2 })]

  playerContainer.addChild(shadow)
  playerContainer.addChild(trail)
  playerContainer.addChild(rim)
  playerContainer.addChild(glow)
  playerContainer.addChild(main)
  parent.addChild(playerContainer)

  return { shadow, trail, rim, glow, main }
}

function destroyPlayerLayers(layers: PlayerLayers) {
  layers.shadow.destroy()
  layers.trail.destroy()
  layers.rim.destroy()
  layers.glow.destroy()
  layers.main.destroy()
}

export function PixiCanvas({ gameState }: PixiCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const playerLayersRef = useRef<PlayerLayers[]>([])
  const emitterRef = useRef<SparkEmitter | null>(null)

  const prevPosesRef = useRef<(PoseKeypoint[] | null)[]>([null, null])
  const nextPosesRef = useRef<(PoseKeypoint[] | null)[]>([null, null])
  const poseBuffersRef = useRef<PoseKeypoint[][]>([
    createPoseBuffer(),
    createPoseBuffer(),
  ])
  const screenPointBuffersRef = useRef<ScreenPoint[][]>([
    createScreenPointBuffer(),
    createScreenPointBuffer(),
  ])
  const lastTickTimeRef = useRef<number | null>(null)
  const expectedTickIntervalRef = useRef<number>(DEFAULT_TICK_INTERVAL_MS)
  const lastEmittedTickRef = useRef<number>(-1)
  const tickerHandlerRef = useRef<((ticker: { deltaTime: number }) => void) | null>(null)
  const armTrailRef = useRef<ArmTrailSnapshot[]>([createArmTrail(), createArmTrail()])

  useEffect(() => {
    let cancelled = false
    const host = containerRef.current
    if (!host) {
      return
    }

    const app = new Application()

    const setup = async () => {
      await app.init({
        backgroundAlpha: 0,
        resizeTo: window,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      })

      if (cancelled) {
        app.destroy(true, { children: true, texture: true })
        return
      }

      host.appendChild(app.canvas)
      app.canvas.classList.add('pixi-canvas')

      const skeletonContainer = new Container()
      const sparkContainer = new Container()
      app.stage.addChild(skeletonContainer)
      app.stage.addChild(sparkContainer)

      playerLayersRef.current = [
        createPlayerLayers(skeletonContainer),
        createPlayerLayers(skeletonContainer),
      ]

      const emitter = new SparkEmitter(sparkContainer)
      emitterRef.current = emitter

      appRef.current = app

      const handler = (ticker: { deltaTime: number }) => {
        const lastTickTime = lastTickTimeRef.current
        let t: number
        if (lastTickTime == null) {
          t = 1
        } else {
          const interval = expectedTickIntervalRef.current
          const elapsed = performance.now() - lastTickTime
          const raw = interval > 0 ? elapsed / interval : 1
          if (!Number.isFinite(raw)) {
            t = 1
          } else {
            t = Math.max(0, Math.min(MAX_EXTRAPOLATION_T, raw))
          }
        }

        // PixiJS v8: renderer.width/height are already in CSS pixels.
        const renderer = app.renderer
        const w = renderer.width
        const h = renderer.height

        const layersList = playerLayersRef.current
        for (let slot = 0; slot < 2; slot += 1) {
          const prev = prevPosesRef.current[slot]
          const next = nextPosesRef.current[slot]
          const layers = layersList[slot]
          if (!layers) {
            continue
          }
          const armTrail = armTrailRef.current[slot]
          if (!next) {
            layers.main.clear()
            layers.glow.clear()
            layers.rim.clear()
            layers.shadow.clear()
            layers.trail.clear()
            armTrail.valid = false
            continue
          }
          const pose = prev
            ? t <= 1
              ? interpolatePosesInto(prev, next, t, poseBuffersRef.current[slot])
              : extrapolatePosesInto(prev, next, t, poseBuffersRef.current[slot])
            : next
          const side: Side = slot === 0 ? 'left' : 'right'
          const currentScreenPts = screenPointBuffersRef.current[slot]
          drawBoxer(layers, pose, side, w, h, currentScreenPts)

          // Motion blur trail: ghost arms at previous frame's positions when moving fast
          layers.trail.clear()
          if (armTrail.valid) {
            const lwNow = currentScreenPts[LEFT_WRIST]
            const rwNow = currentScreenPts[RIGHT_WRIST]
            const lwPrev = armTrail.pts[TRAIL_LEFT_WRIST]
            const rwPrev = armTrail.pts[TRAIL_RIGHT_WRIST]
            const lwVel = lwNow.visible && lwPrev.visible
              ? Math.hypot(lwNow.x - lwPrev.x, lwNow.y - lwPrev.y) : 0
            const rwVel = rwNow.visible && rwPrev.visible
              ? Math.hypot(rwNow.x - rwPrev.x, rwNow.y - rwPrev.y) : 0
            const maxVel = Math.max(lwVel, rwVel)
            if (maxVel > TRAIL_VEL_THRESHOLD_PX) {
              const slPrev = armTrail.pts[TRAIL_LEFT_SHOULDER]
              const srPrev = armTrail.pts[TRAIL_RIGHT_SHOULDER]
              const bodyScale = slPrev.visible && srPrev.visible
                ? Math.max(h * 0.28, Math.hypot(srPrev.x - slPrev.x, srPrev.y - slPrev.y))
                : h * 0.28
              const lineW = Math.max(4, bodyScale * 0.04)
              layers.trail.alpha = Math.min(0.40, maxVel / (TRAIL_VEL_THRESHOLD_PX * 8))
              drawArmTrailFromPts(layers.trail, armTrail.pts, lineW)
            }
          }
          // Save current arm screen positions for next frame's trail comparison
          for (let ti = 0; ti < ARM_TRAIL_INDICES.length; ti += 1) {
            const pt = currentScreenPts[ARM_TRAIL_INDICES[ti]]
            armTrail.pts[ti].x = pt.x
            armTrail.pts[ti].y = pt.y
            armTrail.pts[ti].visible = pt.visible
          }
          armTrail.valid = true
        }

        emitter.update(ticker.deltaTime)
      }

      tickerHandlerRef.current = handler
      app.ticker.add(handler)
    }

    void setup()

    return () => {
      cancelled = true
      const currentApp = appRef.current
      const emitter = emitterRef.current
      const handler = tickerHandlerRef.current
      const layersList = playerLayersRef.current

      if (currentApp) {
        if (handler) {
          currentApp.ticker.remove(handler)
        }
        currentApp.ticker.stop()
      }
      for (const layers of layersList) {
        destroyPlayerLayers(layers)
      }
      if (emitter) {
        emitter.destroy()
      }
      if (currentApp) {
        const canvas = currentApp.canvas
        currentApp.destroy(true, { children: true, texture: true })
        if (canvas && canvas.parentNode === host) {
          host.removeChild(canvas)
        }
      }

      appRef.current = null
      emitterRef.current = null
      playerLayersRef.current = []
      tickerHandlerRef.current = null
      prevPosesRef.current = [null, null]
      nextPosesRef.current = [null, null]
      poseBuffersRef.current = [createPoseBuffer(), createPoseBuffer()]
      screenPointBuffersRef.current = [
        createScreenPointBuffer(),
        createScreenPointBuffer(),
      ]
      lastTickTimeRef.current = null
      expectedTickIntervalRef.current = DEFAULT_TICK_INTERVAL_MS
      lastEmittedTickRef.current = -1
      armTrailRef.current = [createArmTrail(), createArmTrail()]
    }
  }, [])

  useEffect(() => {
    if (!gameState) {
      return
    }

    const now = performance.now()
    const previousTickTime = lastTickTimeRef.current
    if (previousTickTime != null) {
      const delta = now - previousTickTime
      if (Number.isFinite(delta) && delta > 0) {
        const current = expectedTickIntervalRef.current
        expectedTickIntervalRef.current =
          current * (1 - TICK_EWMA_ALPHA) + delta * TICK_EWMA_ALPHA
      }
    }

    prevPosesRef.current = [nextPosesRef.current[0], nextPosesRef.current[1]]
    nextPosesRef.current = [gameState.poses[0], gameState.poses[1]]
    lastTickTimeRef.current = now

    const emitter = emitterRef.current
    const app = appRef.current
    if (
      emitter &&
      app &&
      gameState.recent_hits.length > 0 &&
      gameState.tick > lastEmittedTickRef.current
    ) {
      const renderer = app.renderer
      const w = renderer.width
      const h = renderer.height

      for (const hit of gameState.recent_hits as HitEvent[]) {
        const side: Side = hit.player === 1 ? 'left' : 'right'
        const projected = projectXY(hit.position, side, w, h)
        emitter.emit(projected.x, projected.y, hit.damage)
        sfx.play(hit.damage >= 10 ? 'hit_heavy' : 'hit_light')
      }

      lastEmittedTickRef.current = gameState.tick
    }
  }, [gameState])

  return <div ref={containerRef} className="pixi-host" />
}
