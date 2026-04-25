import { useEffect, useRef } from 'react'
import { Application, Container, Graphics } from 'pixi.js'
import { CONNECTIONS } from '../lib/skeleton'
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

const SILHOUETTE_COLOR = 0x000000
const BONE_WIDTH = 12
const JOINT_RADIUS = 8
const VISIBILITY_THRESHOLD = 0.3
const DEFAULT_TICK_INTERVAL_MS = 16
const TICK_EWMA_ALPHA = 0.1

function projectKeypoint(
  keypoint: PoseKeypoint,
  side: Side,
  width: number,
  height: number,
  out: ScreenPoint,
) {
  const halfW = width / 2
  const xOffset = side === 'left' ? halfW * 0.5 : halfW * 1.5
  const flip = side === 'right' ? -1 : 1
  const scale = height * 0.4
  out.x = xOffset + keypoint.x * scale * flip
  out.y = height * 0.5 + keypoint.y * scale
  out.visible = keypoint.visibility >= VISIBILITY_THRESHOLD
}

function projectXY(
  point: { x: number; y: number },
  side: Side,
  width: number,
  height: number,
): { x: number; y: number } {
  const halfW = width / 2
  const xOffset = side === 'left' ? halfW * 0.5 : halfW * 1.5
  const flip = side === 'right' ? -1 : 1
  const scale = height * 0.4
  return {
    x: xOffset + point.x * scale * flip,
    y: height * 0.5 + point.y * scale,
  }
}

function drawSkeleton(
  gfx: Graphics,
  keypoints: PoseKeypoint[],
  side: Side,
  width: number,
  height: number,
  screenPoints: ScreenPoint[],
) {
  gfx.clear()

  if (keypoints.length === 0) {
    return
  }

  for (let index = 0; index < keypoints.length; index += 1) {
    const point = screenPoints[index] ?? { x: 0, y: 0, visible: false }
    projectKeypoint(keypoints[index], side, width, height, point)
    screenPoints[index] = point
  }

  for (const [a, b] of CONNECTIONS) {
    const pa = screenPoints[a]
    const pb = screenPoints[b]
    if (!pa || !pb) {
      continue
    }
    if (!pa.visible || !pb.visible) {
      continue
    }
    gfx
      .moveTo(pa.x, pa.y)
      .lineTo(pb.x, pb.y)
      .stroke({ color: SILHOUETTE_COLOR, width: BONE_WIDTH, cap: 'round', join: 'round' })
  }

  for (let index = 0; index < keypoints.length; index += 1) {
    const p = screenPoints[index]
    if (!p?.visible) {
      continue
    }
    gfx.circle(p.x, p.y, JOINT_RADIUS).fill({ color: SILHOUETTE_COLOR })
  }
}

function createPoseBuffer() {
  return Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }))
}

function createScreenPointBuffer() {
  return Array.from({ length: 33 }, () => ({ x: 0, y: 0, visible: false }))
}

export function PixiCanvas({ gameState }: PixiCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const skeletonGraphicsRef = useRef<Graphics[]>([])
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
        background: '#1a1a2e',
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

      const bgContainer = new Container()
      const skeletonContainer = new Container()
      const sparkContainer = new Container()
      app.stage.addChild(bgContainer)
      app.stage.addChild(skeletonContainer)
      app.stage.addChild(sparkContainer)

      const player1Graphics = new Graphics()
      const player2Graphics = new Graphics()
      skeletonContainer.addChild(player1Graphics)
      skeletonContainer.addChild(player2Graphics)
      skeletonGraphicsRef.current = [player1Graphics, player2Graphics]

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

        const graphicsList = skeletonGraphicsRef.current
        for (let slot = 0; slot < 2; slot += 1) {
          const prev = prevPosesRef.current[slot]
          const next = nextPosesRef.current[slot]
          const gfx = graphicsList[slot]
          if (!gfx) {
            continue
          }
          if (!next) {
            gfx.clear()
            continue
          }
          const pose = prev
            ? interpolatePosesInto(prev, next, t, poseBuffersRef.current[slot])
            : next
          const side: Side = slot === 0 ? 'left' : 'right'
          drawSkeleton(gfx, pose, side, w, h, screenPointBuffersRef.current[slot])
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

      if (currentApp) {
        if (handler) {
          currentApp.ticker.remove(handler)
        }
        currentApp.ticker.stop()
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
      skeletonGraphicsRef.current = []
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
