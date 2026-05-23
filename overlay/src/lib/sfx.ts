export type SfxName =
  | 'hit_light'
  | 'hit_heavy'
  | 'round_bell'
  | 'round_end'
  | 'match_win'

const audioFiles: Record<SfxName, string> = {
  hit_light: `${import.meta.env.BASE_URL}sfx/punch.mp3`,
  hit_heavy: `${import.meta.env.BASE_URL}sfx/kick.mp3`,
  round_bell: `${import.meta.env.BASE_URL}sfx/round_bell.ogg`,
  round_end: `${import.meta.env.BASE_URL}sfx/death.mp3`,
  match_win: `${import.meta.env.BASE_URL}sfx/match_win.ogg`,
}

const fallbackTones: Record<SfxName, { frequency: number; duration: number; gain: number }> = {
  hit_light: { frequency: 180, duration: 0.08, gain: 0.08 },
  hit_heavy: { frequency: 95, duration: 0.14, gain: 0.14 },
  round_bell: { frequency: 650, duration: 0.25, gain: 0.08 },
  round_end: { frequency: 300, duration: 0.35, gain: 0.1 },
  match_win: { frequency: 520, duration: 0.45, gain: 0.11 },
}

let audioUnlocked = false
let audioContext: AudioContext | null = null
let globalSfxVolume = 1.0

function getAudioContext() {
  audioContext ??= new AudioContext()
  return audioContext
}

function playFallbackTone(name: SfxName, volume: number) {
  if (!audioContext || audioContext.state !== 'running') {
    return
  }

  const tone = fallbackTones[name]
  const oscillator = audioContext.createOscillator()
  const gain = audioContext.createGain()
  const now = audioContext.currentTime

  oscillator.type = name.includes('hit') ? 'square' : 'triangle'
  oscillator.frequency.setValueAtTime(tone.frequency, now)
  oscillator.frequency.exponentialRampToValueAtTime(
    Math.max(40, tone.frequency * 0.55),
    now + tone.duration,
  )
  gain.gain.setValueAtTime(tone.gain * volume, now)
  gain.gain.exponentialRampToValueAtTime(0.001, now + tone.duration)

  oscillator.connect(gain).connect(audioContext.destination)
  oscillator.start(now)
  oscillator.stop(now + tone.duration)
}

class SfxPlayer {
  private readonly sounds = new Map<SfxName, HTMLAudioElement>()
  private preloaded = false

  constructor() {
    // NB: do NOT preload here. Chromium >=92 marks Audio elements created
    // before any user gesture as autoplay-blocked, and cloneNode() inherits
    // that state — so hit_light/hit_heavy would silently fall back to
    // oscillator tones even after unlockSfx() ran. preloadAll() is now
    // invoked from unlockSfx() on the user-gesture path.
  }

  ensurePreloaded() {
    if (this.preloaded) return
    this.preloaded = true
    this.preloadAll()
  }

  preload(name: SfxName, path: string) {
    try {
      const sound = new Audio(path)
      sound.preload = 'auto'
      sound.addEventListener('error', () => {
        console.warn(`sfx missing: ${path}`)
      })
      sound.load()
      this.sounds.set(name, sound)
    } catch (error) {
      console.warn('sfx preload failed', name, error)
    }
  }

  preloadAll() {
    for (const [name, path] of Object.entries(audioFiles) as [SfxName, string][]) {
      this.preload(name, path)
    }
  }

  play(name: SfxName, volume = 1) {
    if (!audioUnlocked) return
    const effective = Math.max(0, Math.min(1, volume * globalSfxVolume))
    const source = this.sounds.get(name)
    const sound = source?.cloneNode(true) as HTMLAudioElement | undefined
    if (!sound) {
      playFallbackTone(name, effective)
      return
    }
    try {
      sound.volume = effective
      sound.play().catch(() => playFallbackTone(name, effective))
    } catch {
      playFallbackTone(name, effective)
    }
  }
}

export const sfx = new SfxPlayer()

let soundtrackAudio: HTMLAudioElement | null = null
let bgmVolume = 0.21

function startSoundtrack() {
  if (soundtrackAudio) return
  try {
    soundtrackAudio = new Audio(`${import.meta.env.BASE_URL}sfx/soundtrack.mp3`)
    soundtrackAudio.loop = true
    soundtrackAudio.volume = bgmVolume
    soundtrackAudio.play().catch(() => playFallbackTone('round_bell', 0.3))
  } catch (error) {
    console.warn('soundtrack failed to start', error)
  }
}

export function setSfxVolume(v: number) {
  globalSfxVolume = Math.max(0, Math.min(1, v))
}

export function setBgmVolume(v: number) {
  bgmVolume = Math.max(0, Math.min(1, v))
  if (soundtrackAudio) soundtrackAudio.volume = bgmVolume
}

export function getSfxVolume() { return globalSfxVolume }
export function getBgmVolume() { return bgmVolume }

export function unlockSfx() {
  audioUnlocked = true
  // Preload now — this is the user-gesture entry point, so Audio elements
  // created here are NOT autoplay-blocked. Cloned nodes inherit that
  // (good) state, so hit_light / hit_heavy will actually play.
  sfx.ensurePreloaded()
  try {
    const context = getAudioContext()
    void context.resume()
  } catch (error) {
    console.warn('audio unlock failed', error)
  }
  startSoundtrack()
  document.body.classList.add('audio-ready')
}
