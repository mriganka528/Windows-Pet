// ---------------------------------------------------------------------------
// Pure beat / "is music playing" detection for the sound-sensitive dance.
// ---------------------------------------------------------------------------
// No Web Audio, no DOM, no timers, no randomness — just numbers in, a new state
// + flags out. The renderer's useSystemAudio hook receives Windows playback
// meter levels, converts them to perceptual energy, and feeds them here with
// the elapsed time. Keeping the logic pure means we can
// unit-test the tricky parts (beat threshold, refractory window, music on/off
// hysteresis) without an audio device — the sandbox has none, and neither does
// CI.
//
// The two questions this answers:
//   • beat        — did a percussive transient just hit this frame? (drives the
//                   sprite's beat "pop" + a musical-note puff)
//   • musicActive — is a song actually playing right now? (drives entering /
//                   leaving the dance state). Hysteretic on purpose: it takes a
//                   few beats to switch ON and a sustained quiet stretch to
//                   switch OFF, so a lone system "ding" never starts a dance and
//                   a quiet passage mid-song never stops one.

/** Tunables for beat detection + the music on/off gate. Times are in seconds so
 *  the math is frame-rate independent (everything scales by the frame's dt). */
export interface BeatConfig {
  /** A beat needs instantaneous energy to exceed the rolling average times this.
   *  >1; higher = only stronger transients count (fewer false beats). */
  sensitivity: number
  /** Refractory period: minimum seconds between two accepted beats. Caps the
   *  effective tempo (e.g. 0.22s ≈ 270 BPM) and stops one loud hit from
   *  registering as a burst of beats across consecutive frames. */
  minBeatIntervalSec: number
  /** Time-constant (seconds) of the rolling energy average (an EMA). Larger =
   *  the baseline reacts more slowly, so sustained loud music still yields beats
   *  on its transients instead of the average swallowing them. */
  energyTau: number
  /** Energy at/below this is treated as effectively silent (no music here). In
   *  the same normalized 0..1 units as the `energy` input. */
  silenceFloor: number
  /** Continuous seconds at/below silenceFloor before music is declared OFF. */
  silenceHoldSec: number
  /** Number of beats within recentWindowSec required to declare music ON. This
   *  is what makes a single notification chime fail to start a dance. */
  beatsToStart: number
  /** Sliding window (seconds) over which beatsToStart is counted. */
  recentWindowSec: number
}

// Tuned against `energy` = mean of the low-frequency (bass) band of
// getByteFrequencyData, normalized to 0..1 (see energyFromFrequencies). These
// are deliberately forgiving: the user's ask is "play any song and it dances",
// so we favor reliably catching real music over rejecting borderline audio.
export const DEFAULT_BEAT_CONFIG: BeatConfig = {
  sensitivity: 1.35,
  minBeatIntervalSec: 0.22,
  energyTau: 0.35,
  silenceFloor: 0.04,
  silenceHoldSec: 1.2,
  beatsToStart: 3,
  recentWindowSec: 2.5
}

/** Rolling detector state. Treat as opaque + immutable: stepBeat returns a fresh
 *  one each frame (never mutates the input). */
export interface BeatState {
  /** EMA of recent energy — the adaptive baseline a beat must jump above. */
  avgEnergy: number
  /** Seconds since the last accepted beat (for the refractory check). */
  sinceBeatSec: number
  /** Continuous seconds spent at/below the silence floor. */
  silenceSec: number
  /** Monotonic clock (seconds) accumulated from dt; used to age recent beats. */
  clockSec: number
  /** Clock timestamps of beats still inside recentWindowSec. */
  recentBeats: number[]
  /** Whether a song is currently considered to be playing (hysteretic). */
  musicActive: boolean
}

export function initBeatState(): BeatState {
  return {
    avgEnergy: 0,
    sinceBeatSec: Infinity, // so the very first qualifying frame can beat
    silenceSec: 0,
    clockSec: 0,
    recentBeats: [],
    musicActive: false
  }
}

