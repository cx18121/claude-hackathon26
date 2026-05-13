import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWarmup } from './useWarmup';

// Mock Worker globally — jsdom doesn't implement Worker
const mockPostMessage = vi.fn();
let capturedOnMessage: ((e: MessageEvent) => void) | null = null;
let capturedOnError: ((e: ErrorEvent) => void) | null = null;
const mockTerminate = vi.fn();

class MockWorker {
  postMessage = mockPostMessage;
  terminate = mockTerminate;
  set onmessage(handler: (e: MessageEvent) => void) {
    capturedOnMessage = handler;
  }
  set onerror(handler: (e: ErrorEvent) => void) {
    capturedOnError = handler;
  }
}

beforeEach(() => {
  mockPostMessage.mockReset();
  mockTerminate.mockReset();
  capturedOnMessage = null;
  capturedOnError = null;
  vi.stubGlobal('Worker', MockWorker);
});

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

describe('useWarmup', () => {
  it('Test 1: initial status is loading on mount', () => {
    const { result } = renderHook(() => useWarmup());
    expect(result.current.status).toBe('loading');
  });

  it('Test 2: status becomes ready when worker posts ready', async () => {
    const { result } = renderHook(() => useWarmup());

    await act(async () => {
      capturedOnMessage?.({ data: { type: 'ready' } } as MessageEvent);
    });

    expect(result.current.status).toBe('ready');
  });

  it('Test 3: status becomes error when worker posts error message', async () => {
    const { result } = renderHook(() => useWarmup());

    await act(async () => {
      capturedOnMessage?.({
        data: { type: 'error', message: 'WASM load failed' },
      } as MessageEvent);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('WASM load failed');
  });

  it('Test 4: status becomes error when worker fires onerror', async () => {
    const { result } = renderHook(() => useWarmup());

    await act(async () => {
      capturedOnError?.({ message: 'script error' } as ErrorEvent);
    });

    expect(result.current.status).toBe('error');
  });

  it('Test 5: worker is not terminated after status becomes ready', async () => {
    const { result } = renderHook(() => useWarmup());

    await act(async () => {
      capturedOnMessage?.({ data: { type: 'ready' } } as MessageEvent);
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.workerRef.current).not.toBeNull();
    expect(mockTerminate).not.toHaveBeenCalled();
  });

  it('Test 6: init message sent with correct WASM and model URLs', () => {
    renderHook(() => useWarmup());

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'init',
      wasmUrl: WASM_URL,
      modelUrl: MODEL_URL,
    });
  });
});
