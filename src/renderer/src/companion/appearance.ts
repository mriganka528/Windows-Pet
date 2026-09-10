// ---------------------------------------------------------------------------
// Settings -> renderer-behavior mapping (pure).
// ---------------------------------------------------------------------------
// The shared settings module (src/shared/settings.ts) is intentionally free of
// renderer types. This module is where those user-facing choices become the
// concrete WanderConfig (motion.ts) and base Mood (mood.ts) the overlay uses.
// Pure functions -> unit-testable in the sandbox.

import type { NudgeSettings, MoodDefault, SpritePalette } from '../../../shared/settings'
import { SIZE_PX, WANDER_SPEED_MIN, WANDER_SPEED_MAX } from '../../../shared/settings'
import { coatPalette } from './coats'
import type { WanderConfig } from './motion'
import type { BaseMood } from './mood'
import type { SpeciesDef } from './species'

// Base walk speed (px/s) at the default "happy" energy; scaled per mood below.
const BASE_SPEED = 64

// Per-preset locomotion personality. Kept as full Record tables (not ternaries)
// so adding a MoodDefault forces an entry here — you can't ship a preset that
// silently falls back to "happy" numbers. Values are multipliers/biases tuned so
// the roster reads distinctly: excited zips and rarely rests; curious ranges
// wide; alert is quick and watchful; chill/sleepy are slow and homebound; grumpy
// stomps slowly and doesn't roam far.
//
// `speedMul` scales BASE_SPEED. `restBias` (0..1) is how much it prefers resting
// over moving. `roamChance` (0..1) is how often the next target is anywhere on
// screen vs. back on the ground line.
const SPEED_MUL: Record<MoodDefault, number> = {
  happy: 1,
  excited: 1.5,
  curious: 1.1,
  alert: 1.35,
  chill: 0.7,
  sleepy: 0.5,
  grumpy: 0.8
}
const REST_BIAS: Record<MoodDefault, number> = {
  happy: 0.35,
  excited: 0.15,
  curious: 0.3,
  alert: 0.22,
  chill: 0.55,
  sleepy: 0.7,
  grumpy: 0.5
}
const ROAM_CHANCE: Record<MoodDefault, number> = {
  happy: 0.75,
  excited: 0.9,
  curious: 0.85,
  alert: 0.85,
  chill: 0.6,
  sleepy: 0.45,
  grumpy: 0.5
}

// Animation "liveliness" per preset — how much it breathes/bobs/fidgets in place
// (separate from walk SPEED above; see energyFor).
const ENERGY: Record<MoodDefault, number> = {
  happy: 1,
  excited: 1.4,
  curious: 1.1,
  alert: 1.3,
  chill: 0.72,
  sleepy: 0.55,
  grumpy: 0.85
}

/**
 * Translate appearance + comfort settings into how the companion roams.
 * - Size sets the sprite footprint (keeps the whole body on-screen).
 * - Mood sets "energy": each preset has its own speed/rest/roam profile (see the
 *   tables above) — e.g. Excited darts and roams everywhere, Sleepy barely moves.
 * - Reduced motion (UI/UX 4) halves speed, keeps it closer to the ground, and
 *   lengthens rests — for users who want the presence without the darting-about.
 */
export function wanderConfigFor(s: NudgeSettings): WanderConfig {
  const spriteSize = SIZE_PX[s.appearance.size]
  const mood = s.appearance.moodDefault

  // Small animals take shorter steps; large ones cover more ground per stride.
  const speciesSpeed =
    s.appearance.character === 'penguin' ||
    s.appearance.character === 'koala' ||
    s.appearance.character === 'bear' ||
    s.appearance.character === 'panda'
      ? 0.75
      : 1
  let speed = Math.round(BASE_SPEED * SPEED_MUL[mood] * Math.sqrt(spriteSize / 80) * speciesSpeed)
  let restBias = REST_BIAS[mood]
  // How often the next target roams the WHOLE screen vs. settling on the ground
  // line. Lively moods range widest; calm/prickly ones keep lower and closer.
  let roamChance = ROAM_CHANCE[mood]

  if (s.general.reducedMotion) {
    speed = Math.round(speed * 0.5)
    restBias = Math.min(0.8, restBias + 0.25)
    roamChance = 0.3
  }

  const percent = Number.isFinite(s.behavior.wanderSpeed) ? s.behavior.wanderSpeed : 100
  return {
    spriteSize,
    speed,
    restBias,
    roamChance,
    wanderSpeedMultiplier: Math.max(WANDER_SPEED_MIN, Math.min(WANDER_SPEED_MAX, percent)) / 100,
    sleepPosition: s.behavior.sleepPosition ?? 'top-left'
  }
}

/**
 * The resting "base" expression implied by the default mood. Transient reactions
 * (love/angry) still override this while active; this is just what the face
 * settles back to. Every preset now has its OWN resting face (a 1:1 mapping), so
 * this is a straight pass-through — Happy is a warm smile, Alert is wide watchful
 * eyes, Chill is relaxed, Sleepy is droopy, etc. Kept as a named function (rather
 * than inlining `s.appearance.moodDefault`) so callers don't depend on the
 * MoodDefault⊂BaseMood coincidence and we can remap a preset onto a shared face
 * later without touching them. TypeScript enforces MoodDefault ⊆ BaseMood here.
 */
export function baseMoodFor(mood: MoodDefault): BaseMood {
  return mood
}

/**
 * Animation "liveliness" multiplier, kept separate from `wanderConfigFor`'s walk
 * SPEED because it drives on-the-spot animation instead: breathing/bob/tail
 * amplitude and how OFTEN idle fidgets fire (see companion/activity.ts). This is
 * where "mood-driven animation speed" (Phase 3 exit criterion) comes from.
 *
 * Reduced motion (UI/UX 4) clamps energy low so the pet is calm and, combined
 * with the scheduler suppressing ambient actions, barely fidgets.
 */
export function energyFor(mood: MoodDefault, reducedMotion: boolean): number {
  const base = ENERGY[mood]
  return reducedMotion ? Math.min(base, 0.5) : base
}

/**
 * Resolve the fur/skin palette the sprite paints with. The 'natural' coat means
 * "use this animal's own colors" (SpeciesDef.palette); every other coat recolors
 * the whole body via COLOR_THEMES while the species' morphology and accents
 * (ears/tail/markings/nose) stay put. Kept here on the renderer side so the
 * shared settings module needn't import the species data. The `isNaturalCoat`
 * type guard narrows the coat id so `COLOR_THEMES[coat]` is provably safe (the
 * 'natural' key is intentionally absent from COLOR_THEMES).
 */
export function paletteFor(s: NudgeSettings, species: SpeciesDef): SpritePalette {
  return coatPalette(species, s.appearance.colorTheme)
}
