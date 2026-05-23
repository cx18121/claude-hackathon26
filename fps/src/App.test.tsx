import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';
import { useGameSocket } from './hooks/useGameSocket';
import { useWarmup } from './hooks/useWarmup';
import { usePose } from './hooks/usePose';
import { useOneEuroFilter } from './hooks/useOneEuroFilter';

// Mock all hooks and components
vi.mock('./hooks/useGameSocket');
vi.mock('./hooks/useWarmup');
vi.mock('./hooks/usePose');
vi.mock('./hooks/useOneEuroFilter');
vi.mock('./components/CalibrationScreen', () => ({
  CalibrationScreen: ({ onCalibrationDone }: { onCalibrationDone: (v: number) => void }) => (
    <div data-testid="calibration-screen">
      <button onClick={() => onCalibrationDone(3.5)}>done</button>
    </div>
  ),
}));
vi.mock('./components/PermissionScreen', () => ({
  PermissionScreen: ({ onPermissionGranted }: { onPermissionGranted: (s: MediaStream) => void }) => (
    <div data-testid="permission-screen">
      <button onClick={() => onPermissionGranted({} as MediaStream)}>grant</button>
    </div>
  ),
}));
vi.mock('./components/WarmupScreen', () => ({
  WarmupScreen: ({ onWarmupComplete }: { onWarmupComplete: () => void }) => (
    <div data-testid="warmup-screen">
      <button onClick={onWarmupComplete}>complete</button>
    </div>
  ),
}));
vi.mock('./components/WaitingScreen', () => ({
  WaitingScreen: () => <div data-testid="waiting-screen" />,
}));
vi.mock('./components/GameRenderer', () => ({
  GameRenderer: () => <div data-testid="game-renderer" />,
}));

const mockGameSocket = vi.mocked(useGameSocket);
const mockUseWarmup = vi.mocked(useWarmup);
const mockUsePose = vi.mocked(usePose);
const mockUseOneEuroFilter = vi.mocked(useOneEuroFilter);

const mockSend = vi.fn();
const mockConnect = vi.fn();

function setupMocks(phase: 'lobby' | 'calibration' | 'match' = 'lobby') {
  const mockWorkerRef = { current: {} as Worker };

  mockGameSocket.mockReturnValue({
    phase,
    send: mockSend,
    status: 'connected',
    opponentConnected: phase !== 'lobby',
    assignedSlot: 1,
    connect: mockConnect,
    disconnect: vi.fn(),
    setPhase: vi.fn(),
    playAgain: vi.fn() as () => Promise<void>,
    lastHit: null,
    highLatency: false,
    rttMs: 0,
    roundNumber: 1,
    lastRoundEnd: null,
    matchEnd: null,
    errorMessage: null,
    errorCode: null,
    gameType: null,
    lastFpsState: null,
    lastFpsHit: null,
  });

  mockUseWarmup.mockReturnValue({
    status: 'ready',
    error: null,
    workerRef: mockWorkerRef,
  });

  mockUsePose.mockReturnValue({
    keypoints: null,
    imageKeypoints: null,
    fps: 0,
    modelStatus: 'idle',
    modelError: null,
  });

  mockUseOneEuroFilter.mockReturnValue(null);

  return mockWorkerRef;
}

/** Helper: render App and advance past permission + warmup screens to reach 'waiting' state */
function renderAtWaiting(phase: 'lobby' | 'calibration' | 'match' = 'lobby') {
  const workerRef = setupMocks(phase);
  render(<App />);

  // Advance through permission screen
  fireEvent.click(screen.getByText('grant'));

  // Advance through warmup screen
  fireEvent.click(screen.getByText('complete'));

  return workerRef;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSend.mockClear();
  mockConnect.mockClear();
});

describe('App phase routing', () => {
  it('renders CalibrationScreen when socket.phase === calibration', () => {
    renderAtWaiting('calibration');

    expect(screen.getByTestId('calibration-screen')).toBeTruthy();
    expect(screen.queryByTestId('waiting-screen')).toBeNull();
  });

  it('renders WaitingScreen when socket.phase === lobby', () => {
    renderAtWaiting('lobby');

    expect(screen.getByTestId('waiting-screen')).toBeTruthy();
    expect(screen.queryByTestId('calibration-screen')).toBeNull();
  });

  it('renders GameRenderer when socket.phase === match', () => {
    renderAtWaiting('match');

    expect(screen.getByTestId('game-renderer')).toBeTruthy();
  });

  it('sends reference_velocity (not arm_reach) in calibration_done', () => {
    renderAtWaiting('calibration');

    const doneBtn = screen.getByText('done');
    fireEvent.click(doneBtn);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'calibration_done', reference_velocity: 3.5 })
    );

    // Explicitly assert arm_reach is NOT in the sent message
    const sentArg = mockSend.mock.calls[mockSend.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(sentArg).not.toHaveProperty('arm_reach');
  });

  it('calls usePose with the workerRef from useWarmup', () => {
    const mockWorkerRef = renderAtWaiting('lobby');

    expect(mockUsePose).toHaveBeenCalled();
    // Third argument should be the workerRef from useWarmup
    const callArgs = mockUsePose.mock.calls[0];
    expect(callArgs[2]).toBe(mockWorkerRef);
  });

  it('calls useOneEuroFilter with usePose keypoints', () => {
    const testKeypoints = [{ x: 1, y: 0, z: 0, visibility: 1 }];
    setupMocks('lobby');
    mockUsePose.mockReturnValue({
      keypoints: testKeypoints,
      imageKeypoints: null,
      fps: 0,
      modelStatus: 'idle',
      modelError: null,
    });

    render(<App />);

    expect(mockUseOneEuroFilter).toHaveBeenCalledWith(testKeypoints);
  });
});
