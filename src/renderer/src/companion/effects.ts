// ---------------------------------------------------------------------------
// Particle effects (pure math).
// ---------------------------------------------------------------------------
// Floating "emotes" that punctuate a reaction: hearts when petted, little anger
// puffs when a notification annoys the pup, sleepy "z"s when dozing. Kept pure
// (no canvas, no React) so the spawn/step/lifetime logic is unit-testable in the
// sandbox; the actual drawing lives in EffectsCanvas.tsx.
//
// Coordinate space: overlay-window CSS pixels (same as motion.ts / the machine),
// so a caller can spawn at the sprite's on-screen position directly.

export type ParticleKind = 'heart' | 'anger' | 'sleep' | 'note' | 'sparkle'

export interface Particle {
  id: number
  kind: ParticleKind
  x: number
  y: number
  /** Velocity in px/second. */
  vx: number
  vy: number
  /** Seconds since spawn. */
  age: number
  /** Total lifetime in seconds; the particle is dropped once age >= life. */
  life: number
  /** Base draw size in px. */
  size: number
  /** Rotation in radians (hearts wobble; anger marks tilt). */
  rot: number
  /** Horizontal sway frequency/phase for a gentle floaty drift. */
  swayPhase: number
}

export interface SpawnOptions {
  rng?: () => number
  /** Monotonic id source so React can use stable keys / dedupe. */
  nextId?: () => number
}

let _autoId = 1
const defaultNextId = (): number => _autoId++

function opts(o?: SpawnOptions): Required<SpawnOptions> {
  return { rng: o?.rng ?? Math.random, nextId: o?.nextId ?? defaultNextId }
}

/**
 * Spawn `count` hearts that rise from (x, y) with a gentle spread. Hearts drift
 * upward (negative vy) and sway sideways as they fade.
 */
export function spawnHearts(x: number, y: number, count: number, o?: SpawnOptions): Particle[] {
  const { rng, nextId } = opts(o)
  const out: Particle[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      id: nextId(),
      kind: 'heart',
      x: x + (rng() - 0.5) * 18,
      y: y + (rng() - 0.5) * 8,
      vx: (rng() - 0.5) * 16,
      vy: -(34 + rng() * 26), // float up
      age: 0,
      life: 1.1 + rng() * 0.7,
      size: 11 + rng() * 9,
      rot: (rng() - 0.5) * 0.5,
      swayPhase: rng() * Math.PI * 2
    })
  }
  return out
}

/** Spawn a couple of quick anger puffs near the head — short-lived, poppy. */
export function spawnAnger(x: number, y: number, count: number, o?: SpawnOptions): Particle[] {
  const { rng, nextId } = opts(o)
  const out: Particle[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      id: nextId(),
      kind: 'anger',
      x: x + (rng() - 0.5) * 26,
      y: y - rng() * 10,
      vx: (rng() - 0.5) * 10,
      vy: -(6 + rng() * 10),
      age: 0,
      life: 0.55 + rng() * 0.35,
      size: 12 + rng() * 6,
      rot: (rng() - 0.5) * 0.6,
      swayPhase: rng() * Math.PI * 2
    })
  }
  return out
}

/** Spawn a single drifting sleepy "z". */
export function spawnSleep(x: number, y: number, o?: SpawnOptions): Particle[] {
  const { rng, nextId } = opts(o)
  return [
    {
      id: nextId(),
      kind: 'sleep',
      x,
      y,
      vx: 8 + rng() * 6,
      vy: -(14 + rng() * 8),
      age: 0,
      life: 1.6 + rng() * 0.6,
      size: 12 + rng() * 6,
      rot: 0,
      swayPhase: rng() * Math.PI * 2
    }
  ]
}

/**
 * Spawn `count` musical notes that rise from (x, y) — the "doodles" that puff
 * out of the pup while it dances. Like hearts they float up (negative vy) and
 * ease off, but they sway wider (see stepParticles) and tilt more for a jaunty,
 * bouncing-to-the-beat feel. EffectsCanvas picks the glyph (♪ / ♫ / ♬) from the
 * particle id so a burst shows a mix rather than all the same note.
 */
