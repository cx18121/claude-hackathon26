import { useEffect, useRef, useState } from 'react'

/**
 * Subscribes to commentary_* messages on the spectator WebSocket and
 * exposes:
 *  - text: the live, accumulated subtitle string (resets on each new call)
 *  - id: the current call id (for keying CSS animations)
 *
 * Audio playback is handled internally: each commentary_audio message
 * carries one base64 mp3 sentence. We decode to a Blob, queue it, and
 * play sentences in order so they sound like one continuous take.
 *
 * The hook attaches as a passive `message` listener — it doesn't own the
 * socket. Pass in the same WebSocket the spectator hook is using.
 */

interface CommentaryStartMsg {
  type: 'commentary_start'
  id: number
}

interface CommentaryTextMsg {
  type: 'commentary_text'
  id: number
  delta: string
}

interface CommentaryAudioMsg {
  type: 'commentary_audio'
  id: number
  idx: number
  mime: string
  audio_b64: string
}

interface CommentaryEndMsg {
  type: 'commentary_end'
  id: number
}

type CommentaryMsg =
  | CommentaryStartMsg
  | CommentaryTextMsg
  | CommentaryAudioMsg
  | CommentaryEndMsg

interface QueuedClip {
  callId: number
  idx: number
  url: string
}

function base64ToBlobUrl(b64: string, mime: string): string {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: mime }))
}

function isCommentaryMsg(value: unknown): value is CommentaryMsg {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  const t = (value as { type: unknown }).type
  return (
    t === 'commentary_start' ||
    t === 'commentary_text' ||
    t === 'commentary_audio' ||
    t === 'commentary_end'
  )
}

export interface CommentaryState {
  text: string
  id: number
  active: boolean
}

export function useCommentary(socket: WebSocket | null, audioEnabled: boolean): CommentaryState {
  const [state, setState] = useState<CommentaryState>({ text: '', id: 0, active: false })

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const queueRef = useRef<QueuedClip[]>([])
  const playingRef = useRef(false)
  const currentCallRef = useRef<number>(-1)
  const audioEnabledRef = useRef(audioEnabled)
  audioEnabledRef.current = audioEnabled

  // Boost factor applied to commentary playback. >1.0 amplifies above the
  // raw mp3 level — ElevenLabs output sits well below 0 dBFS, so a 2.5×
  // gain (~+8 dB) lifts it above the SFX layer without clipping.
  const COMMENTARY_GAIN = 2.5

  // Lazily create the singleton <audio> element wired through a Web Audio
  // graph: <audio> -> MediaElementSource -> GainNode -> destination.
  // GainNode lets us push gain past 1.0 (the max for HTMLAudioElement.volume).
  useEffect(() => {
    if (audioRef.current) return
    const el = new Audio()
    el.preload = 'auto'
    el.crossOrigin = 'anonymous'
    audioRef.current = el

    try {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctor()
      const source = ctx.createMediaElementSource(el)
      const gain = ctx.createGain()
      gain.gain.value = COMMENTARY_GAIN
      source.connect(gain).connect(ctx.destination)
      audioCtxRef.current = ctx
      gainRef.current = gain
    } catch {
      // No Web Audio? Fall back to plain element playback at native volume.
    }

    el.addEventListener('ended', () => {
      const finished = queueRef.current.shift()
      if (finished) URL.revokeObjectURL(finished.url)
      playingRef.current = false
      pump()
    })
    el.addEventListener('error', () => {
      const finished = queueRef.current.shift()
      if (finished) URL.revokeObjectURL(finished.url)
      playingRef.current = false
      pump()
    })
    return () => {
      el.pause()
      audioRef.current = null
      audioCtxRef.current?.close().catch(() => {})
      audioCtxRef.current = null
      gainRef.current = null
    }
  }, [])

  const pump = () => {
    if (playingRef.current) return
    if (!audioEnabledRef.current) return
    const next = queueRef.current[0]
    const audio = audioRef.current
    if (!next || !audio) return
    audio.src = next.url
    playingRef.current = true
    audio.play().catch(() => {
      // Browser blocked playback (no user gesture yet). Drop and move on
      // so the queue doesn't stall forever.
      const finished = queueRef.current.shift()
      if (finished) URL.revokeObjectURL(finished.url)
      playingRef.current = false
    })
  }

  // Re-pump when audio is unlocked. AudioContext starts suspended in most
  // browsers — we have to resume() inside a user gesture, which is exactly
  // what audioEnabled flips to true on.
  useEffect(() => {
    if (!audioEnabled) return
    const ctx = audioCtxRef.current
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {})
    }
    pump()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioEnabled])

  useEffect(() => {
    if (socket === null) return

    const handler = (event: MessageEvent) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (!isCommentaryMsg(parsed)) return

      switch (parsed.type) {
        case 'commentary_start': {
          // New call — wipe pending audio from prior calls.
          currentCallRef.current = parsed.id
          for (const q of queueRef.current) URL.revokeObjectURL(q.url)
          queueRef.current = []
          if (audioRef.current) {
            audioRef.current.pause()
            audioRef.current.currentTime = 0
          }
          playingRef.current = false
          setState({ text: '', id: parsed.id, active: true })
          return
        }
        case 'commentary_text': {
          if (parsed.id !== currentCallRef.current) return
          const delta = parsed.delta
          setState((prev) =>
            prev.id === parsed.id
              ? { ...prev, text: prev.text + delta }
              : { text: delta, id: parsed.id, active: true },
          )
          return
        }
        case 'commentary_audio': {
          if (parsed.id !== currentCallRef.current) return
          const url = base64ToBlobUrl(parsed.audio_b64, parsed.mime)
          // Insert in order — server sends idx monotonically, but be safe.
          const clip: QueuedClip = { callId: parsed.id, idx: parsed.idx, url }
          const q = queueRef.current
          let i = q.length
          while (i > 0 && q[i - 1].idx > clip.idx) i--
          q.splice(i, 0, clip)
          pump()
          return
        }
        case 'commentary_end': {
          if (parsed.id !== currentCallRef.current) return
          setState((prev) => (prev.id === parsed.id ? { ...prev, active: false } : prev))
          return
        }
      }
    }

    socket.addEventListener('message', handler)
    return () => {
      socket.removeEventListener('message', handler)
    }
  }, [socket])

  return state
}