export interface BeatInput {
  /** Instantaneous audio energy this frame, normalized to roughly 0..1. */
  energy: number
  /** Seconds elapsed since the previous frame. */
  dt: number
}

export interface BeatStep {
  /** The next state — feed this back on the following frame. */
  state: BeatState
  /** A percussive transient was accepted this frame. */
  beat: boolean
  /** musicActive flipped this frame (ON or OFF) — the caller sends MUSIC_START /
   *  MUSIC_STOP only on these edges, not every frame. */
  musicChanged: boolean
  /** Dance-speed multiplier for the current tempo (1 = the reference ~120 BPM
   *  feel). Faster songs push it up, slower songs down; see tempoScaleFromBeats.
   *  Recomputed every frame from the live recent-beats window so the dance can
   *  follow a song that speeds up or slows down. */
  tempoScale: number
}

/**
 * Advance the detector by one frame. Pure: does not mutate `state`.
 *
 * Beat rule: energy is above the silence floor AND exceeds the *previous*
 * rolling average by the sensitivity factor AND the refractory period has
 * elapsed. Comparing against the pre-update average (not the one that includes
 * this frame) is what lets a sharp transient stand out from its own backdrop.
 *
 * Music gate: turns ON once `beatsToStart` beats land within `recentWindowSec`
 * (rhythm present), turns OFF after `silenceHoldSec` of continuous quiet. The
 * two thresholds don't overlap, giving clean hysteresis with no chatter.
 */
export function stepBeat(
  state: BeatState,
  input: BeatInput,
  cfg: BeatConfig = DEFAULT_BEAT_CONFIG
): BeatStep {
  const dt = input.dt > 0 ? input.dt : 0
  const energy = input.energy >= 0 ? input.energy : 0
  const clockSec = state.clockSec + dt

  // Adaptive baseline (EMA). alpha derived from dt + tau so smoothing is
  // frame-rate independent; guard tau <= 0 by snapping straight to `energy`.
  const alpha = cfg.energyTau > 0 ? 1 - Math.exp(-dt / cfg.energyTau) : 1
  const prevAvg = state.avgEnergy
  const avgEnergy = prevAvg + alpha * (energy - prevAvg)

  // Beat detection against the PRE-update average.
  const sinceBeatSec = state.sinceBeatSec + dt
  const loudEnough = energy > cfg.silenceFloor
  const spikes = energy > prevAvg * cfg.sensitivity
  const rested = sinceBeatSec >= cfg.minBeatIntervalSec
  const beat = loudEnough && spikes && rested

  // Age out old beats, then record this one if it fired.
  const recentBeats = state.recentBeats.filter((t) => clockSec - t <= cfg.recentWindowSec)
  if (beat) recentBeats.push(clockSec)

  // Silence accounting for the OFF edge.
  const silenceSec = energy <= cfg.silenceFloor ? state.silenceSec + dt : 0

  // Hysteretic music gate.
  //   ON  — enough beats in the window AND we're not currently in silence. The
  //         loudEnough guard matters: without it, an OFF triggered by silence
  //         could instantly flip back ON from beats that are quiet-but-still
  //         inside recentWindowSec, oscillating the state every frame.
  //   OFF — a sustained silent stretch. On this edge we also drop the recorded
  //         beats so a fresh song must re-earn the rhythm rather than resuming
  //         from stale evidence.
  let musicActive = state.musicActive
  let nextRecent = recentBeats
  if (!musicActive) {
    if (loudEnough && recentBeats.length >= cfg.beatsToStart) musicActive = true
  } else if (silenceSec >= cfg.silenceHoldSec) {
    musicActive = false
    nextRecent = []
  }

  return {
    state: {
      avgEnergy,
      sinceBeatSec: beat ? 0 : sinceBeatSec,
      silenceSec,
      clockSec,
      recentBeats: nextRecent,
      musicActive
    },
    beat,
    musicChanged: musicActive !== state.musicActive,
    tempoScale: tempoScaleFromBeats(nextRecent)
  }
}

