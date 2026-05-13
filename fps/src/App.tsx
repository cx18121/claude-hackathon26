import { useState } from 'react';
import './app.css';

type AppScreen = 'permission' | 'warmup' | 'waiting' | 'game';

function App() {
  const params = new URLSearchParams(window.location.search);
  const serverUrl = params.get('server') ?? '';
  const roomCode  = params.get('room')?.toUpperCase() ?? '';
  const playerSlot: 1 | 2 = params.get('slot') === '2' ? 2 : 1;

  const [screen, setScreen] = useState<AppScreen>('permission');

  void serverUrl;
  void roomCode;
  void playerSlot;
  void setScreen;

  return (
    <div className="app-root">
      <p>Screen: {screen}</p>
      <div id="game-canvas-root" />
    </div>
  );
}

export default App;
