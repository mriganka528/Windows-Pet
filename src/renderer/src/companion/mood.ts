// ---------------------------------------------------------------------------
// Companion mood / expression model (pure).
// ---------------------------------------------------------------------------
// Mood is the companion's *emotional* layer. It is deliberately kept SEPARATE
// from the locomotion state machine (machine.ts: idle/wander/dragging/landing)
// because the two are orthogonal — the pup can be "happy while wandering" or
// "surprised while being dragged". Coupling them would mean a combinatorial
// mess of parallel states and would disturb the already-tested locomotion FSM.
//
// Instead this is a tiny pure reducer with a clear priority model, driven from
// the React layer (App.tsx) via events, and decayed over time by TICK. Being
// pure (no DOM / no React / no XState) means it can be unit-tested in isolation
// — the sandbox can run this logic directly, unlike anything that imports
// xstate or touches a canvas.
//
// Priority when resolving what the face should show:
//   dragging (surprised)  >  transient (angry / love / happy)  >  base (sleepy / neutral)

/** Every distinct face the sprite can draw.
 *  neutral/happy/love/angry/surprised/sleepy are the originals; excited/curious/
 *  grumpy/alert/chill were added so each selectable mood preset (see
 *  shared/settings.MoodDefault) has its own resting face rather than sharing the
 *  plain `neutral` look. */
export type Mood =
  | 'neutral'
  | 'happy'
  | 'love'
  | 'angry'
  | 'surprised'
  | 'sleepy'
  | 'excited'
  | 'curious'
  | 'grumpy'
  | 'alert'
  | 'chill'

/** A short-lived reaction that overrides the base mood until it decays.
 *  'happy' is the one-shot startup greeting (see the WELCOME event); love/angry
 *  are the pet/notification reactions. */
export type TransientMood = 'love' | 'angry' | 'happy'

/** The base/resting mood the companion falls back to when nothing else applies.
 *  One of these per selectable preset (appearance.baseMoodFor maps them). Every
 *  BaseMood is also a drawable Mood, since expressionOf can return it directly. */
export type BaseMood =
  | 'neutral'
  | 'sleepy'
  | 'happy'
  | 'alert'
  | 'excited'
  | 'curious'
  | 'grumpy'
  | 'chill'

export interface MoodState {
  /** Resting mood (what it returns to). */
  base: BaseMood
  /** Active reaction + seconds left before it decays back to `base`. */
  transient: { mood: TransientMood; remaining: number } | null
  /** True while the user is holding the sprite (drives the "surprised" face). */
  dragging: boolean
}

export type MoodEvent =
  | { type: 'PET' } // user clicked / petted     -> love
  | { type: 'ALERT' } // a notification arrived    -> angry
  | { type: 'WELCOME' } // app just launched         -> a cute happy greeting
  | { type: 'CALM' } // clear any active reaction  -> base
  | { type: 'DRAG_START' } // picked up             -> surprised
  | { type: 'DRAG_END' } // dropped                 -> reveal underlying mood
  | { type: 'SLEEP' } // long idle                  -> base becomes sleepy
  | { type: 'WAKE' } // activity resumed            -> base becomes neutral
  | { type: 'SET_BASE'; base: BaseMood } // pick the resting face directly
  | { type: 'TICK'; dt: number } // decay timers

// Reaction durations (seconds). Angry lingers a little longer than love so a
// notification "sticks" long enough to read as annoyed, while a pet is a quick
// affectionate blip.
export const LOVE_DURATION = 1.8
export const ANGRY_DURATION = 2.6
// The launch greeting lingers a touch longer than a pet so the cute "hello!" is
// clearly seen before it decays back to the resting face and the pup wanders off.
export const WELCOME_DURATION = 2.2

export function initialMood(): MoodState {
  return { base: 'neutral', transient: null, dragging: false }
}

/**
 * Pure reducer. Latest discrete reaction wins (a pet can calm an angry pup and
 * vice-versa) which keeps the model predictable; TICK counts the active
 * reaction down and clears it when it elapses.
 */
export function reduceMood(state: MoodState, event: MoodEvent): MoodState {
  switch (event.type) {
    case 'PET':
      return { ...state, transient: { mood: 'love', remaining: LOVE_DURATION } }
    case 'ALERT':
      return { ...state, transient: { mood: 'angry', remaining: ANGRY_DURATION } }
    case 'WELCOME':
      // A cute welcoming beam fired once on launch. It's a transient (like PET/
      // ALERT) so it shows over whatever resting face the user picked, then
      // decays back to it — leaving the pup to start its normal walk.
      return { ...state, transient: { mood: 'happy', remaining: WELCOME_DURATION } }
    case 'CALM':
      return { ...state, transient: null }
    case 'DRAG_START':
      return { ...state, dragging: true }
    case 'DRAG_END':
      return { ...state, dragging: false }
    case 'SLEEP':
      return { ...state, base: 'sleepy' }
    case 'WAKE':
      return { ...state, base: 'neutral' }
    case 'SET_BASE':
      return { ...state, base: event.base }
    case 'TICK': {
      if (!state.transient) return state
      const remaining = state.transient.remaining - event.dt
      if (remaining <= 0) return { ...state, transient: null }
      return { ...state, transient: { ...state.transient, remaining } }
    }
    default:
      return state
  }
}

/** Resolve the face to draw from the current mood state, honoring priority. */
export function expressionOf(state: MoodState): Mood {
  if (state.dragging) return 'surprised'
  if (state.transient) return state.transient.mood
  return state.base
}
