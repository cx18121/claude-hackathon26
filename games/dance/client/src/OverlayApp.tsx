import { useCallback, useEffect, useRef, useState } from 'react'
import { CommentarySubtitle } from '@shared/client/components/CommentarySubtitle'
import { DanceHud } from './components/DanceHud'
import { ParallaxBackground } from '@shared/client/components/ParallaxBackground'
import { PixiCanvas } from '@shared/client/components/PixiCanvas'
import { RoundOverlay } from '@shared/client/components/RoundOverlay'
import { SettingsPanel, DEFAULT_AUDIO_SETTINGS } from '@shared/client/components/SettingsPanel'
import { WaitingOverlay } from '@shared/client/components/WaitingOverlay'
import { useCommentary } from '@shared/client/hooks/useCommentary'
import { useSpectatorSocket } from '@shared/client/hooks/useSpectatorSocket'
import { unlockSfx } from '@shared/client/lib/sfx'
import type { AudioSettings } from '@shared/client/components/SettingsPanel'

const params = new URLSearchParams(window.location.search)
const serverUrl = params.get('server') ?? 'ws://localhost:8002'
const roomCode = params.get('room') ?? 'MOCK01'

export function OverlayApp() {
  const {
    connected,
    gameState,
    matchWinner,
    matchStats,
    lobbyState,
    roundState,
    poseStreamRef,
    socket,
    danceScores,
    danceBeat,
  } = useSpectatorSocket(serverUrl, roomCode)

  const danceBeatRef = useRef(danceBeat)
  useEffect(() => { danceBeatRef.current = danceBeat }, [danceBeat])

  const isWaiting = roundState?.phase === 'waiting' && !gameState && !matchWinner

  const [shaking, setShaking] = useState(false)
  const shakeTimerRef = useRef<number | null>(null)
  const handleHeavyHit = useCallback(() => {
    setShaking(true)
    if (shakeTimerRef.current !== null) window.clearTimeout(shakeTimerRef.current)
    shakeTimerRef.current = window.setTimeout(() => {
      setShaking(false)
      shakeTimerRef.current = null
    }, 450)
  }, [])

  const [audioUnlocked, setAudioUnlocked] = useState(false)
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS)

  const handleUnlock = useCallback(() => {
    unlockSfx()
    setAudioUnlocked(true)
  }, [])

  const commentary = useCommentary(
    socket,
    audioUnlocked && audioSettings.commentaryOn,
    audioSettings.commentary,
  )

  return (
    <main className={`overlay-shell${shaking ? ' shaking' : ''}`}>
      <ParallaxBackground tick={gameState?.tick ?? 0} />
      <PixiCanvas
        gameState={gameState}
        poseStreamRef={poseStreamRef}
        danceBeatRef={danceBeatRef}
        onHeavyHit={handleHeavyHit}
      />

      {isWaiting && <WaitingOverlay lobbyState={lobbyState} />}

      <DanceHud
        connected={connected}
        danceScores={danceScores}
        danceBeat={danceBeat}
      />
      <CommentarySubtitle commentary={commentary} />
      <RoundOverlay
        matchWinner={matchWinner}
        matchStats={matchStats}
        roundState={roundState}
        serverUrl={serverUrl}
        roomCode={roomCode}
        gameType="dance"
        danceScores={danceScores}
      />

      <SettingsPanel settings={audioSettings} onChange={setAudioSettings} />

      {!audioUnlocked && (
        <button className="audio-unlock" type="button" onClick={handleUnlock}>
          Click to start audio
        </button>
      )}
    </main>
  )
}
