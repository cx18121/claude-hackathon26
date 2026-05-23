import { BlurFilter, Container, Graphics } from 'pixi.js'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  decay: number
  radius: number
  color: number
}

interface Shockwave {
  x: number
  y: number
  radius: number
  maxRadius: number
  growth: number
  alpha: number
  width: number
  color: number
}

interface Flash {
  x: number
  y: number
  radius: number
  alpha: number
  decay: number
  color: number
}

// Damage range from server/damage.py is roughly 2..25. We compress that
// into a [0..1] intensity used to interpolate every visual knob, so an 8-dmg
// jab and a 22-dmg head shot scale continuously instead of falling on
// either side of a hard threshold.
const MAX_DAMAGE = 25

function intensityFor(damage: number): number {
  return Math.max(0.15, Math.min(1, damage / MAX_DAMAGE))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export class SparkEmitter {
  private readonly halo = new Graphics()
  private readonly graphics = new Graphics()
  private particles: Particle[] = []
  private shockwaves: Shockwave[] = []
  private flashes: Flash[] = []

  constructor(container: Container) {
    this.halo.filters = [new BlurFilter({ strength: 18, quality: 4 })]
    this.halo.alpha = 0.95
    container.addChild(this.halo)
    container.addChild(this.graphics)
  }

  emit(x: number, y: number, damage: number) {
    const t = intensityFor(damage)
    // Smaller across the board than the previous binary heavy/light pair —
    // the old "heavy" peaks (count 33, flash 90, shockwave 280) felt like
    // the screen was exploding on every clean hit.
    const count = Math.round(lerp(5, 16, t))
    const baseSpeed = lerp(1.8, 4.2, t)
    const speedSpread = lerp(2.5, 6, t)
    const liftBias = lerp(0.4, 1.4, t)
    const decay = lerp(0.032, 0.02, t)
    const radiusFloor = lerp(1.4, 3.5, t)
    const radiusSpread = lerp(1.6, 4, t)

    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2
      const speed = baseSpeed + Math.random() * speedSpread
      const colorRoll = Math.random()
      const color =
        colorRoll > 0.7 ? 0xfff4c2 : colorRoll > 0.35 ? 0xffc24a : 0xff5a1f

      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - liftBias,
        life: 1,
        decay,
        radius: radiusFloor + Math.random() * radiusSpread,
        color,
      })
    }

    this.shockwaves.push({
      x,
      y,
      radius: lerp(8, 18, t),
      maxRadius: lerp(55, 175, t),
      growth: lerp(0.16, 0.22, t),
      alpha: 1,
      width: lerp(2.5, 5.5, t),
      color: t > 0.55 ? 0xff7a2a : 0xffd84d,
    })

    this.flashes.push({
      x,
      y,
      radius: lerp(18, 60, t),
      alpha: lerp(0.45, 0.78, t),
      decay: lerp(0.11, 0.07, t),
      color: t > 0.55 ? 0xff8a3a : 0xffe07a,
    })
  }

  update(frameScale: number) {
    this.graphics.clear()
    this.halo.clear()

    const nextParticles: Particle[] = []
    for (const particle of this.particles) {
      particle.x += particle.vx * frameScale
      particle.y += particle.vy * frameScale
      particle.vy += 0.18 * frameScale
      particle.vx *= Math.pow(0.985, frameScale)
      particle.life -= particle.decay * frameScale
      if (particle.life <= 0) {
        continue
      }
      nextParticles.push(particle)
      const a = Math.max(0, Math.min(1, particle.life))
      const coreR = particle.radius * (0.55 + 0.45 * a)
      this.graphics
        .circle(particle.x, particle.y, coreR)
        .fill({ color: particle.color, alpha: a })
      this.halo
        .circle(particle.x, particle.y, particle.radius * (1.6 + 0.7 * a))
        .fill({ color: particle.color, alpha: a * 0.55 })
    }
    this.particles = nextParticles

    const nextShockwaves: Shockwave[] = []
    for (const wave of this.shockwaves) {
      wave.radius += (wave.maxRadius - wave.radius) * wave.growth * frameScale
      wave.alpha -= 0.045 * frameScale
      if (wave.alpha <= 0) {
        continue
      }
      nextShockwaves.push(wave)
      this.graphics
        .circle(wave.x, wave.y, wave.radius)
        .stroke({ color: wave.color, alpha: wave.alpha * 0.9, width: wave.width })
      this.halo
        .circle(wave.x, wave.y, wave.radius)
        .stroke({ color: wave.color, alpha: wave.alpha * 0.55, width: wave.width * 1.6 })
    }
    this.shockwaves = nextShockwaves

    const nextFlashes: Flash[] = []
    for (const flash of this.flashes) {
      flash.radius += flash.radius * 0.08 * frameScale
      flash.alpha -= flash.decay * frameScale
      if (flash.alpha <= 0) {
        continue
      }
      nextFlashes.push(flash)
      this.halo
        .circle(flash.x, flash.y, flash.radius)
        .fill({ color: flash.color, alpha: flash.alpha })
    }
    this.flashes = nextFlashes
  }

  destroy() {
    this.graphics.destroy()
    this.halo.destroy()
    this.particles = []
    this.shockwaves = []
    this.flashes = []
  }
}
