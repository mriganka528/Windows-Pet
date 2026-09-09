// ---------------------------------------------------------------------------
// Shared settings contract (main <-> preload <-> both renderers).
// ---------------------------------------------------------------------------
// This module is deliberately DEPENDENCY-FREE and DOM/Node-free so it can be
// imported by every layer: the Electron main process (persists it via
// electron-store), the preload bridge (types only), the overlay renderer
// (applies it live), and the settings-window renderer (edits it). Keeping it
// pure also means it can be unit-tested in isolation.
//
// Anything that needs renderer-only types (WanderConfig, Mood) is mapped from
// these values on the renderer side (see companion/appearance.ts), so this file
// stays importable from the Node main bundle without pulling in DOM/React.

export type Size = 'small' | 'medium' | 'large'
/** 'natural' = each animal's own colors (the default). The rest recolor the coat. */
export type ColorThemeId = 'natural' | 'classic' | 'ash' | 'mint' | 'lavender' | 'gold'
// The selectable resting personalities. happy/chill/alert are the originals;
// excited/curious/grumpy/sleepy were added so each preset has a visibly distinct
// resting face (see companion/appearance.baseMoodFor) — not just a different
// energy level. Happy and Alert in particular now read differently at a glance
// (warm smile vs. wide watchful eyes).
export type MoodDefault =
  | 'happy'
  | 'chill'
  | 'alert'
  | 'excited'
  | 'curious'
  | 'grumpy'
  | 'sleepy'
/** Nudge = point it out only (safe default). autoClose = tap the X (Phase 6). */
export type BehaviorMode = 'nudge' | 'autoClose'
/**
 * The animal roster. Each id maps to a SpeciesDef (colors + morphology) in
 * companion/species.ts, which the procedural sprite renders. Kept here — rather
 * than renderer-side — because main persists the chosen id and both the overlay
 * and the settings window need the shared union + labels to stay in lockstep.
 */
export type CharacterId =
  | 'cat'
  | 'dog'
  | 'fox'
  | 'bunny'
  | 'panda'
  | 'bear'
  | 'penguin'
  | 'redpanda'
  | 'hamster'
  | 'frog'
  | 'tiger'
  | 'koala'
  | 'pig'
  | 'mouse'
  | 'chick'

export interface AppearanceSettings {
  character: CharacterId
  size: Size
  colorTheme: ColorThemeId
  moodDefault: MoodDefault
}

export interface BehaviorSettings {
  mode: BehaviorMode
}

export interface GeneralSettings {
  startWithWindows: boolean
  soundEnabled: boolean
  reducedMotion: boolean
  /** Listen to system/app audio and auto-dance when music is detected. The pup
   *  captures only loopback audio for beat analysis (never the microphone). */
  reactToAudio: boolean
  /** When the webcam turns on, scurry under the camera, strike a photogenic pose
   *  for a few seconds, then resume roaming. Only an in-use boolean crosses the
   *  process boundary — never any camera frames or captured imagery. */
  reactToWebcam: boolean
}

/** Runtime toggles that we persist so relaunch restores the same state. */
export interface RuntimeSettings {
  paused: boolean
}

export interface NudgeSettings {
  appearance: AppearanceSettings
  behavior: BehaviorSettings
  general: GeneralSettings
  runtime: RuntimeSettings
}

/** A shallow-per-section partial — what the settings UI sends to `settings:set`. */
export interface SettingsPatch {
  appearance?: Partial<AppearanceSettings>
  behavior?: Partial<BehaviorSettings>
  general?: Partial<GeneralSettings>
  runtime?: Partial<RuntimeSettings>
}

export const DEFAULT_SETTINGS: NudgeSettings = {
  appearance: {
    character: 'cat',
    size: 'medium',
    colorTheme: 'natural',
    moodDefault: 'happy'
  },
  behavior: {
    // Nudge is the safe default (PRD 6.2): point notifications out, never close.
    mode: 'nudge'
  },
  general: {
    startWithWindows: false,
    // Silent by default with an easy toggle (PRD open question 9 -> quietest
    // default is least surprising for an always-on app).
    soundEnabled: false,
    reducedMotion: false,
    // OFF by default. Capturing loopback audio for the dance requires a screen-
    // capture session, and Windows treats any active screen capture as screen-
    // sharing — which auto-enables Do Not Disturb / Focus. Leaving this off means
    // launching Nudge never silences the user's notifications. It's a one-tap
    // opt-in from Settings > "Dance to music"; even then only loopback SYSTEM
    // audio is analyzed (never the microphone).
    reactToAudio: false,
    // Strike a pose when the webcam comes on, by default. Uses only an in-use
    // signal (no frames), and can be turned off here.
    reactToWebcam: true
  },
  runtime: {
    paused: false
  }
}

/** Sprite pixel size per Size option (UI/UX 2.1: ~48 / ~80 / ~128). */
export const SIZE_PX: Record<Size, number> = {
  small: 48,
  medium: 80,
  large: 128
}

/** Fur/skin colors for the procedural sprite. Facial features (eyes/nose/mouth)
 *  stay constant across themes so the "read at a glance" expression is stable
 *  (UI/UX 3). The renderer's SpriteCanvas consumes one of these. */
export interface SpritePalette {
  fur: string
  furLight: string
  furDark: string
  furDarkest: string
  cream: string
  creamDark: string
  earInner: string
  outline: string
}

