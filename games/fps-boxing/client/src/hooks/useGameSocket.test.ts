import { describe, it, expect } from 'vitest';
import { normalizeWsUrl, normalizeHttpUrl } from '@shared/client/wsUrl';

describe('normalizeWsUrl', () => {
  it('passes through ws:// URLs unchanged', () => {
    expect(normalizeWsUrl('ws://localhost:8000')).toBe('ws://localhost:8000');
  });
  it('passes through wss:// URLs unchanged', () => {
    expect(normalizeWsUrl('wss://myserver.com')).toBe('wss://myserver.com');
  });
  it('converts http:// to ws://', () => {
    expect(normalizeWsUrl('http://localhost:8000')).toBe('ws://localhost:8000');
  });
  it('converts https:// to wss://', () => {
    expect(normalizeWsUrl('https://myserver.com')).toBe('wss://myserver.com');
  });
  it('treats bare host:port as ws://', () => {
    expect(normalizeWsUrl('localhost:8000')).toBe('ws://localhost:8000');
  });
  it('strips trailing slash', () => {
    expect(normalizeWsUrl('wss://myserver.com/')).toBe('wss://myserver.com');
  });
});

describe('normalizeHttpUrl', () => {
  it('passes through http:// URLs unchanged', () => {
    expect(normalizeHttpUrl('http://localhost:8000')).toBe('http://localhost:8000');
  });
  it('converts ws:// to http://', () => {
    expect(normalizeHttpUrl('ws://localhost:8000')).toBe('http://localhost:8000');
  });
  it('converts wss:// to https://', () => {
    expect(normalizeHttpUrl('wss://myserver.com')).toBe('https://myserver.com');
  });
  it('treats bare host as http://', () => {
    expect(normalizeHttpUrl('localhost:8000')).toBe('http://localhost:8000');
  });
});
