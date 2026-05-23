import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { PoseKeypoint } from '@shared/protocol';

// Mock onnxruntime-web before importing the hook
const mockRun = vi.fn();
const mockCreate = vi.fn();

vi.mock('onnxruntime-web', () => ({
  env: { wasm: { wasmPaths: '' } },
  InferenceSession: { create: mockCreate },
  Tensor: vi.fn().mockImplementation(function(_type: string, data: Float32Array, dims: number[]) {
    return { data, dims };
  }),
}));

// Import hook AFTER mock is set up
const { usePunchClassifier } = await import('./usePunchClassifier');

// Helper: make a full 33-element PoseKeypoint array with plausible shoulder positions
function makeKeypoints(dx = 0): PoseKeypoint[] {
  const kps: PoseKeypoint[] = Array.from({ length: 33 }, () => ({
    x: 0, y: 0, z: 0, visibility: 1,
  }));
  kps[11] = { x: -0.1 + dx, y: 0.0, z: 0.0, visibility: 1 }; // LEFT_SHOULDER
  kps[12] = { x:  0.1 + dx, y: 0.0, z: 0.0, visibility: 1 }; // RIGHT_SHOULDER
  kps[15] = { x: -0.15 + dx, y: -0.5, z: 0.1, visibility: 1 }; // LEFT_WRIST
  kps[16] = { x:  0.15 + dx, y: -0.5, z: 0.1, visibility: 1 }; // RIGHT_WRIST
  return kps;
}

// Logits that strongly favor 'jab' (index 0): [10, -10, -10, -10, -10]
function makeJabLogits() {
  const data = new Float32Array([10, -10, -10, -10, -10]);
  return { logits: { data } };
}

// Logits that are nearly uniform (all near 0) — max softmax will be ~0.2
function makeUniformLogits() {
  const data = new Float32Array([0.1, 0.1, 0.1, 0.1, 0.1]);
  return { logits: { data } };
}

describe('usePunchClassifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: session.run returns uniform logits
    mockRun.mockResolvedValue(makeUniformLogits());
    mockCreate.mockResolvedValue({ run: mockRun });
  });

  it('Test 1: returns null type when keypoints is null', () => {
    const { result } = renderHook(() => usePunchClassifier(null));
    expect(result.current.type).toBeNull();
    expect(result.current.confidence).toBe(0);
    expect(result.current.speed).toBe(0);
  });

  it('Test 2: returns null type until buffer has 20 frames', async () => {
    const kps = makeKeypoints();
    const { result, rerender } = renderHook(
      ({ keypoints }) => usePunchClassifier(keypoints),
      { initialProps: { keypoints: kps } },
    );
    // Provide 19 frames (one short of WINDOW_SIZE=20)
    for (let i = 0; i < 18; i++) {
      act(() => { rerender({ keypoints: makeKeypoints(i * 0.001) }); });
    }
    expect(result.current.type).toBeNull();
  });

  it('Test 3: result always has type, confidence, and speed fields', () => {
    const { result } = renderHook(() => usePunchClassifier(null));
    expect(result.current).toHaveProperty('type');
    expect(result.current).toHaveProperty('confidence');
    expect(result.current).toHaveProperty('speed');
  });

  it('Test 4: InferenceSession.create called exactly once at mount', async () => {
    const { rerender } = renderHook(
      ({ keypoints }) => usePunchClassifier(keypoints),
      { initialProps: { keypoints: makeKeypoints() } },
    );
    // Rerender with new keypoints multiple times
    for (let i = 0; i < 5; i++) {
      act(() => { rerender({ keypoints: makeKeypoints(i * 0.01) }); });
    }
    // Wait for async session creation
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('Test 5: returns jab type after 20 frames when session logits strongly favor jab', async () => {
    mockRun.mockResolvedValue(makeJabLogits());
    const { result, rerender } = renderHook(
      ({ keypoints }) => usePunchClassifier(keypoints),
      { initialProps: { keypoints: makeKeypoints() } },
    );
    // Wait for session to load
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    // Provide 20 frames to fill buffer
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        rerender({ keypoints: makeKeypoints(i * 0.001) });
        await new Promise(r => setTimeout(r, 0));
      });
    }
    // After 20 frames, jab logits should produce type: 'jab'
    expect(result.current.type).toBe('jab');
  });

  it('Test 6: returns null type when max softmax confidence is below 0.7', async () => {
    mockRun.mockResolvedValue(makeUniformLogits()); // ~0.2 confidence each class
    const { result, rerender } = renderHook(
      ({ keypoints }) => usePunchClassifier(keypoints),
      { initialProps: { keypoints: makeKeypoints() } },
    );
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        rerender({ keypoints: makeKeypoints(i * 0.001) });
        await new Promise(r => setTimeout(r, 0));
      });
    }
    expect(result.current.type).toBeNull();
  });
});