// The recolor coats. 'natural' is intentionally NOT here: it means "use each
// animal's own colors" (SpeciesDef.palette), resolved by appearance.paletteFor.
export const COLOR_THEMES: Record<Exclude<ColorThemeId, 'natural'>, SpritePalette> = {
  classic: {
    fur: '#E9A45E',
    furLight: '#F8CE93',
    furDark: '#CB8035',
    furDarkest: '#B06E28',
    cream: '#FBECD4',
    creamDark: '#ECD4AF',
    earInner: '#EC968F',
    outline: 'rgba(120,74,20,0.28)'
  },
  ash: {
    fur: '#9AA4AE',
    furLight: '#CBD3DA',
    furDark: '#6E7A85',
    furDarkest: '#58636D',
    cream: '#EEF1F4',
    creamDark: '#D3D9DE',
    earInner: '#C9A9B0',
    outline: 'rgba(40,50,60,0.28)'
  },
  mint: {
    fur: '#7FC9A6',
    furLight: '#B6E6CE',
    furDark: '#4E9E7C',
    furDarkest: '#3B8065',
    cream: '#EFF8F1',
    creamDark: '#D0E8D8',
    earInner: '#EFA6A6',
    outline: 'rgba(20,70,55,0.28)'
  },
  lavender: {
    fur: '#B49BD8',
    furLight: '#DBCBF0',
    furDark: '#8E72BE',
    furDarkest: '#745AA0',
    cream: '#F2ECFA',
    creamDark: '#DACFEA',
    earInner: '#E9A6C8',
    outline: 'rgba(60,45,95,0.28)'
  },
  gold: {
    fur: '#E7B84E',
    furLight: '#F7DE97',
    furDark: '#C4922E',
    furDarkest: '#A67722',
    cream: '#FBF1D3',
    creamDark: '#ECDCAF',
    earInner: '#EAA07F',
    outline: 'rgba(110,80,15,0.30)'
  }
}

// Human-readable labels for the settings UI (kept here so labels and the option
// unions can't drift apart).
export const SIZE_LABELS: Record<Size, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large'
}
export const THEME_LABELS: Record<ColorThemeId, string> = {
  natural: 'Natural',
  classic: 'Classic',
  ash: 'Ash',
  mint: 'Mint',
  lavender: 'Lavender',
  gold: 'Gold'
}
export const MOOD_LABELS: Record<MoodDefault, string> = {
  happy: 'Happy',
  chill: 'Chill',
  alert: 'Alert',
  excited: 'Excited',
  curious: 'Curious',
  grumpy: 'Grumpy',
  sleepy: 'Sleepy'
}

/** Ordered lists for rendering pickers deterministically. */
export const SIZE_ORDER: Size[] = ['small', 'medium', 'large']
export const THEME_ORDER: ColorThemeId[] = ['natural', 'classic', 'ash', 'mint', 'lavender', 'gold']
// Ordered along a rough energy/temperament spectrum (bright & lively -> calm ->
// prickly) so the picker and the tray submenu read naturally top to bottom.
export const MOOD_ORDER: MoodDefault[] = [
  'happy',
  'excited',
  'curious',
  'alert',
  'chill',
  'sleepy',
  'grumpy'
]

/** True for the "use the animal's own colors" coat, which has no COLOR_THEMES
 *  entry (the renderer substitutes the SpeciesDef palette instead). Written as a
 *  type guard so `COLOR_THEMES[id]` narrows safely in the `else` branch. */
export function isNaturalCoat(id: ColorThemeId): id is 'natural' {
  return id === 'natural'
}

/** Display names for the animal roster (kept beside CharacterId so they can't
 *  drift). The rich per-animal data (colors, ears, tail, markings…) lives in
 *  companion/species.ts; this is just what the settings picker labels each with. */
export const CHARACTER_LABELS: Record<CharacterId, string> = {
  cat: 'Cat',
  dog: 'Dog',
  fox: 'Fox',
  bunny: 'Bunny',
  panda: 'Panda',
  bear: 'Bear',
  penguin: 'Penguin',
  redpanda: 'Red Panda',
  hamster: 'Hamster',
  frog: 'Frog',
  tiger: 'Tiger',
  koala: 'Koala',
  pig: 'Pig',
  mouse: 'Mouse',
  chick: 'Chick'
}

/** Picker order — cat first (the default + the design reference). */
export const CHARACTER_ORDER: CharacterId[] = [
  'cat',
  'dog',
  'fox',
  'bunny',
  'panda',
  'bear',
  'penguin',
  'redpanda',
  'hamster',
  'frog',
  'tiger',
  'koala',
  'pig',
  'mouse',
  'chick'
]

/**
 * Deep-merge a per-section patch onto a base settings object, returning a new
 * object. Only the four known sections are merged (leaves are primitives), which
 * keeps this type-safe and avoids a generic recursive merge. Used by main for
 * `settings:set`, and to hydrate a possibly-stale on-disk store onto the current
 * default shape (missing keys get filled in).
 */
export function mergeSettings(base: NudgeSettings, patch: SettingsPatch): NudgeSettings {
  return {
    appearance: { ...base.appearance, ...patch.appearance },
    behavior: { ...base.behavior, ...patch.behavior },
    general: { ...base.general, ...patch.general },
    runtime: { ...base.runtime, ...patch.runtime }
  }
}
