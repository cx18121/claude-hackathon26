import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGameSocket } from '@shared/client/hooks/useGameSocket';
import { normalizeWsUrl } from '@shared/client/wsUrl';

describe('normalizeWsUrl', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeWsUrl('')).toBe('');
    expect(normalizeWsUrl('   ')).toBe('');
  });

  it('passes through ws:// URLs', () => {
    expect(normalizeWsUrl('ws://localhost:8000')).toBe('ws://localhost:8000');
  });

  it('passes through wss:// URLs', () => {
    expect(normalizeWsUrl('wss://example.trycloudflare.com')).toBe(
      'wss://example.trycloudflare.com',
    );
  });

  it('upgrades http:// to ws://', () => {
    expect(normalizeWsUrl('http://192.168.1.42:8000')).toBe(
      'ws://192.168.1.42:8000',
    );
  });

  it('upgrades https:// to wss://', () => {
    expect(normalizeWsUrl('https://shadow.example.com')).toBe(
      'wss://shadow.example.com',
    );
  });

  it('treats bare host:port as ws://', () => {
    expect(normalizeWsUrl('192.168.1.42:8000')).toBe('ws://192.168.1.42:8000');
    expect(normalizeWsUrl('localhost:8000')).toBe('ws://localhost:8000');
  });

  it('strips trailing slash', () => {
    expect(normalizeWsUrl('ws://localhost:8000/')).toBe('ws://localhost:8000');
    expect(normalizeWsUrl('https://example.com/')).toBe('wss://example.com');
    expect(normalizeWsUrl('localhost:8000/')).toBe('ws://localhost:8000');
  });

  it('trims whitespace before normalizing', () => {
    expect(normalizeWsUrl('  ws://localhost:8000  ')).toBe(
      'ws://localhost:8000',
    );
  });
});

// ---------------------------------------------------------------------------
// Mock WebSocket for hook integration tests
// ---------------------------------------------------------------------------

interface MockWsInstance {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  // helpers to simulate server messages
  _trigger: (event: string, data?: unknown) => void;
  _handlers: Map<string, ((e: unknown) => void)[]>;
}

let mockWsInstance: MockWsInstance | null = null;

function createMockWs(): MockWsInstance {
  const handlers = new Map<string, ((e: unknown) => void)[]>();
  const ws: MockWsInstance = {
    readyState: 0, // CONNECTING
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn((event: string, handler: (e: unknown) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }),
    removeEventListener: vi.fn(),
    _trigger: (event: string, data?: unknown) => {
      const list = handlers.get(event) ?? [];
      for (const h of list) {
        h(data ?? {});
      }
    },
    _handlers: handlers,
  };
  return ws;
}

describe('useGameSocket — gameType state', () => {
  const OriginalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    mockWsInstance = createMockWs();
    // The hook calls `new WebSocket(url)`. Return our mock instance from the constructor.
    const MockWS = function () { return mockWsInstance; };
    MockWS.CONNECTING = 0; MockWS.OPEN = 1; MockWS.CLOSING = 2; MockWS.CLOSED = 3;
    // @ts-expect-error mock replacement
    globalThis.WebSocket = MockWS;
    // Suppress console.warn from the hook during tests
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.WebSocket = OriginalWebSocket;
    vi.restoreAllMocks();
    mockWsInstance = null;
  });

  it('gameType defaults to null before any joined message', () => {
    const { result } = renderHook(() => useGameSocket());
    expect(result.current.gameType).toBeNull();
  });

  it('gameType is null after connect but before joined message arrives', () => {
    const { result } = renderHook(() => useGameSocket());
    act(() => {
      result.current.connect('ws://localhost:8000', 'ROOM01', 1);
    });
    expect(result.current.gameType).toBeNull();
  });

  it('gameType becomes "dance" when server sends joined with game_type dance', () => {
    const { result } = renderHook(() => useGameSocket());
    act(() => {
      result.current.connect('ws://localhost:8000', 'ROOM01', 1);
    });
    // Simulate WebSocket open
    act(() => {
      mockWsInstance!._trigger('open');
    });
    // Simulate server sending joined message
    act(() => {
      mockWsInstance!._trigger('message', {
        data: JSON.stringify({
          type: 'joined',
          room_code: 'ROOM01',
          player_slot: 1,
          opponent_connected: false,
          game_type: 'dance',
        }),
      });
    });
    expect(result.current.gameType).toBe('dance');
  });

  it('gameType becomes "boxing" when server sends joined with game_type boxing', () => {
    const { result } = renderHook(() => useGameSocket());
    act(() => {
      result.current.connect('ws://localhost:8000', 'ROOM01', 1);
    });
    act(() => {
      mockWsInstance!._trigger('open');
    });
    act(() => {
      mockWsInstance!._trigger('message', {
        data: JSON.stringify({
          type: 'joined',
          room_code: 'ROOM01',
          player_slot: 1,
          opponent_connected: false,
          game_type: 'boxing',
        }),
      });
    });
    expect(result.current.gameType).toBe('boxing');
  });
});

// ---------------------------------------------------------------------------
// Task 10 — Phase 5: error state and reconnect behavior
// ---------------------------------------------------------------------------

describe('useGameSocket — error state and reconnect', () => {
  const OriginalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    mockWsInstance = createMockWs();
    const MockWS = function () { return mockWsInstance; };
    MockWS.CONNECTING = 0; MockWS.OPEN = 1; MockWS.CLOSING = 2; MockWS.CLOSED = 3;
    // @ts-expect-error mock replacement
    globalThis.WebSocket = MockWS;
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.WebSocket = OriginalWebSocket;
    vi.restoreAllMocks();
    vi.useRealTimers();
    mockWsInstance = null;
  });

  it('sets errorCode to room_not_found when close code 4004 is received', () => {
    const { result } = renderHook(() => useGameSocket());
    act(() => {
      result.current.connect('ws://localhost:8000', 'NOROOM', 1);
    });
    act(() => {
      mockWsInstance!._trigger('close', { code: 4004, reason: 'Room not found' });
    });
    expect(result.current.errorCode).toBe('room_not_found');
    expect(result.current.status).toBe('error');
  });

  it('sets errorCode to slot_taken when close code 4000 is received', () => {
    const { result } = renderHook(() => useGameSocket());
    act(() => {
      result.current.connect('ws://localhost:8000', 'ROOM01', 1);
    });
    act(() => {
      mockWsInstance!._trigger('close', { code: 4000, reason: 'Slot taken' });
    });
    expect(result.current.errorCode).toBe('slot_taken');
    expect(result.current.status).toBe('error');
  });

  it('resets state to disconnected after disconnect() is called', () => {
    const { result } = renderHook(() => useGameSocket());
    act(() => {
      result.current.connect('ws://localhost:8000', 'ROOM01', 1);
    });
    act(() => {
      result.current.disconnect();
    });
    expect(result.current.status).toBe('disconnected');
    expect(result.current.phase).toBe('lobby');
    expect(result.current.opponentConnected).toBe(false);
  });

  it('schedules reconnect on unexpected close (non-4000, non-4004)', () => {
    const { result } = renderHook(() => useGameSocket());
    act(() => {
      result.current.connect('ws://localhost:8000', 'ROOM01', 1);
    });
    act(() => {
      mockWsInstance!._trigger('close', { code: 1006, reason: '' });
    });
    // After unexpected close, status should be 'connecting' (reconnect scheduled)
    expect(result.current.status).toBe('connecting');
  });
});
