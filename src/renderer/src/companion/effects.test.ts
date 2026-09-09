import { describe, it, expect } from 'vitest'
import {
  spawnHearts,
  spawnAnger,
  spawnSleep,
  spawnNotes,
  spawnSparkles,
  stepParticles,
  particleAlpha,
  particleScale,
  type Particle
} from './effects'

/** Deterministic rng + id source for stable assertions. */
function fixtures() {
  let seed = 0.5
  const rng = (): number => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
  let id = 1
  const nextId = (): number => id++
  return { rng, nextId }
}

describe('effects', () => {
  it('spawnHearts creates N hearts with unique ids that float up', () => {
    const { rng, nextId } = fixtures()
    const hearts = spawnHearts(100, 200, 5, { rng, nextId })
    expect(hearts).toHaveLength(5)
    expect(new Set(hearts.map((h) => h.id)).size).toBe(5)
    expect(hearts.every((h) => h.kind === 'heart')).toBe(true)
    // Rising = negative vertical velocity.
    expect(hearts.every((h) => h.vy < 0)).toBe(true)
  })

  it('spawnAnger and spawnSleep produce their own kinds', () => {
    const { rng, nextId } = fixtures()
    expect(spawnAnger(0, 0, 3, { rng, nextId }).every((p) => p.kind === 'anger')).toBe(true)
    const z = spawnSleep(0, 0, { rng, nextId })
    expect(z).toHaveLength(1)
    expect(z[0].kind).toBe('sleep')
  })

  it('spawnNotes creates N rising notes with unique ids (the dance doodles)', () => {
    const { rng, nextId } = fixtures()
    const notes = spawnNotes(100, 200, 4, { rng, nextId })
    expect(notes).toHaveLength(4)
    expect(new Set(notes.map((n) => n.id)).size).toBe(4)
    expect(notes.every((n) => n.kind === 'note')).toBe(true)
    expect(notes.every((n) => n.vy < 0)).toBe(true) // float up
  })

  it('spawnSparkles scatters N twinkling sparkles in a halo around the point', () => {
    const { rng, nextId } = fixtures()
    const sparkles = spawnSparkles(100, 200, 4, { rng, nextId })
    expect(sparkles).toHaveLength(4)
    expect(new Set(sparkles.map((s) => s.id)).size).toBe(4)
    expect(sparkles.every((s) => s.kind === 'sparkle')).toBe(true)
    // A gentle upward drift (like hearts/notes), never downward.
    expect(sparkles.every((s) => s.vy < 0)).toBe(true)
    // Scattered close around the spawn point (radius <= ~38, y-halo flattened),
    // not streaming off elsewhere — so they read as a glint around the head.
    expect(sparkles.every((s) => Math.abs(s.x - 100) <= 40 && Math.abs(s.y - 200) <= 40)).toBe(true)
  })

  it('notes rise and sway wider than hearts do (a livelier bob)', () => {
    // Same start, same phase, one step: compare horizontal travel. Sway is
    // sin((age+phase)*3)*amp; note amp (9) > heart amp (6), so |dx| is larger.
    const base = { id: 1, x: 0, y: 0, vx: 0, vy: -30, age: 0, life: 2, size: 12, rot: 0, swayPhase: 0.4 }
    const heart: Particle = { ...base, kind: 'heart' }
    const note: Particle = { ...base, id: 2, kind: 'note' }
    const [h] = stepParticles([heart], 0.1)
    const [n] = stepParticles([note], 0.1)
    expect(Math.abs(n.x)).toBeGreaterThan(Math.abs(h.x))
    // Both eased their rise (upward drag applied): vy relaxes toward 0.
    expect(n.vy).toBeGreaterThan(note.vy)
    expect(h.vy).toBeGreaterThan(heart.vy)
  })

  it('stepParticles moves particles and does not mutate the input', () => {
    const { rng, nextId } = fixtures()
    const before = spawnHearts(100, 200, 3, { rng, nextId })
    const snapshotY = before.map((p) => p.y)
    const after = stepParticles(before, 0.1)
    // Original array untouched (pure).
    expect(before.map((p) => p.y)).toEqual(snapshotY)
    // Hearts rose (y decreased) after a step.
    expect(after.every((p, i) => p.y < snapshotY[i])).toBe(true)
    expect(after.every((p) => p.age > 0)).toBe(true)
  })

  it('stepParticles drops expired particles', () => {
    const p: Particle = {
      id: 1,
      kind: 'heart',
      x: 0,
      y: 0,
      vx: 0,
      vy: -10,
      age: 0,
      life: 0.1,
      size: 10,
      rot: 0,
      swayPhase: 0
    }
    // One big step beyond its life -> gone.
    expect(stepParticles([p], 0.2)).toHaveLength(0)
  })

  it('particleAlpha ramps in then out; scale pops then settles', () => {
    const mk = (age: number, life = 1): Particle => ({
      id: 1,
      kind: 'heart',
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      age,
      life,
      size: 10,
      rot: 0,
      swayPhase: 0
    })
    expect(particleAlpha(mk(0))).toBeCloseTo(0, 5) // just spawned -> invisible
    expect(particleAlpha(mk(0.5))).toBeCloseTo(1, 5) // mid-life -> fully visible
    expect(particleAlpha(mk(0.99))).toBeLessThan(0.1) // near end -> fading out
    expect(particleScale(mk(0))).toBeLessThan(1) // starts small
    expect(particleScale(mk(0.5))).toBe(1) // settles to 1
  })
})
