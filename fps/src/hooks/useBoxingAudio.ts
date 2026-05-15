import { useRef } from 'react';

// AudioContext persists for component lifetime. Safari requires user gesture on first play call —
// satisfied by getCtx() lazy creation.

/**
 * useBoxingAudio — synthesized Web Audio sounds for the FPS boxing game.
 *
 * AudioContext is created lazily on the first play call (never at startup — browser autoplay policy).
 * Each play function is fire-and-forget: creates nodes, connects, starts, stops, then GC collects.
 *
 * D-09: All sounds synthesized via Web Audio API — no audio asset files.
 */
export function useBoxingAudio(): {
  playThrow: () => void;
  playImpact: (damage: number) => void;
  playBlocked: () => void;
} {
  const ctxRef = useRef<AudioContext | null>(null);

  function getCtx(): AudioContext {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
    }
    return ctxRef.current;
  }

  /**
   * playThrow — triggered by wrist velocity threshold (not in this plan).
   * 150ms bandpass-filtered noise burst (woosh).
   */
  function playThrow(): void {
    const ctx = getCtx();
    const now = ctx.currentTime;

    const bufferSize = ctx.sampleRate * 0.15; // 150ms
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 800;
    filter.Q.value = 0.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(now);
    source.stop(now + 0.15);
  }

  /**
   * playImpact — triggered on MsgFpsHit received (non-blocked hits).
   * Damage-scaled: low thud + noise crack. Heavier hits produce louder, higher-pitched impact.
   */
  function playImpact(damage: number): void {
    const ctx = getCtx();
    const now = ctx.currentTime;
    const intensity = Math.min(1.0, damage / 25); // normalize to [0,1]

    // Low-end thud: sine oscillator with pitch decay
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(120 + intensity * 80, now);
    osc1.frequency.exponentialRampToValueAtTime(40, now + 0.1);

    // Noise crack: short highpass-filtered noise burst
    const crackBuf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
    const crackData = crackBuf.getChannelData(0);
    for (let i = 0; i < crackData.length; i++) crackData[i] = Math.random() * 2 - 1;
    const crack = ctx.createBufferSource();
    crack.buffer = crackBuf;

    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = 'highpass';
    crackFilter.frequency.value = 2000;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.6 + intensity * 0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc1.connect(gain);
    crack.connect(crackFilter);
    crackFilter.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.15);
    crack.start(now);
    crack.stop(now + 0.05);
  }

  /**
   * playBlocked — triggered when punch_type === "blocked".
   * Dull triangle wave thud — distinct from the sharp impact sound.
   */
  function playBlocked(): void {
    const ctx = getCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.08);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  return { playThrow, playImpact, playBlocked };
}
