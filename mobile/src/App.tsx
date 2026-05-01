import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionScreen } from './components/ConnectionScreen';
import { GameScreen } from './components/GameScreen';
import { useGameSocket, normalizeHttpUrl } from './hooks/useGameSocket';
import './app.css';

const SERVER_URL_STORAGE_KEY = 'shadowfight.serverUrl';

function readInitialServerUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return (
    params.get('server') ??
    window.localStorage.getItem(SERVER_URL_STORAGE_KEY) ??
    ''
  );
}

function readInitialRoomCode(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('room')?.toUpperCase() ?? '';
}

function readInitialSlot(): 1 | 2 {
  const params = new URLSearchParams(window.location.search);
  const v = params.get('slot');
  return v === '2' ? 2 : 1;
}

function App() {
  const [serverUrl, setServerUrl] = useState(readInitialServerUrl);
  const [roomCode, setRoomCode] = useState(readInitialRoomCode);
  const [playerSlot, setPlayerSlot] = useState<1 | 2>(readInitialSlot);
  const [isSolo, setIsSolo] = useState(false);
  const [soloLoading, setSoloLoading] = useState(false);

  const socket = useGameSocket();
  const persistedRef = useRef(false);

  // Persist server URL on a successful connection.
  useEffect(() => {
    if (socket.status === 'connected' && serverUrl && !persistedRef.current) {
      window.localStorage.setItem(SERVER_URL_STORAGE_KEY, serverUrl);
      persistedRef.current = true;
    }
    if (socket.status === 'disconnected') {
      persistedRef.current = false;
    }
  }, [socket.status, serverUrl]);

  const handleConnect = (server: string, room: string, slot: 1 | 2) => {
    setServerUrl(server);
    setRoomCode(room);
    setPlayerSlot(slot);
    setIsSolo(false);
    socket.connect(server, room, slot);
  };

  const handleSoloStart = useCallback(async (server: string, difficulty: string) => {
    setServerUrl(server);
    setSoloLoading(true);
    try {
      const base = normalizeHttpUrl(server);
      const res = await fetch(`${base}/rooms?mode=solo&difficulty=${encodeURIComponent(difficulty)}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to create room');
      const { code } = await res.json() as { code: string };
      window.localStorage.setItem(SERVER_URL_STORAGE_KEY, server);
      setRoomCode(code);
      setPlayerSlot(1);
      setIsSolo(true);
      socket.connect(server, code, 1);
    } catch {
      // Error will surface via socket.errorMessage or user retries
    } finally {
      setSoloLoading(false);
    }
  }, [socket]);

  const handleDisconnect = useCallback(() => {
    socket.disconnect();
    setIsSolo(false);
  }, [socket]);

  const showGame =
    socket.status === 'connected' || socket.status === 'connecting';

  const effectiveSlot: 1 | 2 = socket.assignedSlot ?? playerSlot;

  return (
    <div className="app-root">
      {showGame ? (
        <GameScreen
          status={socket.status}
          phase={socket.phase}
          roundNumber={socket.roundNumber}
          roomCode={roomCode}
          playerSlot={effectiveSlot}
          rttMs={socket.rttMs}
          highLatency={socket.highLatency}
          opponentConnected={socket.opponentConnected}
          lastHit={socket.lastHit}
          matchEnd={socket.matchEnd}
          isSolo={isSolo}
          send={socket.send}
          onDisconnect={handleDisconnect}
          onPlayAgain={socket.playAgain}
        />
      ) : (
        <ConnectionScreen
          initialServerUrl={serverUrl}
          initialRoomCode={roomCode}
          initialSlot={playerSlot}
          status={socket.status}
          errorMessage={socket.errorMessage}
          soloLoading={soloLoading}
          onConnect={handleConnect}
          onSoloStart={handleSoloStart}
        />
      )}
    </div>
  );
}

export default App;
