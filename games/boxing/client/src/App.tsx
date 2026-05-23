import './app.css'
import { PlayerApp } from './PlayerApp'
import { OverlayApp } from './OverlayApp'

const isPlayer = new URLSearchParams(window.location.search).has('slot')

export default function App() {
  return isPlayer ? <PlayerApp /> : <OverlayApp />
}
