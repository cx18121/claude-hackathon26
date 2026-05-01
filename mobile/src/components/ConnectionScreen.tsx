import { useState, type FormEvent } from 'react';
import type { SocketStatus } from '../hooks/useGameSocket';

interface ConnectionScreenProps {
  initialServerUrl: string;
  initialRoomCode: string;
  initialSlot: 1 | 2;
  status: SocketStatus;
  errorMessage: string | null;
  onConnect: (serverUrl: string, roomCode: string, slot: 1 | 2) => void;
}

export function ConnectionScreen({
  initialServerUrl,
  initialRoomCode,
  initialSlot,
  status,
  errorMessage,
  onConnect,
}: ConnectionScreenProps) {
  const [serverUrl, setServerUrl] = useState(initialServerUrl);
  const [roomCode, setRoomCode] = useState(initialRoomCode);
  const [slot, setSlot] = useState<1 | 2>(initialSlot);

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!serverUrl.trim() || !roomCode.trim()) return;
    onConnect(serverUrl.trim(), roomCode.trim().toUpperCase(), slot);
  };

  const connecting = status === 'connecting';

  return (
    <form className="connection-screen" onSubmit={submit}>
      <h1 className="title">Spectre</h1>
      <p className="subtitle">Join a match</p>

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

      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
    </form>
  );
}
