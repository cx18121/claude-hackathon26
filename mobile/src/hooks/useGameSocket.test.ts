import { describe, it, expect } from 'vitest';
import { normalizeWsUrl } from './useGameSocket';

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
