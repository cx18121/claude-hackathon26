import { useEffect, useRef, type MutableRefObject } from 'react'
import { Application, Container, Graphics } from 'pixi.js'
import { extrapolatePosesInto } from '../lib/interpolate'
import { sfx } from '../lib/sfx'
import { SparkEmitter } from '../lib/sparks'
import type { PoseStream } from '../hooks/useSpectatorSocket'
import type { HitEvent, MsgGameState, PoseKeypoint } from '@shared/protocol'
import {
  ARM_TRAIL_INDICES,
  createArmTrail,
  createPlayerLayers,
  createPoseBuffer,
  createScreenPointBuffer,
  destroyPlayerLayers,
  drawArmTrailFromPts,
  drawBoxer,
  LEFT_WRIST,
  PLAYER_GLOW_COLORS,
  projectXY,
  RIGHT_WRIST,
  TRAIL_LEFT_SHOULDER,
  TRAIL_LEFT_WRIST,
  TRAIL_RIGHT_SHOULDER,
  TRAIL_RIGHT_WRIST,
  TRAIL_VEL_THRESHOLD_PX,
  type ArmTrailSnapshot,
  type PlayerLayers,
  type ScreenPoint,
  type Side,
} from '../lib/boxerDraw'
import { createSkeletonFadeState, stepSkeletonFade } from '../lib/skeletonFade'

interface PixiCanvasProps {
  gameState: MsgGameState | null
  poseStreamRef: MutableRefObject<PoseStream>
  danceBeatRef: MutableRefObject<{
    beat: number
    totalBeats: number
    targetPose: Array<[number, number, number, number]>
  } | null>
  onHeavyHit?: () => void
}

// Forward extrapolation budget. We render at `next + (next - prev) * forward`
// where `forward = elapsed_ms / expected_interval_ms`, capped here. 1.0
// lets us project a full network interval ahead (~16ms at 60Hz arrivals),
// so the visible silhouette stays roughly even with the player's real-time
// motion when prediction is accurate. Higher values overshoot on motion
// that suddenly stops, so 1.0 is the sweet spot for boxing-style movement.
const MAX_FORWARD_EXTRAPOLATION = 1.0

export function PixiCanvas({ gameState, poseStreamRef, danceBeatRef, onHeavyHit }: PixiCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const onHeavyHitRef = useRef(onHeavyHit)
  onHeavyHitRef.current = onHeavyHit
  const playerLayersRef = useRef<PlayerLayers[]>([])
  const emitterRef = useRef<SparkEmitter | null>(null)

  const poseBuffersRef = useRef<PoseKeypoint[][]>([
    createPoseBuffer(),
    createPoseBuffer(),
  ])
  const screenPointBuffersRef = useRef<ScreenPoint[][]>([
    createScreenPointBuffer(),
    createScreenPointBuffer(),
  ])
  const lastEmittedTickRef = useRef<number>(-1)
  const tickerHandlerRef = useRef<((ticker: { deltaTime: number }) => void) | null>(null)
  const armTrailRef = useRef<ArmTrailSnapshot[]>([createArmTrail(), createArmTrail()])
  const skeletonFadeRef = useRef(createSkeletonFadeState())
  const skeletonGfxRef = useRef<Graphics | null>(null)

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

      // Publish appRef BEFORE any synchronous setup work. If a downstream
      // `new Container()` / `new Graphics()` ever throws, the unmount cleanup
      // can still find and destroy the Application via appRef.current —
      // otherwise the canvas would orphan with no handle to free its GPU
      // resources.
      appRef.current = app

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

      const skeletonGfx = new Graphics()
      skeletonGfx.alpha = 0   // invisible until first beat
      skeletonContainer.addChild(skeletonGfx)
      skeletonGfxRef.current = skeletonGfx

      const emitter = new SparkEmitter(sparkContainer)
      emitterRef.current = emitter

      const handler = (ticker: { deltaTime: number }) => {
        const now = performance.now()
        // PixiJS v8: renderer.width/height are already in CSS pixels.
        const renderer = app.renderer
        const w = renderer.width
        const h = renderer.height

        const layersList = playerLayersRef.current
        const stream = poseStreamRef.current
        for (let slot = 0; slot < 2; slot += 1) {
          const player = stream.players[slot]
          const next = player.next
          const prev = player.prev
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
          // Always extrapolate FORWARD from `next` (the latest received
          // pose). The classic prev->next interpolation buffer renders one
          // full network interval behind real-time; here we instead push
          // the rendered position ahead of the last packet by up to
          // MAX_FORWARD_EXTRAPOLATION ticks of (next - prev) velocity.
          let pose: PoseKeypoint[]
          if (prev && player.expectedIntervalMs > 0) {
            const elapsed = now - player.lastArrivalMs
            const rawForward = elapsed / player.expectedIntervalMs
            const forward = Number.isFinite(rawForward)
              ? Math.max(0, Math.min(MAX_FORWARD_EXTRAPOLATION, rawForward))
              : 0
            pose = extrapolatePosesInto(
              prev, next, 1 + forward, poseBuffersRef.current[slot],
            )
          } else {
            pose = next
          }
          const side: Side = slot === 0 ? 'left' : 'right'
          const currentScreenPts = screenPointBuffersRef.current[slot]
          const glowColor = slot === 0 ? PLAYER_GLOW_COLORS[0] : PLAYER_GLOW_COLORS[1]
          drawBoxer(layers, pose, side, w, h, currentScreenPts, glowColor)

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
                ? Math.max(h * 0.11, Math.hypot(srPrev.x - slPrev.x, srPrev.y - slPrev.y))
                : h * 0.11
              const lineW = Math.max(3, bodyScale * 0.07)
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

        stepSkeletonFade(skeletonFadeRef.current, danceBeatRef.current, skeletonGfx, now, w, h)
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
      skeletonGfxRef.current?.destroy()
      skeletonGfxRef.current = null
      // Reset fade ref so a remounted component starts fresh
      skeletonFadeRef.current = createSkeletonFadeState()
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
      poseBuffersRef.current = [createPoseBuffer(), createPoseBuffer()]
      screenPointBuffersRef.current = [
        createScreenPointBuffer(),
        createScreenPointBuffer(),
      ]
      lastEmittedTickRef.current = -1
      armTrailRef.current = [createArmTrail(), createArmTrail()]
    }
  }, [])

  // Pose data no longer flows through gameState — it streams via
  // `poseStreamRef` (see useSpectatorSocket and the ticker handler above).
  // The 60Hz game_state channel is now used purely for HP, recent hits, and
  // round/match metadata, none of which is hot-path-latency sensitive.
  useEffect(() => {
    if (!gameState) {
      return
    }

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
        if (hit.damage >= 10) onHeavyHitRef.current?.()
      }

      lastEmittedTickRef.current = gameState.tick
    }
  }, [gameState])

  return <div ref={containerRef} className="pixi-host" />
}
