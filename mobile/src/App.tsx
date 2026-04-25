import { useEffect, useRef, useState } from 'react';
import { ConnectionScreen } from './components/ConnectionScreen';
import { GameScreen } from './components/GameScreen';
import { useGameSocket } from './hooks/useGameSocket';
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
  const [shouldConnect, setShouldConnect] = useState(false);

  const socket = useGameSocket(serverUrl, roomCode, playerSlot);
  const persistedRef = useRef(false);

  // Effect: open the WebSocket once the user has supplied a server+room.
  // The hook's connect() reads from its closure of serverUrl/roomCode, so we
  // must wait for those to settle into state before calling it.
  useEffect(() => {
    if (shouldConnect && serverUrl && roomCode) {
      socket.connect();
      setShouldConnect(false);
    }
  }, [shouldConnect, serverUrl, roomCode, socket]);

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
    setShouldConnect(true);
  };

  const showGame =
    socket.status === 'connected' || socket.status === 'connecting';

  // The server picks the slot itself (first open) and ignores the value the
  // client sent in 'join'. Once we've heard back from the server, prefer its
  // assignment over the locally selected slot so UI labels and win/lose
  // messaging line up with what the server is actually scoring.
  const effectiveSlot: 1 | 2 = socket.assignedSlot ?? playerSlot;

  return (
    <div className="app-root">
      {showGame ? (
        <GameScreen
          status={socket.status}
          phase={socket.phase}
          roomCode={roomCode}
          playerSlot={effectiveSlot}
          rttMs={socket.rttMs}
          highLatency={socket.highLatency}
          opponentConnected={socket.opponentConnected}
          lastHit={socket.lastHit}
          matchEnd={socket.matchEnd}
          send={socket.send}
          setPhase={socket.setPhase}
          onDisconnect={socket.disconnect}
        />
      ) : (
        <ConnectionScreen
          initialServerUrl={serverUrl}
          initialRoomCode={roomCode}
          initialSlot={playerSlot}
          status={socket.status}
          errorMessage={socket.errorMessage}
          onConnect={handleConnect}
        />
      )}
    </div>
  );
}

export default App;
