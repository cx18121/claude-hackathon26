import { useEffect, useRef } from 'react'
import { Application, BlurFilter, Container, Graphics } from 'pixi.js'
import { interpolatePosesInto } from '../lib/interpolate'
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
interface PlayerLayers {
  shadow: Graphics
  glow: Graphics
  rim: Graphics
  main: Graphics
}

const SILHOUETTE_COLOR = 0xffffff
const VISIBILITY_THRESHOLD = 0.3
const DEFAULT_TICK_INTERVAL_MS = 16
const TICK_EWMA_ALPHA = 0.1

// MediaPipe BlazePose landmark indices
const NOSE = 0
const LEFT_EAR = 7
const RIGHT_EAR = 8
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

function projectKeypoint(
  keypoint: PoseKeypoint,
  side: Side,
  width: number,
  height: number,
  out: ScreenPoint,
) {
  // worldLandmarks: origin at hip midpoint. MediaPipe JS uses Y-down (positive = toward feet).
  const scale = height * 0.46
  const centerX = side === 'left' ? width * 0.35 : width * 0.65
  const centerY = height * 0.46
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
  const scale = height * 0.45
  const centerX = side === 'left' ? width * 0.27 : width * 0.73
  const centerY = height * 0.52
  const flip = side === 'right' ? -1 : 1
  return {
    x: centerX + point.x * scale * flip,
    y: centerY + point.y * scale,
  }
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay)
}

function paintCapsule(
  gfx: Graphics,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
  color: number,
  alpha = 1,
) {
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  if (len < 0.5) {
    gfx.circle(ax, ay, radius).fill({ color, alpha })
    return
  }
  const nx = (-dy / len) * radius
  const ny = (dx / len) * radius
  gfx
    .poly([ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny])
    .fill({ color, alpha })
  gfx.circle(ax, ay, radius).fill({ color, alpha })
  gfx.circle(bx, by, radius).fill({ color, alpha })
}

function paintTriad(
  layers: PlayerLayers,
  fn: (g: Graphics, scale: number) => void,
) {
  fn(layers.main, 1)
  fn(layers.glow, 1.04)
  fn(layers.rim, 1.18)
}

