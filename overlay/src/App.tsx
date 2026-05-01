import { useCallback, useRef, useState } from 'react'
import { CommentarySubtitle } from './components/CommentarySubtitle'
import { HudLayer } from './components/HudLayer'
import { ParallaxBackground } from './components/ParallaxBackground'
import { PixiCanvas } from './components/PixiCanvas'
import { RoundOverlay } from './components/RoundOverlay'
import { useCommentary } from './hooks/useCommentary'
import { useSpectatorSocket } from './hooks/useSpectatorSocket'
import { unlockSfx } from './lib/sfx'
import type { HpPair } from './protocol'

const params = new URLSearchParams(window.location.search)
const serverUrl = params.get('server') ?? 'ws://localhost:8002'
const roomCode = params.get('room') ?? 'MOCK01'

function App() {
  const {
    connected,
    disconnectedPlayer,
    gameState,
    matchWinner,
    wins,
    maxWins,
    roundState,
    poseStreamRef,
    socket,
  } = useSpectatorSocket(serverUrl, roomCode)
  const hp: HpPair = gameState?.hp ?? [800, 800]
  const remainingTime = gameState?.remaining_time ?? 90
  const roundNumber = roundState?.number ?? 1

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

  // Browsers block <audio> playback until a user gesture. Track unlock so
  // the commentary hook only tries to play when allowed.
  const [audioUnlocked, setAudioUnlocked] = useState(false)
  const handleUnlock = useCallback(() => {
    unlockSfx()
    setAudioUnlocked(true)
  }, [])

  const commentary = useCommentary(socket, audioUnlocked)

  return (
    <main className={`overlay-shell${shaking ? ' shaking' : ''}`}>
      <ParallaxBackground tick={gameState?.tick ?? 0} />
      <PixiCanvas
        gameState={gameState}
        poseStreamRef={poseStreamRef}
        onHeavyHit={handleHeavyHit}
      />
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
        roundState={roundState}
      />
      {!audioUnlocked && (
        <button className="audio-unlock" type="button" onClick={handleUnlock}>
          Click to start audio
        </button>
      )}
    </main>
  )
}

export default App
