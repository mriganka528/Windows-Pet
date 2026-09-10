// ---------------------------------------------------------------------------
// Idle "life" scheduler (pure).
// ---------------------------------------------------------------------------
// Phase 3 is about making the companion feel *alive*, not placeholder-y. A pet
// that only ever bobs in place reads as a screensaver; a pet that occasionally
// glances around, flicks an ear, swishes its tail, shakes itself off, stretches,
// or yawns reads as a little creature. This module is the "brain" that decides
// WHEN those ambient idle actions happen; the renderer (SpriteCanvas) reads the
// current action + its progress and draws the matching pose.
//
// It is deliberately kept PURE (no DOM / no React / no canvas / no time source of
// its own) — you drive it with `dt` and a context, and inject `rng` for the
// random picks. That means it's unit-testable in the sandbox, exactly like
// motion.ts / mood.ts / effects.ts.
//
// Design rules:
//   • Ambient actions ONLY fire while the companion is *resting* (idle
//     locomotion — not walking, not being dragged). Walking already has its own
//     life (gait, tail); layering idle fidgets on top would look chaotic.
//   • `reducedMotion` (accessibility, UI/UX 4) suppresses ambient actions
//     entirely — the presence without the fidgeting.
//   • `energy` (from the mood setting; see appearance.ts `energyFor`) scales how
//     OFTEN actions fire: an "alert" pet fidgets more; a "chill" pet rarely.
//
// EXTENSION POINT (future phases, kept in mind per the plan): event-driven
// actions like `dance` (when music/audio is detected) or a webcam "peek" are NOT
// scheduled here — those are pushed in by the app from a system event and simply
// add another `IdleAction` member + a pose branch in the renderer. This scheduler
// only owns the *ambient, self-initiated* fidgets.

/** Every idle pose the sprite can strike. `idle` is the neutral resting pose. */
export type IdleAction =
  'idle' | 'lookAround' | 'earTwitch' | 'tailFlick' | 'shake' | 'stretch' | 'yawn'

/** An action that is actually schedulable (everything except the resting pose). */
export type ActiveIdleAction = Exclude<IdleAction, 'idle'>

export interface ActivityState {
  action: IdleAction
  /** Seconds elapsed into the current action. */
  elapsed: number
  /** Seconds the current action lasts (0 while `idle`). */
  duration: number
  /** Seconds remaining until the next ambient action begins (counts down while idle). */
  untilNext: number
}

export interface ActivityContext {
  /** True only while resting (idle locomotion — not walking / not dragging). */
  resting: boolean
  /** Liveliness multiplier from the mood setting (~0.7 chill … ~1.3 alert). */
  energy: number
  /** When true, ambient idle actions are suppressed entirely (accessibility). */
  reducedMotion: boolean
}

/** How long each action holds, in seconds. Tuned so subtle ones are quick and
 *  the "big" ones (stretch/yawn) linger long enough to read. */
const DURATIONS: Record<ActiveIdleAction, number> = {
  lookAround: 1.6,
  earTwitch: 0.5,
  tailFlick: 0.7,
  shake: 0.6,
  stretch: 1.3,
  yawn: 1.4
}

/** Relative likelihood of each action when one fires. Subtle fidgets are common;
 *  the whole-body actions are rare treats. */
const WEIGHTS: Record<ActiveIdleAction, number> = {
  earTwitch: 26,
  tailFlick: 24,
  lookAround: 20,
  shake: 12,
  stretch: 10,
  yawn: 8
}

// Gap between ambient actions at energy = 1 (seconds). Scaled by 1/energy so a
// livelier mood fidgets more often. Clamped in `nextGap` so it can never spin.
const GAP_MIN = 4
const GAP_MAX = 9

const ORDER: ActiveIdleAction[] = [
  'lookAround',
  'earTwitch',
  'tailFlick',
  'shake',
  'stretch',
  'yawn'
]

export function initialActivity(): ActivityState {
  return { action: 'idle', elapsed: 0, duration: 0, untilNext: GAP_MIN }
}

/** Weighted-random pick of the next ambient action. `rng` injectable for tests. */
export function pickIdleAction(rng: () => number = Math.random): ActiveIdleAction {
  const total = ORDER.reduce((sum, a) => sum + WEIGHTS[a], 0)
  let r = rng() * total
  for (const a of ORDER) {
    r -= WEIGHTS[a]
    if (r <= 0) return a
  }
  return ORDER[0]
}

/** Seconds until the next ambient action, shortened by energy and jittered. */
function nextGap(energy: number, rng: () => number): number {
  const base = GAP_MIN + rng() * (GAP_MAX - GAP_MIN)
  return base / Math.max(0.4, energy)
}

/**
 * Advance the scheduler by `dt` seconds. Pure: returns a new state (or the same
 * reference when nothing changes). Drive this once per frame from the renderer.
 */
export function stepActivity(
  state: ActivityState,
  dt: number,
  ctx: ActivityContext,
  rng: () => number = Math.random
): ActivityState {
  const energy = ctx.energy > 0 ? ctx.energy : 1

  // Not resting, or reduced motion: cancel any action and stay quiet. Reset the
  // countdown once (so the moment it starts resting again it waits a fresh gap),
  // then leave the quiet idle state untouched to avoid churning new objects.
  if (!ctx.resting || ctx.reducedMotion) {
    if (state.action === 'idle' && state.duration === 0) return state
    return { action: 'idle', elapsed: 0, duration: 0, untilNext: nextGap(energy, rng) }
  }

  // An action is in progress: advance it; when done, return to idle + schedule next.
  if (state.action !== 'idle') {
    const elapsed = state.elapsed + dt
    if (elapsed >= state.duration) {
      return { action: 'idle', elapsed: 0, duration: 0, untilNext: nextGap(energy, rng) }
    }
    return { ...state, elapsed }
  }

  // Resting + idle: count down, then fire a new action.
  const untilNext = state.untilNext - dt
  if (untilNext > 0) return { ...state, untilNext }
  const action = pickIdleAction(rng)
  return { action, elapsed: 0, duration: DURATIONS[action], untilNext: 0 }
}

/** 0..1 progress through the current action (0 while idle). */
export function actionProgress(state: ActivityState): number {
  if (state.action === 'idle' || state.duration <= 0) return 0
  const t = state.elapsed / state.duration
  return t < 0 ? 0 : t > 1 ? 1 : t
}