function capsuleTriad(
  layers: PlayerLayers,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
) {
  paintTriad(layers, (g, s) => {
    paintCapsule(g, ax, ay, bx, by, radius * s, SILHOUETTE_COLOR)
  })
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

function ellipseTriad(
  layers: PlayerLayers,
  x: number,
  y: number,
  rx: number,
  ry: number,
) {
  layers.main.ellipse(x, y, rx, ry).fill({ color: SILHOUETTE_COLOR })
  layers.glow.ellipse(x, y, rx * 1.05, ry * 1.05).fill({ color: SILHOUETTE_COLOR })
  layers.rim.ellipse(x, y, rx * 1.2, ry * 1.2).fill({ color: SILHOUETTE_COLOR })
}

function quadTriad(
  layers: PlayerLayers,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
) {
  const verts = [ax, ay, bx, by, cx, cy, dx, dy]
  layers.main.poly(verts).fill({ color: SILHOUETTE_COLOR })
  layers.glow.poly(verts).fill({ color: SILHOUETTE_COLOR })
  layers.rim.poly(verts).fill({ color: SILHOUETTE_COLOR })
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
  const lear = screenPoints[LEFT_EAR]
  const rear = screenPoints[RIGHT_EAR]
  const le = screenPoints[LEFT_ELBOW]
  const re = screenPoints[RIGHT_ELBOW]
  const lw = screenPoints[LEFT_WRIST]
  const rw = screenPoints[RIGHT_WRIST]
  const lk = screenPoints[LEFT_KNEE]
  const rk = screenPoints[RIGHT_KNEE]
  const la = screenPoints[LEFT_ANKLE]
  const ra = screenPoints[RIGHT_ANKLE]

  let bodyScale = height * 0.13
  if (sl?.visible && sr?.visible) {
    bodyScale = Math.max(bodyScale, distance(sl.x, sl.y, sr.x, sr.y))
  } else if (lh?.visible && rh?.visible) {
    bodyScale = Math.max(bodyScale, distance(lh.x, lh.y, rh.x, rh.y) * 1.2)
  }

  const torsoThickness = bodyScale * 0.12
  const upperArmThickness = bodyScale * 0.09
  const forearmThickness = bodyScale * 0.07
  const thighThickness = bodyScale * 0.13
  const calfThickness = bodyScale * 0.10
  const gloveRadius = bodyScale * 0.22
  const footRx = bodyScale * 0.18
  const footRy = bodyScale * 0.09
  const headRadius = bodyScale * 0.32

  // Ground shadow under feet
  let footY = 0
  let footCount = 0
  if (la?.visible) {
    footY += la.y
    footCount += 1
  }
  if (ra?.visible) {
    footY += ra.y
    footCount += 1
  }
  let bodyCenterX = 0
  if (sl?.visible && sr?.visible) {
    bodyCenterX = (sl.x + sr.x) / 2
  } else if (lh?.visible && rh?.visible) {
    bodyCenterX = (lh.x + rh.x) / 2
  } else if (nose?.visible) {
    bodyCenterX = nose.x
  }
  if (footCount > 0 && bodyCenterX !== 0) {
    const groundY = footY / footCount + footRy * 0.6
    layers.shadow
      .ellipse(bodyCenterX, groundY, bodyScale * 1.45, bodyScale * 0.4)
      .fill({ color: 0x000000, alpha: 0.55 })
    layers.shadow
      .ellipse(bodyCenterX, groundY, bodyScale * 0.95, bodyScale * 0.26)
      .fill({ color: 0x000000, alpha: 0.55 })
  }

  // Legs first so they sit behind torso
  if (lh?.visible && lk?.visible) capsuleTriad(layers, lh.x, lh.y, lk.x, lk.y, thighThickness)
  if (lk?.visible && la?.visible) capsuleTriad(layers, lk.x, lk.y, la.x, la.y, calfThickness)
  if (la?.visible) ellipseTriad(layers, la.x, la.y + footRy * 0.4, footRx, footRy)

  if (rh?.visible && rk?.visible) capsuleTriad(layers, rh.x, rh.y, rk.x, rk.y, thighThickness)
  if (rk?.visible && ra?.visible) capsuleTriad(layers, rk.x, rk.y, ra.x, ra.y, calfThickness)
  if (ra?.visible) ellipseTriad(layers, ra.x, ra.y + footRy * 0.4, footRx, footRy)

  // Torso quad
  if (sl?.visible && sr?.visible && lh?.visible && rh?.visible) {
    quadTriad(layers, sl.x, sl.y, sr.x, sr.y, rh.x, rh.y, lh.x, lh.y)
  } else {
    if (sl?.visible && lh?.visible) capsuleTriad(layers, sl.x, sl.y, lh.x, lh.y, torsoThickness)
    if (sr?.visible && rh?.visible) capsuleTriad(layers, sr.x, sr.y, rh.x, rh.y, torsoThickness)
  }
  if (lh?.visible && rh?.visible) capsuleTriad(layers, lh.x, lh.y, rh.x, rh.y, torsoThickness * 0.95)
  if (sl?.visible && sr?.visible) capsuleTriad(layers, sl.x, sl.y, sr.x, sr.y, torsoThickness * 1.05)

  // Neck + head
  if (sl?.visible && sr?.visible) {
    const neckX = (sl.x + sr.x) / 2
    const neckY = (sl.y + sr.y) / 2
    let headR = headRadius
    let headX = neckX
    let headY = neckY - headRadius * 1.05
    if (nose?.visible) {
      headX = nose.x
      headY = nose.y - headRadius * 0.05
    }
    if (lear?.visible && rear?.visible) {
      headR = Math.max(headRadius * 0.85, distance(lear.x, lear.y, rear.x, rear.y) * 1.05)
    }
    capsuleTriad(layers, neckX, neckY, headX, headY + headR * 0.55, torsoThickness * 0.85)
    circleTriad(layers, headX, headY, headR)
  } else if (nose?.visible) {
    circleTriad(layers, nose.x, nose.y, headRadius)
  }

  // Arms (front-most)
  if (sl?.visible && le?.visible) capsuleTriad(layers, sl.x, sl.y, le.x, le.y, upperArmThickness)
  if (le?.visible && lw?.visible) capsuleTriad(layers, le.x, le.y, lw.x, lw.y, forearmThickness)
  if (lw?.visible) circleTriad(layers, lw.x, lw.y, gloveRadius)

  if (sr?.visible && re?.visible) capsuleTriad(layers, sr.x, sr.y, re.x, re.y, upperArmThickness)
  if (re?.visible && rw?.visible) capsuleTriad(layers, re.x, re.y, rw.x, rw.y, forearmThickness)
  if (rw?.visible) circleTriad(layers, rw.x, rw.y, gloveRadius)

  // Joint dots for segmented Shadow Fight look
  if (le?.visible) circleTriad(layers, le.x, le.y, upperArmThickness * 1.15)
  if (re?.visible) circleTriad(layers, re.x, re.y, upperArmThickness * 1.15)
  if (lk?.visible) circleTriad(layers, lk.x, lk.y, thighThickness * 0.85)
  if (rk?.visible) circleTriad(layers, rk.x, rk.y, thighThickness * 0.85)
}

function createPoseBuffer() {
  return Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }))
}

function createScreenPointBuffer() {
  return Array.from({ length: 33 }, () => ({ x: 0, y: 0, visible: false }))
}

function createPlayerLayers(parent: Container): PlayerLayers {
  const playerContainer = new Container()
  const shadow = new Graphics()
  const rim = new Graphics()
  const glow = new Graphics()
  const main = new Graphics()

  rim.filters = [new BlurFilter({ strength: 20, quality: 4 })]
  rim.alpha = 0.40

  glow.filters = [new BlurFilter({ strength: 8, quality: 4 })]
  glow.alpha = 0.75

  playerContainer.addChild(shadow)
  playerContainer.addChild(rim)
  playerContainer.addChild(glow)
  playerContainer.addChild(main)
  parent.addChild(playerContainer)

  return { shadow, rim, glow, main }
}

function destroyPlayerLayers(layers: PlayerLayers) {
  layers.shadow.destroy()
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
            t = Math.max(0, Math.min(1, raw))
          }
        }

        const renderer = app.renderer
        const resolution = renderer.resolution || 1
        const w = renderer.width / resolution
        const h = renderer.height / resolution

        const layersList = playerLayersRef.current
        for (let slot = 0; slot < 2; slot += 1) {
          const prev = prevPosesRef.current[slot]
          const next = nextPosesRef.current[slot]
          const layers = layersList[slot]
          if (!layers) {
            continue
          }
          if (!next) {
            layers.main.clear()
            layers.glow.clear()
            layers.rim.clear()
            layers.shadow.clear()
            continue
          }
          const pose = prev
            ? interpolatePosesInto(prev, next, t, poseBuffersRef.current[slot])
            : next
          const side: Side = slot === 0 ? 'left' : 'right'
          drawBoxer(layers, pose, side, w, h, screenPointBuffersRef.current[slot])
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
      const resolution = renderer.resolution || 1
      const w = renderer.width / resolution
      const h = renderer.height / resolution

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
