import { useEffect, useRef } from 'react'
import { CONNECTIONS, REGION_KEYPOINTS } from '../lib/skeleton'
import type { PoseKeypoint } from '@shared/protocol'

const VISIBILITY_THRESHOLD = 0.3
const HIT_DURATION_MS = 700

interface Props {
  keypoints: PoseKeypoint[] | null
  hitRegion: string | null
}

export function AvatarCanvas({ keypoints, hitRegion }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hitRegionRef = useRef<string | null>(null)
  const hitTimeRef = useRef<number>(0)

  useEffect(() => {
    if (hitRegion) {
      hitRegionRef.current = hitRegion
      hitTimeRef.current = performance.now()
    }
  }, [hitRegion])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Sync canvas backing resolution to its CSS size
    const cw = canvas.offsetWidth
    const ch = canvas.offsetHeight
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw
      canvas.height = ch
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (!keypoints || keypoints.length === 0) return

    const w = canvas.width
    const h = canvas.height
    const scale = h * 0.42
    const cx = w / 2
    const cy = h * 0.48

    const pts = keypoints.map((kp) => ({
      x: cx + kp.x * scale,
      y: cy + kp.y * scale,
      visible: kp.visibility >= VISIBILITY_THRESHOLD,
    }))

    const hitAge = performance.now() - hitTimeRef.current
    const hitActive = hitAge < HIT_DURATION_MS && hitRegionRef.current !== null
    const hitFraction = hitActive ? Math.max(0, 1 - hitAge / HIT_DURATION_MS) : 0
    const hitSet: Set<number> | null = hitActive
      ? new Set(REGION_KEYPOINTS[hitRegionRef.current!] ?? [])
      : null

    for (const [a, b] of CONNECTIONS) {
      const pa = pts[a]
      const pb = pts[b]
      if (!pa?.visible || !pb?.visible) continue

      const dx = pb.x - pa.x
      const dy = pb.y - pa.y
      const len = Math.hypot(dx, dy)
      if (len < 1) continue

      const isHit = hitSet && (hitSet.has(a) || hitSet.has(b))
      const radius = Math.max(3, len * 0.28)
      const nx = (-dy / len) * radius
      const ny = (dx / len) * radius

      if (isHit) {
        const alpha = 0.75 + hitFraction * 0.25
        ctx.fillStyle = `rgba(255, ${Math.round(60 + 120 * (1 - hitFraction))}, 60, ${alpha})`
      } else {
        ctx.fillStyle = 'rgba(160, 210, 255, 0.70)'
      }

      ctx.beginPath()
      ctx.moveTo(pa.x + nx, pa.y + ny)
      ctx.lineTo(pb.x + nx, pb.y + ny)
      ctx.lineTo(pb.x - nx, pb.y - ny)
      ctx.lineTo(pa.x - nx, pa.y - ny)
      ctx.closePath()
      ctx.fill()

      ctx.beginPath()
      ctx.arc(pa.x, pa.y, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(pb.x, pb.y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [keypoints, hitRegion])

  return <canvas ref={canvasRef} className="avatar-canvas" />
}
