import { describe, it, expect } from 'vitest'
import {
  DEFAULT_BEAT_CONFIG,
  DEFAULT_TEMPO_CONFIG,
  energyFromFrequencies,
  initBeatState,
  stepBeat,
  tempoScaleFromBeats,
  type BeatConfig,
  type BeatState
} from './audioBeat'

/** Reduce a list of frames through stepBeat, collecting beats + on/off edges. */
function run(
  frames: { energy: number; dt: number }[],
  cfg: BeatConfig = DEFAULT_BEAT_CONFIG,
  start: BeatState = initBeatState()
): { state: BeatState; beats: number; changes: number } {
  let state = start
  let beats = 0
  let changes = 0
  for (const f of frames) {
    const r = stepBeat(state, f, cfg)
    state = r.state
    if (r.beat) beats++
    if (r.musicChanged) changes++
  }
  return { state, beats, changes }
}

/** N frames of constant energy at a fixed dt. */
function steady(energy: number, count: number, dt = 0.1): { energy: number; dt: number }[] {
  return Array.from({ length: count }, () => ({ energy, dt }))
}

describe('energyFromFrequencies', () => {
  it('averages the low band and normalizes to 0..1', () => {
    // bandFraction 0.5 of a length-4 buffer -> first 2 bins.
    expect(energyFromFrequencies([255, 255, 0, 0], 0.5)).toBeCloseTo(1)
    expect(energyFromFrequencies([128, 128, 255, 255], 0.5)).toBeCloseTo(128 / 255)
  })
  it('returns 0 for an empty buffer', () => {
    expect(energyFromFrequencies([])).toBe(0)
  })
  it('uses at least one bin even for a tiny buffer', () => {
    // floor(3 * 0.15) = 0 -> clamped to 1 bin (the first).
    expect(energyFromFrequencies([255, 0, 0], 0.15)).toBeCloseTo(1)
  })
})

describe('stepBeat — beat detection', () => {
  it('fires on a transient above the rolling average, then respects the refractory window', () => {
    // Warm the baseline to ~0.1 so a later 0.5 clearly spikes above it.
    let { state } = run(steady(0.1, 40))

    const spike = stepBeat(state, { energy: 0.5, dt: 0.1 }, DEFAULT_BEAT_CONFIG)
    expect(spike.beat).toBe(true)
    state = spike.state

    // Immediately loud again, but < minBeatIntervalSec later -> no second beat.
    const tooSoon = stepBeat(state, { energy: 0.5, dt: 0.1 }, DEFAULT_BEAT_CONFIG)
    expect(tooSoon.beat).toBe(false)
  })

  it('does not beat on a steady tone once the average has caught up', () => {
    // After a long steady stretch the EMA ≈ the input, so nothing spikes above
    // sensitivity*avg anymore.
    const warmed = run(steady(0.2, 60)).state
    const next = stepBeat(warmed, { energy: 0.2, dt: 0.1 }, DEFAULT_BEAT_CONFIG)
    expect(next.beat).toBe(false)
  })

  it('treats sub-floor energy as silence (never a beat)', () => {
    const r = run(steady(0.01, 20))
    expect(r.beats).toBe(0)
    expect(r.state.musicActive).toBe(false)
  })
})

describe('stepBeat — music on/off hysteresis', () => {
  it('turns music ON after enough rhythmic beats, emitting a single change edge', () => {
    // A ~3.3 Hz pulse: a loud frame every 3rd frame (0.3s apart) over ~2s.
    const frames: { energy: number; dt: number }[] = []
    for (let i = 0; i < 24; i++) frames.push({ energy: i % 3 === 0 ? 0.6 : 0.08, dt: 0.1 })
    const r = run(frames)
    expect(r.state.musicActive).toBe(true)
    expect(r.beats).toBeGreaterThanOrEqual(DEFAULT_BEAT_CONFIG.beatsToStart)
    expect(r.changes).toBe(1) // only the OFF->ON edge, not every frame
  })

  it('turns music OFF after a sustained silent stretch', () => {
    // Get into music first...
    const pulse: { energy: number; dt: number }[] = []
    for (let i = 0; i < 24; i++) pulse.push({ energy: i % 3 === 0 ? 0.6 : 0.08, dt: 0.1 })
    const on = run(pulse)
    expect(on.state.musicActive).toBe(true)

    // ...then feed > silenceHoldSec (1.2s) of true silence.
    const off = run(steady(0, 16), DEFAULT_BEAT_CONFIG, on.state) // 1.6s
    expect(off.state.musicActive).toBe(false)
    expect(off.changes).toBe(1) // one ON->OFF edge
  })

  it('a single isolated ding never starts a dance', () => {
    const r = run([{ energy: 0.6, dt: 0.1 }, ...steady(0, 30)])
    expect(r.state.musicActive).toBe(false)
  })
})

