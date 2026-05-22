import { useCallback, useEffect, useRef, useState } from 'react';
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

function readInitialGame(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('game');
}

function App() {
  const [serverUrl, setServerUrl] = useState(readInitialServerUrl);
  const [roomCode, setRoomCode] = useState(readInitialRoomCode);
  const [playerSlot, setPlayerSlot] = useState<1 | 2>(readInitialSlot);
  // Legacy ?solo=1 URL param stays supported; setIsSolo also flips when the
  // Play Solo button is used so the game screen knows to hide opponent UI.
  const [isSolo, setIsSolo] = useState<boolean>(
    () => new URLSearchParams(window.location.search).get('solo') === '1',
  );
  const [soloError, setSoloError] = useState<string | null>(null);
  const [gameType] = useState<string | null>(readInitialGame);
  const connectionArgsRef = useRef<{ serverUrl: string; roomCode: string; slot: 1 | 2 } | null>(null);

  // Compute once at init — all 3 params present = fast-join mode (D-01)
  const serverParam = new URLSearchParams(window.location.search).get('server');
  const roomParam   = new URLSearchParams(window.location.search).get('room');
  const slotParam   = new URLSearchParams(window.location.search).get('slot');
  const allParamsPrefilled = !!serverParam && !!roomParam && !!slotParam;

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
    connectionArgsRef.current = { serverUrl: server, roomCode: room, slot };
    setServerUrl(server);
    setRoomCode(room);
    setPlayerSlot(slot);
    setIsSolo(false);
    socket.connect(server, room, slot);
  };

  const handlePlaySolo = async (server: string) => {
    setSoloError(null);
    setServerUrl(server);
    setPlayerSlot(1);
    setIsSolo(true);
    try {
      const code = await socket.connectSolo(server);
      connectionArgsRef.current = { serverUrl: server, roomCode: code, slot: 1 };
      setRoomCode(code);
    } catch (err) {
      setIsSolo(false);
      setSoloError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRetry = useCallback(() => {
    const args = connectionArgsRef.current;
    if (!args) return;
    socket.connect(args.serverUrl, args.roomCode, args.slot);
  }, [socket]);

  const handleDisconnect = useCallback(() => {
    socket.disconnect();
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
          gameType={socket.gameType}
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
          errorMessage={socket.errorMessage ?? soloError}
          errorCode={socket.errorCode}
          fastJoin={allParamsPrefilled}
          gameType={gameType}
          onConnect={handleConnect}
          onPlaySolo={handlePlaySolo}
          onRetry={handleRetry}
        />
      )}
    </div>
  );
}

export default App;