/**
 * Reduce a getByteFrequencyData() buffer (each entry 0..255) to a single
 * normalized bass-band energy in 0..1. Beats/kick drums live in the low end, so
 * we average only the lowest `bandFraction` of the spectrum — that tracks the
 * rhythmic pulse far better than full-spectrum loudness (which hiss, speech, and
 * UI blips also raise). Pure so the hook's energy extraction is unit-tested too.
 */
export function energyFromFrequencies(freq: ArrayLike<number>, bandFraction = 0.15): number {
  const n = freq.length
  if (n === 0) return 0
  const frac = bandFraction > 0 && bandFraction <= 1 ? bandFraction : 0.15
  const bins = Math.max(1, Math.floor(n * frac))
  let sum = 0
  for (let i = 0; i < bins; i++) sum += freq[i]
  return sum / bins / 255
}

// ---------------------------------------------------------------------------
// Tempo → dance-speed. "Fast song, fast dance; slow song, slow dance."
// ---------------------------------------------------------------------------
// The sprite's bop runs at a fixed base rate; this multiplier stretches or
// compresses that rate to match the music. We estimate tempo the cheap, robust
// way: the MEDIAN gap between recent beats. Median (not mean) shrugs off the odd
// missed or doubled kick, and it needs no BPM tracking or autocorrelation — just
// the beat timestamps stepBeat already keeps in `recentBeats`.

/** Tunables mapping an inter-beat interval to a dance-speed multiplier. */
export interface TempoConfig {
  /** Inter-beat interval (seconds) that maps to scale 1.0 — the natural bop
   *  speed. 0.5s ≈ 120 BPM, a comfortable middle so most music lands near 1. */
  referenceIntervalSec: number
  /** Clamp floor: the slowest the dance may run (keeps a ballad from stalling). */
  minScale: number
  /** Clamp ceiling: the fastest the dance may run (keeps DnB from vibrating). */
  maxScale: number
  /** Need at least this many recent beats (→ ≥ minBeats-1 intervals) before we
   *  trust the estimate; below it there's no rhythm to read, so return 1.0. */
  minBeats: number
}

export const DEFAULT_TEMPO_CONFIG: TempoConfig = {
  referenceIntervalSec: 0.5,
  minScale: 0.6,
  maxScale: 1.9,
  minBeats: 3
}

/**
 * Estimate a dance-speed multiplier from recent beat timestamps (seconds on the
 * detector's monotonic clock — i.e. BeatState.recentBeats). Pure; no state.
 *
 * scale = referenceInterval / medianInterval, clamped to [minScale, maxScale]:
 * a shorter median gap (faster music) → scale > 1, a longer gap → scale < 1.
 * Returns the neutral 1.0 when there aren't enough beats to judge, so the dance
 * starts at its natural speed and only diverges once a tempo is clearly present.
 */
export function tempoScaleFromBeats(
  recentBeats: readonly number[],
  cfg: TempoConfig = DEFAULT_TEMPO_CONFIG
): number {
  if (recentBeats.length < cfg.minBeats) return 1
  // Sort defensively — callers push in clock order, but median must not assume it.
  const sorted = [...recentBeats].sort((a, b) => a - b)
  const intervals: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i] - sorted[i - 1]
    if (d > 0) intervals.push(d)
  }
  if (intervals.length === 0) return 1
  intervals.sort((a, b) => a - b)
  const mid = intervals.length >> 1
  const median =
    intervals.length % 2 === 1 ? intervals[mid] : (intervals[mid - 1] + intervals[mid]) / 2
  if (median <= 0) return 1
  const scale = cfg.referenceIntervalSec / median
  return Math.max(cfg.minScale, Math.min(cfg.maxScale, scale))
}
