import { describe, it, expect } from 'vitest'
import {
  initialActivity,
  stepActivity,
  pickIdleAction,
  actionProgress,
  type ActivityContext,
  type ActivityState
} from './activity'

const RESTING: ActivityContext = { resting: true, energy: 1, reducedMotion: false }

/** A deterministic rng that walks through a fixed list, then repeats the last. */
function seq(values: number[]): () => number {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}

/** Drive the scheduler for `seconds` in fixed `dt` steps. */
function run(
  state: ActivityState,
  seconds: number,
  ctx: ActivityContext,
  rng: () => number,
  dt = 0.1
): ActivityState {
  let s = state
  const steps = Math.round(seconds / dt)
  for (let i = 0; i < steps; i++) s = stepActivity(s, dt, ctx, rng)
  return s
}

describe('initialActivity', () => {
  it('starts idle with a pending countdown', () => {
    const s = initialActivity()
    expect(s.action).toBe('idle')
    expect(s.untilNext).toBeGreaterThan(0)
    expect(actionProgress(s)).toBe(0)
  })
})

describe('pickIdleAction', () => {
  it('never returns the resting "idle" pose', () => {
    for (let r = 0; r < 1; r += 0.017) {
      expect(pickIdleAction(() => r)).not.toBe('idle')
    }
  })

  it('lowest roll picks the first weighted action deterministically', () => {
    expect(pickIdleAction(() => 0)).toBe('lookAround')
  })
})

describe('stepActivity', () => {
  it('fires an ambient action once the countdown elapses while resting', () => {
    // rng: first call = nextGap jitter (unused until an action ends), the pick
    // uses rng too. Start from a tiny countdown so it fires fast.
    const start: ActivityState = { action: 'idle', elapsed: 0, duration: 0, untilNext: 0.25 }
    const s = run(start, 1, RESTING, () => 0) // roll 0 -> lookAround
    expect(s.action).toBe('lookAround')
    expect(actionProgress(s)).toBeGreaterThan(0)
  })

  it('returns to idle after the action completes, then schedules the next gap', () => {
    const start: ActivityState = { action: 'idle', elapsed: 0, duration: 0, untilNext: 0.1 }
    // Run well past the longest action; rng=0 keeps picking lookAround (1.6s).
    const mid = run(start, 1, RESTING, () => 0)
    expect(mid.action).toBe('lookAround')
    const after = run(mid, 2, RESTING, () => 0)
    expect(after.action).toBe('idle')
    expect(after.untilNext).toBeGreaterThan(0)
  })

  it('suppresses ambient actions entirely under reduced motion', () => {
    const start: ActivityState = { action: 'idle', elapsed: 0, duration: 0, untilNext: 0.1 }
    const s = run(start, 30, { resting: true, energy: 1.3, reducedMotion: true }, () => 0.99)
    expect(s.action).toBe('idle')
  })

  it('does not fidget while walking / not resting', () => {
    const start: ActivityState = { action: 'idle', elapsed: 0, duration: 0, untilNext: 0.1 }
    const s = run(start, 30, { resting: false, energy: 1, reducedMotion: false }, () => 0.5)
    expect(s.action).toBe('idle')
  })

  it('cancels an in-progress action the moment it stops resting', () => {
    const start: ActivityState = { action: 'idle', elapsed: 0, duration: 0, untilNext: 0.1 }
    const acting = run(start, 0.5, RESTING, () => 0)
    expect(acting.action).toBe('lookAround')
    const walked = stepActivity(acting, 0.1, { resting: false, energy: 1, reducedMotion: false }, () => 0)
    expect(walked.action).toBe('idle')
  })

  it('higher energy shortens the gap between actions', () => {
    // Compare the untilNext scheduled after an action ends, holding rng fixed.
    const rngLow = seq([0.5]) // constant jitter
    const rngHigh = seq([0.5])
    const ended: ActivityState = { action: 'earTwitch', elapsed: 0.5, duration: 0.5, untilNext: 0 }
    const low = stepActivity(ended, 0.1, { resting: true, energy: 0.7, reducedMotion: false }, rngLow)
    const high = stepActivity(ended, 0.1, { resting: true, energy: 1.3, reducedMotion: false }, rngHigh)
    expect(high.untilNext).toBeLessThan(low.untilNext)
  })

  it('actionProgress runs monotonically from ~0 to 1 across an action', () => {
    const start: ActivityState = { action: 'idle', elapsed: 0, duration: 0, untilNext: 0 }
    let s = stepActivity(start, 0.01, RESTING, () => 0) // begin lookAround
    expect(s.action).toBe('lookAround')
    let last = actionProgress(s)
    for (let i = 0; i < 20; i++) {
      s = stepActivity(s, 0.08, RESTING, () => 0)
      if (s.action === 'idle') break
      const p = actionProgress(s)
      expect(p).toBeGreaterThanOrEqual(last - 1e-9)
      last = p
    }
    expect(last).toBeGreaterThan(0.5)
  })
})
