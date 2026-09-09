// ---------------------------------------------------------------------------
// Species data — the "what each animal is made of" registry (pure data).
// ---------------------------------------------------------------------------
// The procedural sprite (spriteModel.ts → SpriteCanvas.tsx) draws a single
// front-facing, symmetric kawaii body plan and specialises it PER ANIMAL using
// the morphology fields below (ear shape, tail, muzzle, markings, nose, …) plus
// a natural colour palette. Adding an animal = adding one entry here; no drawing
// code changes for the common mammals.
//
// Why data-driven: it keeps the roster huge without 15 bespoke sprites, it's
// pure (no DOM) so it renders identically in-app (Canvas2D) and in the offline
// SVG preview harness used to eyeball the art, and it means the settings picker
// and the overlay agree on exactly one source of truth.
//
// Colours reuse the shared SpritePalette shape so the recolour "coats" (Classic,
// Ash, …) can swap `palette` wholesale while everything else (ears/tail/markings)
// stays put. The default coat, "Natural", uses the palette defined right here.

import type { CharacterId, SpritePalette } from '../../../shared/settings'

// --- morphology vocabulary --------------------------------------------------

/** Ear silhouette. `none` = no ears at all (birds, frog). */
export type EarStyle = 'pointed' | 'round' | 'long' | 'floppy' | 'none'
/** Tail silhouette. `none` = tailless (birds, frog). */
export type TailStyle = 'curl' | 'bushy' | 'ring' | 'stub' | 'thin' | 'none'
/** Lower-face treatment. Drives nose/mouth placement + any muzzle patch. */
export type MuzzleStyle = 'cat' | 'dog' | 'round' | 'snout' | 'beak' | 'wide' | 'plain'
/** Extra colour markings layered onto the base body plan. */
export type MarkingStyle =
  | 'none'
  | 'panda'
  | 'tiger'
  | 'fox'
  | 'redpanda'
  | 'penguin'
  | 'bird'
/** Belly/chest patch shape. `bib` = teardrop chest, `round` = big tummy. */
export type BellyStyle = 'bib' | 'round' | 'none'

/**
 * Everything the renderer needs to draw one animal. Optional fields fall back to
 * sensible defaults in spriteModel.ts, so a minimal species only sets the few
 * fields that make it recognisable.
 */
export interface SpeciesDef {
  id: CharacterId
  label: string
  /** Fallback glyph (used only if a canvas can't render, e.g. tiny chrome). */
  emoji: string
  /** Natural colours (the default "Natural" coat). */
  palette: SpritePalette

  // Ears
  ears: EarStyle
  /** Multiplier on ear size (1 = default). */
  earScale?: number
  /** Override inner-ear colour (else palette.earInner). */
  earInner?: string
  /** Dark ear tip (fox); omitted = solid ear. */
  earTip?: string

  // Tail
  tail: TailStyle
  /** Tail tip / ring accent colour (fox white tip, red-panda rings). */
  tailAccent?: string

  // Face / muzzle
  muzzle: MuzzleStyle
  /** Nose colour (or beak base for `beak`/`snout`). */
  nose: string
  /** Nose size multiplier (koala's big nose ≈ 1.8). */
  noseScale?: number
  whiskers?: boolean
  /** Rosy full cheeks (hamster) or cheek dots. */
  cheeks?: boolean
  /** Bulging eyes sitting on top of the head (frog). */
  eyesOnTop?: boolean

  // Body
  belly: BellyStyle
  /** Override belly/chest colour (else palette.cream). */
  bellyColor?: string
  /** Paw / foot colour (else palette.cream for socks, or fur). */
  pawColor?: string

  // Markings / accents
  markings?: MarkingStyle
  /** Patch/stripe colour for markings (panda black, tiger stripes…). */
  markColor?: string
  /** Beak + feet colour for birds. */
  accent?: string
}

// --- shared little colour helpers (keeps entries terse + consistent) --------

const PINK = '#F4A9B8'
const DARK_NOSE = '#43312A'

// --- the roster -------------------------------------------------------------
// Palettes are hand-tuned to read as the animal at a glance while staying in the
// soft, high-key kawaii register of the reference art (flat fills, gentle
// outline). fur = main coat, cream = belly/muzzle, earInner = pink, outline =
// the thin unifying edge.

