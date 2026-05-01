import { useCallback, useRef, useState } from 'react'
import { CommentarySubtitle } from './components/CommentarySubtitle'
import { HudLayer } from './components/HudLayer'
import { ParallaxBackground } from './components/ParallaxBackground'
import { PixiCanvas } from './components/PixiCanvas'
import { RoundOverlay } from './components/RoundOverlay'
import { SettingsPanel, DEFAULT_AUDIO_SETTINGS } from './components/SettingsPanel'
import { WaitingOverlay } from './components/WaitingOverlay'
import { useCommentary } from './hooks/useCommentary'
import { useSpectatorSocket } from './hooks/useSpectatorSocket'
import { unlockSfx } from './lib/sfx'
import type { HpPair } from '@shared/protocol'
import type { AudioSettings } from './components/SettingsPanel'

const params = new URLSearchParams(window.location.search)
const serverUrl = params.get('server') ?? 'ws://localhost:8002'
const roomCode = params.get('room') ?? 'MOCK01'

function App() {
  const {
    connected,
    disconnectedPlayer,
    gameState,
    matchWinner,
    matchStats,
    wins,
    maxWins,
    lobbyState,
    roundState,
    poseStreamRef,
    socket,
  } = useSpectatorSocket(serverUrl, roomCode)

  const hp: HpPair = gameState?.hp ?? [800, 800]
  const remainingTime = gameState?.remaining_time ?? 90
  const roundNumber = roundState?.number ?? 1
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
        onHeavyHit={handleHeavyHit}
      />

      {isWaiting && <WaitingOverlay lobbyState={lobbyState} />}

      <HudLayer
        connected={connected}
        disconnectedPlayer={disconnectedPlayer}
        highLatency={gameState?.high_latency ?? false}
        hp={hp}
        wins={wins}
        maxWins={maxWins}
        remainingTime={remainingTime}
        round={roundNumber}
        roomCode={roomCode}
      />
      <CommentarySubtitle commentary={commentary} />
      <RoundOverlay
        matchWinner={matchWinner}
        matchStats={matchStats}
        roundState={roundState}
        serverUrl={serverUrl}
        roomCode={roomCode}
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

export default App