describe('stepBeat — purity', () => {
  it('does not mutate the input state', () => {
    const s = initBeatState()
    const beatsRef = s.recentBeats
    stepBeat(s, { energy: 0.6, dt: 0.1 }, DEFAULT_BEAT_CONFIG)
    expect(s.recentBeats).toBe(beatsRef)
    expect(s.recentBeats.length).toBe(0)
    expect(s.clockSec).toBe(0)
    expect(s.musicActive).toBe(false)
  })
})

describe('tempoScaleFromBeats', () => {
  it('returns the neutral 1.0 until there are enough beats to judge', () => {
    expect(tempoScaleFromBeats([])).toBe(1)
    expect(tempoScaleFromBeats([1])).toBe(1)
    expect(tempoScaleFromBeats([1, 1.5])).toBe(1) // 2 beats < minBeats(3)
  })

  it('maps the reference interval (~120 BPM) to ~1.0', () => {
    // 0.5s gaps === referenceIntervalSec.
    expect(tempoScaleFromBeats([0, 0.5, 1.0, 1.5])).toBeCloseTo(1, 5)
  })

  it('a faster pulse dances faster (scale > 1, capped at maxScale)', () => {
    // 0.25s gaps -> 0.5/0.25 = 2 -> clamped to maxScale.
    expect(tempoScaleFromBeats([0, 0.25, 0.5, 0.75])).toBe(DEFAULT_TEMPO_CONFIG.maxScale)
  })

  it('a slower pulse dances slower (scale < 1, floored at minScale)', () => {
    // 1.0s gaps -> 0.5/1.0 = 0.5 -> clamped up to minScale.
    expect(tempoScaleFromBeats([0, 1, 2, 3])).toBe(DEFAULT_TEMPO_CONFIG.minScale)
  })

  it('uses the MEDIAN gap, so one outlier interval barely moves it', () => {
    // Three tight 0.3s gaps + one huge 4.4s gap. The median gap is 0.3 (fast);
    // the mean gap (~1.3) would read far slower — proving we key off the median.
    expect(tempoScaleFromBeats([0, 0.3, 0.6, 0.9, 5.3])).toBeCloseTo(0.5 / 0.3, 4)
  })

  it('does not assume the timestamps are sorted', () => {
    expect(tempoScaleFromBeats([1.5, 0, 1.0, 0.5])).toBeCloseTo(1, 5)
  })

  it('is monotonic: a shorter median gap yields a larger scale', () => {
    const fast = tempoScaleFromBeats([0, 0.35, 0.7, 1.05])
    const slow = tempoScaleFromBeats([0, 0.7, 1.4, 2.1])
    expect(fast).toBeGreaterThan(slow)
  })
})

describe('stepBeat — tempoScale surfacing', () => {
  it('reports a neutral tempoScale before any rhythm is present', () => {
    const r = stepBeat(initBeatState(), { energy: 0.01, dt: 0.1 }, DEFAULT_BEAT_CONFIG)
    expect(r.tempoScale).toBe(1)
  })

  it('rises above 1 for a fast rhythmic pulse', () => {
    // A loud frame every 3rd frame at dt=0.1 -> ~0.3s beat gaps (above the 0.22s
    // refractory, faster than the 0.5s reference) -> tempoScale climbs past 1.
    let state = initBeatState()
    let last = 1
    for (let i = 0; i < 40; i++) {
      const r = stepBeat(state, { energy: i % 3 === 0 ? 0.6 : 0.08, dt: 0.1 }, DEFAULT_BEAT_CONFIG)
      state = r.state
      last = r.tempoScale
    }
    expect(last).toBeGreaterThan(1)
    expect(last).toBeLessThanOrEqual(DEFAULT_TEMPO_CONFIG.maxScale)
  })
})