export const SPECIES: Record<CharacterId, SpeciesDef> = {
  cat: {
    id: 'cat',
    label: 'Cat',
    emoji: '🐱',
    palette: {
      fur: '#F7A83A',
      furLight: '#FFC46B',
      furDark: '#E08A1E',
      furDarkest: '#B96E12',
      cream: '#FFFFFF',
      creamDark: '#F0E7DA',
      earInner: PINK,
      outline: 'rgba(122,74,18,0.30)'
    },
    ears: 'pointed',
    tail: 'curl',
    muzzle: 'cat',
    nose: '#EC8CA0',
    whiskers: true,
    belly: 'bib',
    pawColor: '#FFFFFF'
  },

  dog: {
    id: 'dog',
    label: 'Dog',
    emoji: '🐶',
    palette: {
      fur: '#E8A85C',
      furLight: '#F8CE93',
      furDark: '#C6822F',
      furDarkest: '#A66A22',
      cream: '#FBF0DC',
      creamDark: '#ECD9BD',
      earInner: '#D69B84',
      outline: 'rgba(110,70,20,0.30)'
    },
    ears: 'floppy',
    tail: 'stub',
    muzzle: 'dog',
    nose: DARK_NOSE,
    belly: 'bib',
    pawColor: '#FBF0DC'
  },

  fox: {
    id: 'fox',
    label: 'Fox',
    emoji: '🦊',
    palette: {
      fur: '#F0813A',
      furLight: '#FF9E5C',
      furDark: '#D2661F',
      furDarkest: '#A94F16',
      cream: '#FBEEE0',
      creamDark: '#ECD9C4',
      earInner: '#F7C9A0',
      outline: 'rgba(120,60,20,0.30)'
    },
    ears: 'pointed',
    earTip: '#3A2A24',
    tail: 'bushy',
    tailAccent: '#FBEEE0',
    muzzle: 'cat',
    nose: DARK_NOSE,
    whiskers: true,
    belly: 'bib',
    markings: 'fox',
    markColor: '#3A2A24',
    pawColor: '#3A2A24'
  },

  bunny: {
    id: 'bunny',
    label: 'Bunny',
    emoji: '🐰',
    palette: {
      fur: '#EBEDF2',
      furLight: '#FFFFFF',
      furDark: '#D2D6DF',
      furDarkest: '#B4BAC7',
      cream: '#FFFFFF',
      creamDark: '#EEF0F4',
      earInner: PINK,
      outline: 'rgba(96,98,118,0.28)'
    },
    ears: 'long',
    tail: 'stub',
    tailAccent: '#FFFFFF',
    muzzle: 'cat',
    nose: '#EC8CA0',
    whiskers: true,
    belly: 'bib',
    pawColor: '#FFFFFF'
  },

  panda: {
    id: 'panda',
    label: 'Panda',
    emoji: '🐼',
    palette: {
      fur: '#FBFBFB',
      furLight: '#FFFFFF',
      furDark: '#E6E6E6',
      furDarkest: '#D2D2D2',
      cream: '#FFFFFF',
      creamDark: '#EDEDED',
      earInner: '#7A7A7A',
      outline: 'rgba(70,70,70,0.30)'
    },
    ears: 'round',
    tail: 'stub',
    muzzle: 'round',
    nose: '#2B2B2B',
    belly: 'bib',
    markings: 'panda',
    markColor: '#2B2B2B'
  },

  bear: {
    id: 'bear',
    label: 'Bear',
    emoji: '🐻',
    palette: {
      fur: '#B27B4E',
      furLight: '#C99A6E',
      furDark: '#8C5E36',
      furDarkest: '#6E4826',
      cream: '#E7CBA4',
      creamDark: '#D3B387',
      earInner: '#8C5E36',
      outline: 'rgba(70,45,25,0.32)'
    },
    ears: 'round',
    tail: 'stub',
    muzzle: 'round',
    nose: DARK_NOSE,
    belly: 'bib'
  },

  penguin: {
    id: 'penguin',
    label: 'Penguin',
    emoji: '🐧',
    palette: {
      fur: '#3B4757',
      furLight: '#4C5A6C',
      furDark: '#2A3444',
      furDarkest: '#1E2634',
      cream: '#FFFFFF',
      creamDark: '#ECEFF3',
      earInner: '#FFFFFF',
      outline: 'rgba(20,26,36,0.35)'
    },
    ears: 'none',
    tail: 'none',
    muzzle: 'beak',
    nose: '#F5A623',
    belly: 'round',
    markings: 'penguin',
    accent: '#F5A623'
  },

  redpanda: {
    id: 'redpanda',
    label: 'Red Panda',
    emoji: '🦝',
    palette: {
      fur: '#C56B3E',
      furLight: '#DB8557',
      furDark: '#A0522C',
      furDarkest: '#7C3E20',
      cream: '#F4E4D2',
      creamDark: '#E2CBB2',
      earInner: '#F0D6BE',
      outline: 'rgba(90,45,20,0.32)'
    },
    ears: 'round',
    earScale: 1.05,
    tail: 'ring',
    tailAccent: '#5A3A24',
    muzzle: 'round',
    nose: DARK_NOSE,
    whiskers: true,
    belly: 'bib',
    markings: 'redpanda',
    markColor: '#5A3A24',
    pawColor: '#5A3A24'
  },

  hamster: {
    id: 'hamster',
    label: 'Hamster',
    emoji: '🐹',
    palette: {
      fur: '#E8B96A',
      furLight: '#F7D79A',
      furDark: '#CE9A45',
      furDarkest: '#AE7E33',
      cream: '#FBF3E2',
      creamDark: '#ECDCBE',
      earInner: '#E0A9A0',
      outline: 'rgba(110,80,30,0.30)'
    },
    ears: 'round',
    earScale: 0.7,
    tail: 'stub',
    muzzle: 'round',
    nose: '#C98A93',
    whiskers: true,
    cheeks: true,
    belly: 'round'
  },

  frog: {
    id: 'frog',
    label: 'Frog',
    emoji: '🐸',
    palette: {
      fur: '#7BC86B',
      furLight: '#9BDD8B',
      furDark: '#57A64A',
      furDarkest: '#3F8437',
      cream: '#EAF6D9',
      creamDark: '#D3E9BE',
      earInner: '#EAF6D9',
      outline: 'rgba(40,90,35,0.32)'
    },
    ears: 'none',
    tail: 'none',
    muzzle: 'wide',
    nose: '#3F8437',
    cheeks: true,
    eyesOnTop: true,
    belly: 'round'
  },

  tiger: {
    id: 'tiger',
    label: 'Tiger',
    emoji: '🐯',
    palette: {
      fur: '#F5A733',
      furLight: '#FFC163',
      furDark: '#D9861B',
      furDarkest: '#B06913',
      cream: '#FFFFFF',
      creamDark: '#F0E7DA',
      earInner: '#F6C9A0',
      outline: 'rgba(110,60,15,0.30)'
    },
    ears: 'round',
    tail: 'bushy',
    tailAccent: '#3A2A24',
    muzzle: 'cat',
    nose: '#EC8CA0',
    whiskers: true,
    belly: 'bib',
    markings: 'tiger',
    markColor: '#3A2A24',
    pawColor: '#FFFFFF'
  },

  koala: {
    id: 'koala',
    label: 'Koala',
    emoji: '🐨',
    palette: {
      fur: '#A9B2BC',
      furLight: '#C4CBD3',
      furDark: '#8791A0',
      furDarkest: '#6E7783',
      cream: '#E7ECF1',
      creamDark: '#D2D9E0',
      earInner: '#E9C9CE',
      outline: 'rgba(60,68,78,0.30)'
    },
    ears: 'round',
    earScale: 1.5,
    tail: 'none',
    muzzle: 'round',
    nose: '#4A4038',
    noseScale: 1.9,
    belly: 'bib'
  },

  pig: {
    id: 'pig',
    label: 'Pig',
    emoji: '🐷',
    palette: {
      fur: '#F2A9C0',
      furLight: '#FFC6D6',
      furDark: '#DB86A2',
      furDarkest: '#BC6A87',
      cream: '#FBD9E4',
      creamDark: '#EFC2D2',
      earInner: '#E79AB0',
      outline: 'rgba(120,55,80,0.30)'
    },
    ears: 'floppy',
    tail: 'thin',
    muzzle: 'snout',
    nose: '#E0839C',
    belly: 'none',
    cheeks: true
  },

  mouse: {
    id: 'mouse',
    label: 'Mouse',
    emoji: '🐭',
    palette: {
      fur: '#B9BCC6',
      furLight: '#D2D5DD',
      furDark: '#9A9EAB',
      furDarkest: '#7E8291',
      cream: '#F0F1F5',
      creamDark: '#DEE0E6',
      earInner: PINK,
      outline: 'rgba(70,72,85,0.30)'
    },
    ears: 'round',
    earScale: 1.5,
    tail: 'thin',
    muzzle: 'cat',
    nose: '#EC8CA0',
    whiskers: true,
    belly: 'bib'
  },

  chick: {
    id: 'chick',
    label: 'Chick',
    emoji: '🐤',
    palette: {
      fur: '#FCD34D',
      furLight: '#FFE485',
      furDark: '#F0B429',
      furDarkest: '#D69712',
      cream: '#FFF3C4',
      creamDark: '#F5E6A8',
      earInner: '#FFF3C4',
      outline: 'rgba(150,110,20,0.32)'
    },
    ears: 'none',
    tail: 'none',
    muzzle: 'beak',
    nose: '#F5943B',
    belly: 'none',
    markings: 'bird',
    accent: '#F5943B'
  }
}

/** Deterministic picker order (cat leads — default + the design reference). */
export const SPECIES_ORDER: CharacterId[] = [
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

/** Look up a species, falling back to the cat (never throws for a bad id). */
export function speciesFor(id: CharacterId): SpeciesDef {
  return SPECIES[id] ?? SPECIES.cat
}