export function spawnNotes(x: number, y: number, count: number, o?: SpawnOptions): Particle[] {
  const { rng, nextId } = opts(o)
  const out: Particle[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      id: nextId(),
      kind: 'note',
      x: x + (rng() - 0.5) * 30,
      y: y + (rng() - 0.5) * 10,
      vx: (rng() - 0.5) * 22,
      vy: -(40 + rng() * 28), // float up, a touch faster than hearts
      age: 0,
      life: 1.0 + rng() * 0.7,
      size: 14 + rng() * 8,
      rot: (rng() - 0.5) * 0.7, // jauntier tilt than hearts
      swayPhase: rng() * Math.PI * 2
    })
  }
  return out
}

/**
 * Spawn `count` twinkling sparkles scattered around (x, y) — the little "✨"
 * stars that pop while the pup strikes its photogenic webcam pose. Unlike hearts
 * or notes these don't stream upward in a column; they scatter in a flattened
 * halo around the point and mostly twinkle in place (small velocities, a gentle
 * upward drift), reading as a camera-flash glint. EffectsCanvas draws them as
 * four-point stars whose brightness twinkles over their short life.
 */
export function spawnSparkles(x: number, y: number, count: number, o?: SpawnOptions): Particle[] {
  const { rng, nextId } = opts(o)
  const out: Particle[] = []
  for (let i = 0; i < count; i++) {
    const ang = rng() * Math.PI * 2
    const rad = 10 + rng() * 28
    out.push({
      id: nextId(),
      kind: 'sparkle',
      x: x + Math.cos(ang) * rad,
      y: y + Math.sin(ang) * rad * 0.65, // slightly flattened halo around the head
      vx: (rng() - 0.5) * 10,
      vy: -(4 + rng() * 10), // a gentle upward drift
      age: 0,
      life: 0.6 + rng() * 0.5,
      size: 8 + rng() * 8,
      rot: rng() * Math.PI, // random star orientation
      swayPhase: rng() * Math.PI * 2
    })
  }
  return out
}

/**
 * Advance every particle by `dt` seconds and drop any that have expired.
 * Returns a NEW array (does not mutate the input) so it's React-state friendly.
 * Hearts gently decelerate their rise (a touch of drag) for a floaty feel.
 */
export function stepParticles(particles: Particle[], dt: number): Particle[] {
  const out: Particle[] = []
  for (const p of particles) {
    const age = p.age + dt
    if (age >= p.life) continue // expired
    // A little upward drag so the rise eases off rather than shooting away
    // (hearts and notes both float; anger/sleep keep their velocity).
    const rises = p.kind === 'heart' || p.kind === 'note'
    const vy = p.vy + (rises ? 10 * dt : 0)
    // Sideways sway layered on top of base vx; notes swing wider so they read as
    // bobbing to the music.
    const swayAmp = p.kind === 'note' ? 9 : 6
    const sway = Math.sin((age + p.swayPhase) * 3) * swayAmp
    out.push({
      ...p,
      age,
      vy,
      x: p.x + (p.vx + sway) * dt,
      y: p.y + vy * dt
    })
  }
  return out
}

/**
 * 0..1 opacity over the particle's life: a quick fade-in, a long hold, then a
 * fade-out at the end so nothing pops out abruptly.
 */
export function particleAlpha(p: Particle): number {
  const t = p.life <= 0 ? 1 : p.age / p.life
  const fadeIn = Math.min(1, t / 0.15) // ramp up over first 15%
  const fadeOut = Math.min(1, (1 - t) / 0.35) // ramp down over last 35%
  return Math.max(0, Math.min(fadeIn, fadeOut))
}

/**
 * Draw scale multiplier: a little "pop" as it appears (overshoot to ~1.15 then
 * settle to 1). Purely cosmetic, but it's what makes emotes feel bouncy.
 */
export function particleScale(p: Particle): number {
  const t = p.life <= 0 ? 1 : p.age / p.life
  if (t >= 0.2) return 1
  // ease-out overshoot across the first 20% of life
  const k = t / 0.2
  return 0.4 + 0.75 * k * (2 - k) // 0.4 -> ~1.15
}
