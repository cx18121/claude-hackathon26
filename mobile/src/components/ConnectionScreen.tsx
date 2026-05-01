import { useState, type FormEvent } from 'react';
import type { SocketStatus } from '../hooks/useGameSocket';

interface ConnectionScreenProps {
  initialServerUrl: string;
  initialRoomCode: string;
  initialSlot: 1 | 2;
  status: SocketStatus;
  errorMessage: string | null;
  soloLoading: boolean;
  onConnect: (serverUrl: string, roomCode: string, slot: 1 | 2) => void;
  onSoloStart: (serverUrl: string, difficulty: string) => void;
}

type Mode = 'multiplayer' | 'solo';
type Difficulty = 'easy' | 'normal' | 'hard';

const DIFFICULTIES: { value: Difficulty; label: string; hint: string }[] = [
  { value: 'easy',   label: 'Easy',   hint: 'relaxed pace' },
  { value: 'normal', label: 'Normal', hint: 'balanced challenge' },
  { value: 'hard',   label: 'Hard',   hint: 'relentless bot' },
];

export function ConnectionScreen({
  initialServerUrl,
  initialRoomCode,
  initialSlot,
  status,
  errorMessage,
  soloLoading,
  onConnect,
  onSoloStart,
}: ConnectionScreenProps) {
  const [mode, setMode] = useState<Mode>('multiplayer');
  const [serverUrl, setServerUrl] = useState(initialServerUrl);
  const [roomCode, setRoomCode] = useState(initialRoomCode);
  const [slot, setSlot] = useState<1 | 2>(initialSlot);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');

  const connecting = status === 'connecting';
  const busy = connecting || soloLoading;

  const submitMultiplayer = (ev: FormEvent) => {
    ev.preventDefault();
    if (!serverUrl.trim() || !roomCode.trim()) return;
    onConnect(serverUrl.trim(), roomCode.trim().toUpperCase(), slot);
  };

  const submitSolo = (ev: FormEvent) => {
    ev.preventDefault();
    if (!serverUrl.trim()) return;
    onSoloStart(serverUrl.trim(), difficulty);
  };

  return (
    <div className="connection-screen">
      <h1 className="title">Spectre</h1>

      <div className="mode-toggle">
        <button
          type="button"
          className={`mode-btn${mode === 'multiplayer' ? ' active' : ''}`}
          onClick={() => setMode('multiplayer')}
        >
          Multiplayer
        </button>
        <button
          type="button"
          className={`mode-btn${mode === 'solo' ? ' active' : ''}`}
          onClick={() => setMode('solo')}
        >
          Solo
        </button>
      </div>

      {mode === 'multiplayer' ? (
        <form onSubmit={submitMultiplayer} style={{ display: 'contents' }}>
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
            disabled={busy || !serverUrl || !roomCode}
          >
            {connecting ? 'Connecting...' : 'Connect'}
          </button>
        </form>
      ) : (
        <form onSubmit={submitSolo} style={{ display: 'contents' }}>
          <p className="subtitle">Fight the bot</p>

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

          <fieldset className="difficulty-picker">
            <legend>Difficulty</legend>
            {DIFFICULTIES.map(({ value, label, hint }) => (
              <label key={value} className={`diff-option${difficulty === value ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="difficulty"
                  value={value}
                  checked={difficulty === value}
                  onChange={() => setDifficulty(value)}
                />
                <span className="diff-label">{label}</span>
                <span className="diff-hint">{hint}</span>
              </label>
            ))}
          </fieldset>

          <button
            type="submit"
            className="big-button"
            disabled={busy || !serverUrl}
          >
            {soloLoading ? 'Starting...' : 'Start Solo'}
          </button>
        </form>
      )}

      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
    </div>
  );
}
