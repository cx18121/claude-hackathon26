import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionScreen } from './components/PermissionScreen';
import { WarmupScreen } from './components/WarmupScreen';
import { WaitingScreen } from './components/WaitingScreen';
import { CalibrationScreen } from './components/CalibrationScreen';
import { GameRenderer } from './components/GameRenderer';
import { useGameSocket } from './hooks/useGameSocket';
import { useWarmup } from './hooks/useWarmup';
import { usePose } from './hooks/usePose';
import { useOneEuroFilter } from './hooks/useOneEuroFilter';
import { usePunchClassifier } from './hooks/usePunchClassifier';
import type { MsgPunchDetected } from './hooks/usePunchClassifier';
import type { LabeledSample } from '@shared/client/useCalibration';
import type { OutboundMobileMsg } from '@shared/protocol';
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

  // usePose called unconditionally at App level so the video element (always in DOM) feeds frames
  const pose = usePose(videoRef, cameraReady, workerRef);
  const smoothedKeypoints = useOneEuroFilter(pose.keypoints);

  // Phase-driven screen routing
  const showWaiting     = screen === 'waiting' && socket.phase === 'lobby';
  const showCalibration = screen === 'waiting' && socket.phase === 'calibration';
  const showMatch       = screen === 'waiting' && (socket.phase === 'match' || socket.phase === 'ended');
  const effectiveSlot: 1 | 2 = socket.assignedSlot ?? playerSlot;

  // Punch classifier — active only during match to save CPU
  const { type: punchType, confidence, speed, setPrototypes } = usePunchClassifier(showMatch ? smoothedKeypoints : null);
  const prevPunchTypeRef = useRef<string | null>(null);

  // Send punch_detected to server on each new classified punch event
  useEffect(() => {
    if (!showMatch) return;
    if (punchType !== null && punchType !== 'guard' && punchType !== prevPunchTypeRef.current) {
      prevPunchTypeRef.current = punchType;
      const msg: MsgPunchDetected = { type: 'punch_detected', punch_type: punchType, confidence, speed };
      socket.send(msg as unknown as OutboundMobileMsg);
    } else if (punchType === null) {
      prevPunchTypeRef.current = null;
    }
  }, [punchType, confidence, speed, showMatch, socket]);

  const handlePermissionGranted = useCallback((stream: MediaStream) => {
    cameraStreamRef.current = stream;
    // Wire stream to the persistent video element immediately
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
    setScreen('warmup');
  }, []);

  const handleWarmupComplete = useCallback(() => {
    socket.connect(serverUrl, roomCode, playerSlot);
    setScreen('waiting');
  }, [socket, serverUrl, roomCode, playerSlot]);

  // Fallback: wire stream if video ref resolves after permission was granted
  useEffect(() => {
    const video = videoRef.current;
    const stream = cameraStreamRef.current;
    if (video && stream && !video.srcObject) {
      video.srcObject = stream;
    }
  });

  return (
    <div className="app-root">
      {/* Persistent video element — always in DOM so usePose keeps receiving frames after calibration */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={showCalibration ? 'calibration-video' : 'video-hidden'}
      />

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
          keypoints={smoothedKeypoints}
          onCalibrationDone={(refVel: number, samples?: LabeledSample[]) => {
            socket.send({ type: 'calibration_done', reference_velocity: refVel });
            if (samples) void setPrototypes(samples);
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
