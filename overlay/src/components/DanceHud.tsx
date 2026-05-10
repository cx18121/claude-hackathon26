import { useEffect, useRef } from 'react'

interface DanceHudProps {
  connected: boolean
  danceScores: [number, number]
  danceBeat: {
    beat: number
    totalBeats: number
    targetPose: Array<[number, number, number, number]>
  } | null
}

export function DanceHud({ connected: _connected, danceScores, danceBeat }: DanceHudProps) {
  const barRef = useRef<HTMLDivElement>(null)
  const lastBeatTimeRef = useRef<number>(0)
  const beatDurationMsRef = useRef<number>(500)

  useEffect(() => {
    if (!danceBeat || !barRef.current) return
    const barEl = barRef.current
    const now = performance.now()

    // Compute beat interval (fallback 500ms until two events seen)
    if (lastBeatTimeRef.current > 0) {
      beatDurationMsRef.current = now - lastBeatTimeRef.current
    }
    lastBeatTimeRef.current = now
    const beatDurationMs = beatDurationMsRef.current

    // Step 1: hard snap to 100% (no transition)
    barEl.style.transition = 'width 0ms'
    barEl.style.width = '100%'
    // Step 2: force layout reflow — REQUIRED to commit snap before drain
    void barEl.offsetWidth
    // Step 3: drain linearly
    barEl.style.transition = `width ${beatDurationMs}ms linear`
    barEl.style.width = '0%'
  }, [danceBeat])

  const beatLabel = danceBeat
    ? `${danceBeat.beat} / ${danceBeat.totalBeats}`
    : '— / —'

  return (
    <div className="hud-layer">
      <div className="hud-band">
        {/* Row 1: P1 | Beat Indicator | P2 */}
        <div className="hud-names">
          <div className="hud-p1-name">
            <span className="hud-label">P1</span>
          </div>
          <div className="hud-center-name dance-beat-indicator">
            <div className="dance-beat-label">{beatLabel}</div>
            <div className="dance-beat-track">
              <div className="dance-beat-fill" ref={barRef} />
            </div>
          </div>
          <div className="hud-p2-name">
            <span className="hud-label">P2</span>
          </div>
        </div>

        {/* Row 2: Scores */}
        <div className="hud-bars dance-score-row">
          <span className="dance-score dance-score-p1">
            {danceScores[0].toFixed(1)}
          </span>
          <span className="dance-score-sep">vs</span>
          <span className="dance-score dance-score-p2">
            {danceScores[1].toFixed(1)}
          </span>
        </div>
      </div>
    </div>
  )
}
