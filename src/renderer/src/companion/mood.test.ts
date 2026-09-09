import { describe, it, expect } from 'vitest'
import {
  initialMood,
  reduceMood,
  expressionOf,
  LOVE_DURATION,
  ANGRY_DURATION,
  WELCOME_DURATION,
  type MoodState
} from './mood'

/** Apply a list of events in sequence. */
function run(events: Parameters<typeof reduceMood>[1][], start: MoodState = initialMood()): MoodState {
  return events.reduce(reduceMood, start)
}

describe('mood reducer', () => {
  it('starts neutral, not dragging, no reaction', () => {
    const s = initialMood()
    expect(s.base).toBe('neutral')
    expect(s.transient).toBeNull()
    expect(s.dragging).toBe(false)
    expect(expressionOf(s)).toBe('neutral')
  })

  it('PET shows love, and love decays back to base after its duration', () => {
    let s = reduceMood(initialMood(), { type: 'PET' })
    expect(expressionOf(s)).toBe('love')
    // Not yet elapsed.
    s = reduceMood(s, { type: 'TICK', dt: LOVE_DURATION - 0.1 })
    expect(expressionOf(s)).toBe('love')
    // Past the duration -> cleared.
    s = reduceMood(s, { type: 'TICK', dt: 0.2 })
    expect(expressionOf(s)).toBe('neutral')
  })

  it('ALERT shows angry for longer than love', () => {
    expect(ANGRY_DURATION).toBeGreaterThan(LOVE_DURATION)
    let s = reduceMood(initialMood(), { type: 'ALERT' })
    expect(expressionOf(s)).toBe('angry')
    s = reduceMood(s, { type: 'TICK', dt: LOVE_DURATION + 0.1 })
    // Still angry because angry lasts longer than a pet would.
    expect(expressionOf(s)).toBe('angry')
  })

  it('latest reaction wins: petting an angry pup calms it to love', () => {
    const s = run([{ type: 'ALERT' }, { type: 'PET' }])
    expect(expressionOf(s)).toBe('love')
  })

  it('dragging overrides any reaction (surprised), and drop reveals it again', () => {
    let s = run([{ type: 'ALERT' }, { type: 'DRAG_START' }])
    expect(expressionOf(s)).toBe('surprised')
    // Drop while the angry reaction is still counting down -> angry returns.
    s = reduceMood(s, { type: 'DRAG_END' })
    expect(expressionOf(s)).toBe('angry')
  })

  it('CALM clears an active reaction immediately', () => {
    const s = run([{ type: 'PET' }, { type: 'CALM' }])
    expect(s.transient).toBeNull()
    expect(expressionOf(s)).toBe('neutral')
  })

  it('SLEEP/WAKE switch the base mood, but only when nothing else applies', () => {
    let s = reduceMood(initialMood(), { type: 'SLEEP' })
    expect(expressionOf(s)).toBe('sleepy')
    // A reaction still takes priority over a sleepy base.
    s = reduceMood(s, { type: 'PET' })
    expect(expressionOf(s)).toBe('love')
    // After it decays, we fall back to the sleepy base (not neutral).
    s = reduceMood(s, { type: 'TICK', dt: LOVE_DURATION + 0.1 })
    expect(expressionOf(s)).toBe('sleepy')
    s = reduceMood(s, { type: 'WAKE' })
    expect(expressionOf(s)).toBe('neutral')
  })

  it('SET_BASE picks an arbitrary resting face (one per selectable preset)', () => {
    // The App sends SET_BASE(baseMoodFor(moodDefault)) so each preset shows its
    // own face at rest. Verify a couple of the new ones resolve directly.
    let s = reduceMood(initialMood(), { type: 'SET_BASE', base: 'alert' })
    expect(expressionOf(s)).toBe('alert')
    s = reduceMood(s, { type: 'SET_BASE', base: 'grumpy' })
    expect(expressionOf(s)).toBe('grumpy')
    // A transient reaction still overrides the chosen base while it lasts…
    s = reduceMood(s, { type: 'PET' })
    expect(expressionOf(s)).toBe('love')
    // …then falls back to the base we set (not neutral).
    s = reduceMood(s, { type: 'TICK', dt: LOVE_DURATION + 0.1 })
    expect(expressionOf(s)).toBe('grumpy')
  })

  it('WELCOME greets with happy, then decays back to the resting face', () => {
    // The startup greeting is a transient laid over whatever base the preset set,
    // so it shows a happy face briefly and then reveals the resting mood — exactly
    // the "cute welcome, then normal walk" behavior we want on launch. It also
    // lasts a touch longer than a pet's love so the greeting is clearly seen.
    expect(WELCOME_DURATION).toBeGreaterThan(LOVE_DURATION)
    let s = reduceMood(initialMood(), { type: 'SET_BASE', base: 'alert' })
    s = reduceMood(s, { type: 'WELCOME' })
    expect(expressionOf(s)).toBe('happy')
    // Not yet elapsed -> still greeting.
    s = reduceMood(s, { type: 'TICK', dt: WELCOME_DURATION - 0.1 })
    expect(expressionOf(s)).toBe('happy')
    // Past the duration -> back to the resting face (alert), not neutral.
    s = reduceMood(s, { type: 'TICK', dt: 0.2 })
    expect(expressionOf(s)).toBe('alert')
  })

  it('a real notification still interrupts the welcome (latest reaction wins)', () => {
    // If a genuine toast arrives mid-greeting the pup should react to it, not keep
    // smiling — the startup seeding stops PRE-EXISTING toasts from firing, but a
    // brand-new one during the ~2s welcome must still nudge.
    const s = run([{ type: 'WELCOME' }, { type: 'ALERT' }])
    expect(expressionOf(s)).toBe('angry')
  })
})
