import { useCallback, useRef, useState } from 'react';
import { PermissionScreen } from './components/PermissionScreen';
import { WarmupScreen } from './components/WarmupScreen';
import { WaitingScreen } from './components/WaitingScreen';
import { useGameSocket } from './hooks/useGameSocket';
import { useWarmup } from './hooks/useWarmup';
import './app.css';

type AppScreen = 'permission' | 'warmup' | 'waiting' | 'game';

function App() {
  const params = new URLSearchParams(window.location.search);
  const serverUrl  = params.get('server') ?? '';
  const roomCode   = params.get('room')?.toUpperCase() ?? '';
  const playerSlot: 1 | 2 = params.get('slot') === '2' ? 2 : 1;

  const [screen, setScreen] = useState<AppScreen>('permission');
  const cameraStreamRef = useRef<MediaStream | null>(null);

  const socket = useGameSocket();
  const { status: warmupStatus, error: warmupError } = useWarmup();

  const handlePermissionGranted = useCallback((stream: MediaStream) => {
    cameraStreamRef.current = stream;
    setScreen('warmup');
  }, []);

  const handleWarmupComplete = useCallback(() => {
    // Connect the WebSocket as warmup finishes — the waiting screen needs it
    socket.connect(serverUrl, roomCode, playerSlot);
    setScreen('waiting');
  }, [socket, serverUrl, roomCode, playerSlot]);

  // calibration_start arrives via socket.phase; advance past waiting
  // when both players are present. Phase 13 handles 'calibration' screen.
  const showWaiting = screen === 'waiting' && socket.phase === 'lobby';
  const effectiveSlot: 1 | 2 = socket.assignedSlot ?? playerSlot;

  return (
    <div className="app-root">
      {screen === 'permission' && (
        <PermissionScreen onPermissionGranted={handlePermissionGranted} />
      )}
      {screen === 'warmup' && (
        <WarmupScreen
          status={warmupStatus}
          error={warmupError}
          onWarmupComplete={handleWarmupComplete}
        />
      )}
      {showWaiting && (
        <WaitingScreen
          roomCode={roomCode}
          slot={effectiveSlot}
          opponentConnected={socket.opponentConnected}
        />
      )}
      {screen === 'game' && (
        <div id="game-canvas-root" />
      )}
    </div>
  );
}

export default App;
