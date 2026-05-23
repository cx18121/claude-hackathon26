import { useCallback, useRef, useState } from 'react';
import { PermissionScreen } from './components/PermissionScreen';
import { WarmupScreen } from './components/WarmupScreen';
import { WaitingScreen } from './components/WaitingScreen';
import { CalibrationScreen } from './components/CalibrationScreen';
import { GameRenderer } from './components/GameRenderer';
import { useGameSocket } from './hooks/useGameSocket';
import { useWarmup } from './hooks/useWarmup';
import { usePose } from './hooks/usePose';
import { useOneEuroFilter } from './hooks/useOneEuroFilter';
import './app.css';

type AppScreen = 'permission' | 'warmup' | 'waiting' | 'game';

function App() {
  const params = new URLSearchParams(window.location.search);
  const serverUrl  = params.get('server') ?? '';
  const roomCode   = params.get('room')?.toUpperCase() ?? '';
  const playerSlot: 1 | 2 = params.get('slot') === '2' ? 2 : 1;

  const [screen, setScreen] = useState<AppScreen>('permission');
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const socket = useGameSocket();
  const { status: warmupStatus, error: warmupError, workerRef } = useWarmup();

  // cameraReady: true after permission granted AND warmup complete
  const cameraReady = screen !== 'permission' && screen !== 'warmup' && warmupStatus === 'ready';

  // usePose called unconditionally at App level so Phase 14 can reuse the same hook instance
  const pose = usePose(videoRef, cameraReady, workerRef);
  const smoothedKeypoints = useOneEuroFilter(pose.keypoints);

  const handlePermissionGranted = useCallback((stream: MediaStream) => {
    cameraStreamRef.current = stream;
    setScreen('warmup');
  }, []);

  const handleWarmupComplete = useCallback(() => {
    // Connect the WebSocket as warmup finishes — the waiting screen needs it
    socket.connect(serverUrl, roomCode, playerSlot);
    setScreen('waiting');
  }, [socket, serverUrl, roomCode, playerSlot]);

  // Phase-driven screen routing
  const showWaiting     = screen === 'waiting' && socket.phase === 'lobby';
  const showCalibration = screen === 'waiting' && socket.phase === 'calibration';
  const showMatch       = screen === 'waiting' && (socket.phase === 'match' || socket.phase === 'ended');
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
      {showCalibration && (
        <CalibrationScreen
          stream={cameraStreamRef.current}
          keypoints={smoothedKeypoints}
          videoRef={videoRef}
          onCalibrationDone={(refVel) => {
            socket.send({ type: 'calibration_done', reference_velocity: refVel });
          }}
        />
      )}
      {showMatch && (
        <GameRenderer smoothedKeypoints={smoothedKeypoints} socket={socket} playerSlot={effectiveSlot} />
      )}
    </div>
  );
}

export default App;
