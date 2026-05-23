import { useState, type FormEvent } from 'react';
import type { SocketStatus } from '../hooks/useGameSocket';

interface ConnectionScreenProps {
  initialServerUrl: string;
  initialRoomCode: string;
  initialSlot: 1 | 2;
  status: SocketStatus;
  errorMessage: string | null;
  errorCode: 'unreachable' | 'room_not_found' | 'slot_taken' | null;
  fastJoin: boolean;
  gameType: string | null;
  onConnect: (serverUrl: string, roomCode: string, slot: 1 | 2) => void;
  // Creates a fresh room on the server and joins it solo-vs-bot. Only the
  // server URL is required; the room code is generated server-side.
  onPlaySolo: (serverUrl: string) => void;
  onRetry: () => void;
}

export function ConnectionScreen({
  initialServerUrl,
  initialRoomCode,
  initialSlot,
  status,
  errorMessage,
  errorCode,
  fastJoin,
  gameType,
  onConnect,
  onPlaySolo,
  onRetry,
}: ConnectionScreenProps) {
  const [serverUrl, setServerUrl] = useState(initialServerUrl);
  const [roomCode, setRoomCode] = useState(initialRoomCode);
  const [slot, setSlot] = useState<1 | 2>(initialSlot);

  const connecting = status === 'connecting';
  const [showManual, setShowManual] = useState(false);

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!serverUrl.trim() || !roomCode.trim()) return;
    onConnect(serverUrl.trim(), roomCode.trim().toUpperCase(), slot);
  };

  // Fast-join view: shown when all 3 params were prefilled AND user hasn't tapped "Enter manually"
  if (fastJoin && !showManual) {
    return (
      <div className="connection-screen">
        <h1 className="title">Spectre</h1>
        <p className="fast-join-meta">
          {gameType ? `${gameType.toUpperCase()} · ` : ''}
          {`ROOM ${initialRoomCode} · PLAYER ${initialSlot}`}
        </p>
        <button
          className="big-button fast-join-cta"
          onClick={() => onConnect(initialServerUrl, initialRoomCode, initialSlot)}
          disabled={connecting}
          style={{ marginTop: 32 }}
        >
          {connecting ? 'Joining...' : 'Join game'}
        </button>
        <button className="enter-manually" onClick={() => setShowManual(true)}>
          Enter manually
        </button>
        {errorMessage ? (
          <div className="error-banner">
            {errorMessage}
            {errorCode === 'unreachable' && (
              <button
                className="retry-button"
                onClick={onRetry}
                disabled={connecting}
              >
                Retry
              </button>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="connection-screen">
      <h1 className="title">Spectre</h1>

      <form onSubmit={submit} style={{ display: 'contents' }}>
        <p className="subtitle">Join a match</p>

        {/* Server URL visible when: no ?server= param given, OR user tapped "Enter manually" (D-06, D-08) */}
        {(!initialServerUrl || showManual) && (
          <label className="field">
            <span>Server URL</span>
            <input
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="ws://192.168.1.42:8000"
            />
          </label>
        )}

        <label className="field">
          <span>Room code</span>
          <input
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
          />
        </label>

        <fieldset className="slot-picker">
          <legend>Player slot</legend>
          <label className={`slot-option${slot === 1 ? ' selected' : ''}`}>
            <input
              type="radio"
              name="slot"
              value={1}
              checked={slot === 1}
              onChange={() => setSlot(1)}
            />
            <span>Player 1</span>
          </label>
          <label className={`slot-option${slot === 2 ? ' selected' : ''}`}>
            <input
              type="radio"
              name="slot"
              value={2}
              checked={slot === 2}
              onChange={() => setSlot(2)}
            />
            <span>Player 2</span>
          </label>
        </fieldset>

        <button
          type="submit"
          className="big-button"
          disabled={connecting || !serverUrl || !roomCode}
        >
          {connecting ? 'Connecting...' : 'Connect'}
        </button>

        {/* Solo button creates a fresh room and joins as P1 vs the bot — no
            room code required. Disabled until the user has typed a server URL. */}
        <button
          type="button"
          className="solo-button"
          disabled={connecting || !serverUrl.trim()}
          onClick={() => onPlaySolo(serverUrl.trim())}
        >
          {connecting ? 'Starting solo…' : 'Play solo (vs bot)'}
        </button>
      </form>

      {errorMessage ? (
        <div className="error-banner">
          {errorMessage}
          {errorCode === 'unreachable' && (
            <button
              className="retry-button"
              onClick={onRetry}
              disabled={connecting}
            >
              Retry
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
