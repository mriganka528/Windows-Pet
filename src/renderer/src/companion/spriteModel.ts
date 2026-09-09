// ---------------------------------------------------------------------------
// Sprite model — the pure, renderer-agnostic "shape list" for one companion.
// ---------------------------------------------------------------------------
// buildModel(species, opts) returns the character as an ordered list of PART
// GROUPS (shadow, tail, legs, body, ears, head, face), each a list of drawing
// PRIMITIVES (ellipse / circle / path / line) laid out in a fixed 100x100 design
// space, front-facing and symmetric about x=50.
//
// Why a data model instead of drawing straight to a canvas:
//   1. It's PURE — no DOM — so the exact same shapes render in the Electron
//      overlay (Canvas2D, see SpriteCanvas.tsx) AND in an offline SVG preview
//      used to eyeball every animal without launching the app.
//   2. It's testable — invariants ("every species builds a head + eyes") are
//      plain assertions.
//   3. Animation stays in the canvas layer: it takes these part groups and
//      applies per-part transforms (tail wag, ear twitch, walk bob, blink…),
//      so the art and the motion are cleanly separated.
//
// Design rule that keeps (1) honest: NO arc()-with-angles. Everything is full
// ellipses/circles, quadratic-curve paths, or straight lines — all of which map
// 1:1 to SVG (<ellipse>/<circle>/<path>/<line>). Partial arcs (smiles, sleepy
// eyes) are expressed as quad-curve paths, never ctx.arc(a,b).

import type { Mood } from './mood'
import type { SpeciesDef } from './species'

// --- primitives -------------------------------------------------------------

export interface Stroke {
  color: string
  /** Stroke width in design units (100-space); scaled by the renderer. */
  width: number
  cap?: 'round' | 'butt'
}

/** One quadratic-path segment. M = move, L = line, Q = quad curve to (x,y). */
export type Seg =
  | { t: 'M'; x: number; y: number }
  | { t: 'L'; x: number; y: number }
  | { t: 'Q'; cx: number; cy: number; x: number; y: number }

export interface EllipsePrim {
  k: 'ellipse'
  cx: number
  cy: number
  rx: number
  ry: number
  rot?: number
  fill?: string
  stroke?: Stroke
}
export interface CirclePrim {
  k: 'circle'
  cx: number
  cy: number
  r: number
  fill?: string
  stroke?: Stroke
}
export interface PathPrim {
  k: 'path'
  d: Seg[]
  closed?: boolean
  fill?: string
  stroke?: Stroke
}
export interface LinePrim {
  k: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
  stroke: Stroke
}
export type Prim = EllipsePrim | CirclePrim | PathPrim | LinePrim

/** Paint order matters: earlier parts sit behind later ones. */
export type PartId =
  // --- shared / front-facing plan ---
  | 'shadow'
  | 'tail'
  | 'legBack'
  | 'legFront'
  | 'body'
  | 'earBack'
  | 'earFront'
  | 'head'
  | 'face'
  // --- side-profile (quadruped) plan: four legs as separate parts so the
  //     canvas can swing them in a diagonal-pair gait, plus near/far ears.
  //     "near" = the side facing the viewer, "far" = the side away (drawn
  //     behind the body/head and a shade darker so it recedes).
  | 'legFarBack'
  | 'legFarFront'
  | 'legNearBack'
  | 'legNearFront'
  | 'earFar'
  | 'earNear'

export interface Part {
  id: PartId
  prims: Prim[]
  /** Pivot for the renderer's per-part animation (tail wag, ear twitch). */
  anchor?: { x: number; y: number }
}
export type CompanionModel = Part[]

export interface ModelOptions {
  expr: Mood
  /** Eyes momentarily shut (open-eye expressions only). */
  blink?: boolean
  /** Held/lifted — legs dangle a touch longer. */
  dragging?: boolean
  /** Yawn openness 0..1 (only when `yawning`). */
  yawn?: number
  yawning?: boolean
  /** Anger-vein pulse 0..1. */
  angerPulse?: number
}

// --- constant facial palette (theme-independent → stable expressions) -------

const EYE = '#33261F'
const HI = 'rgba(255,255,255,0.95)'
const MOUTH = '#6E4632'
const TONGUE = '#F58BA0'
const BLUSH = 'rgba(240,150,165,0.55)'
const ANGER = '#E4483A'
const WHISKER = 'rgba(70,55,45,0.5)'

// --- layout anchors (100x100, y down) ---------------------------------------

const MID = 50
const HEAD_Y = 34
const HEAD_R = 25
const BODY_Y = 72
const BODY_RX = 20.5
const BODY_RY = 21
const TAIL_ANCHOR = { x: 64, y: 82 }

// --- tiny prim factories ----------------------------------------------------

function ell(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fill?: string,
  stroke?: Stroke,
  rot?: number
): EllipsePrim {
  return { k: 'ellipse', cx, cy, rx, ry, rot, fill, stroke }
}
function cir(cx: number, cy: number, r: number, fill?: string, stroke?: Stroke): CirclePrim {
  return { k: 'circle', cx, cy, r, fill, stroke }
}
function path(d: Seg[], fill?: string, stroke?: Stroke, closed = true): PathPrim {
  return { k: 'path', d, closed, fill, stroke }
}
function line(x1: number, y1: number, x2: number, y2: number, stroke: Stroke): LinePrim {
  return { k: 'line', x1, y1, x2, y2, stroke }
}

/** Reflect a primitive across the x=50 axis (build one side, mirror the other). */
function reflect(pr: Prim): Prim {
  const fx = (x: number): number => 100 - x
  switch (pr.k) {
    case 'ellipse':
      return { ...pr, cx: fx(pr.cx), rot: pr.rot === undefined ? undefined : -pr.rot }
    case 'circle':
      return { ...pr, cx: fx(pr.cx) }
    case 'line':
      return { ...pr, x1: fx(pr.x1), x2: fx(pr.x2) }
    case 'path':
      return {
        ...pr,
        d: pr.d.map((s) =>
          s.t === 'Q'
            ? { t: 'Q', cx: fx(s.cx), cy: s.cy, x: fx(s.x), y: s.y }
            : { t: s.t, x: fx(s.x), y: s.y }
        )
      }
  }
}
function mirrored(prims: Prim[]): Prim[] {
  return prims.map(reflect)
}

// ===========================================================================
// buildModel
// ===========================================================================

export function buildModel(sp: SpeciesDef, opts: ModelOptions): CompanionModel {
  const p = sp.palette
  const OL: Stroke = { color: p.outline, width: 1.4 }
  const bird = sp.muzzle === 'beak'

  return [
    { id: 'shadow', prims: buildShadow() },
    { id: 'tail', prims: buildTail(sp), anchor: TAIL_ANCHOR },
    { id: 'legBack', prims: buildFoot(sp, true), anchor: { x: 50 - 12, y: 90 } },
    { id: 'legFront', prims: buildFoot(sp, false), anchor: { x: 50 + 12, y: 90 } },
    { id: 'body', prims: buildBody(sp, OL) },
    { id: 'earBack', prims: bird ? [] : buildEar(sp, OL), anchor: { x: 30, y: 16 } },
    { id: 'earFront', prims: bird ? [] : mirrored(buildEar(sp, OL)), anchor: { x: 70, y: 16 } },
    { id: 'head', prims: buildHead(sp, OL) },
    { id: 'face', prims: buildFace(sp, opts, OL) }
  ]
}

// --- shadow -----------------------------------------------------------------

function buildShadow(): Prim[] {
  return [ell(MID, 94, 24, 5, 'rgba(30,22,14,0.15)')]
}

// --- body -------------------------------------------------------------------

function buildBody(sp: SpeciesDef, OL: Stroke): Prim[] {
  const p = sp.palette
  const out: Prim[] = []

  // Penguin/bird flippers tuck behind the body.
  if (sp.markings === 'penguin') {
    out.push(ell(30, 72, 5.5, 12, p.furDark, OL, 0.22))
    out.push(ell(70, 72, 5.5, 12, p.furDark, OL, -0.22))
  } else if (sp.markings === 'bird') {
    out.push(ell(31, 74, 5, 8, p.furDark, OL, 0.3))
    out.push(ell(69, 74, 5, 8, p.furDark, OL, -0.3))
  }

  // Main body volume.
  out.push(ell(MID, BODY_Y, BODY_RX, BODY_RY, p.fur, OL))

  // Belly / chest.
  const belly = sp.bellyColor ?? p.cream
  if (sp.belly === 'bib') {
    out.push(ell(MID, 78, 12, 13.5, belly))
  } else if (sp.belly === 'round') {
    out.push(ell(MID, 76, 15.5, 16.5, belly))
  }

  // Marking overlays on the torso.
  if (sp.markings === 'tiger') {
    const st: Stroke = { color: sp.markColor ?? '#3A2A24', width: 2.4, cap: 'round' }
    out.push(line(34, 66, 33, 74, st))
    out.push(line(66, 66, 67, 74, st))
    out.push(line(40, 62, 39, 68, st))
    out.push(line(60, 62, 61, 68, st))
  } else if (sp.markings === 'redpanda') {
    // Two dark uprights (legs) framing the cream bib, rather than one wide
    // slab — otherwise the dark bridges both feet and reads as a puddle. These
    // descend into the (same-colour) paws for a clean leg→foot join.
    const dark = sp.markColor ?? '#5A3A24'
    out.push(ell(MID - 12, 86, 6.5, 10, dark))
    out.push(ell(MID + 12, 86, 6.5, 10, dark))
  }

  return out
}

// --- feet -------------------------------------------------------------------

function buildFoot(sp: SpeciesDef, back: boolean): Prim[] {
  const p = sp.palette
  const x = back ? 50 - 12 : 50 + 12
  const OL: Stroke = { color: p.outline, width: 1.2 }

  if (sp.markings === 'penguin' || sp.markings === 'bird') {
    const c = sp.accent ?? '#F5A623'
    const fx = back ? 50 - 8 : 50 + 8
    return [
      path(
        [
          { t: 'M', x: fx - 5, y: 92 },
          { t: 'Q', cx: fx, cy: 90, x: fx + 5, y: 92 },
          { t: 'Q', cx: fx + 5, cy: 95, x: fx, y: 95 },
          { t: 'Q', cx: fx - 5, cy: 95, x: fx - 5, y: 92 }
        ],
        c,
        OL
      )
    ]
  }

  const paw = sp.pawColor ?? p.fur
  return [ell(x, 90, 7.5, 5.5, paw, OL)]
}

// --- tail -------------------------------------------------------------------

function buildTail(sp: SpeciesDef): Prim[] {
  const p = sp.palette
  const OL: Stroke = { color: p.outline, width: 1.3 }
  switch (sp.tail) {
    case 'curl':
      return [
        path(
          [
            { t: 'M', x: 61, y: 84 },
            { t: 'Q', cx: 86, cy: 86, x: 87, y: 66 },
            { t: 'Q', cx: 87, cy: 57, x: 79, y: 57 },
            { t: 'Q', cx: 84, cy: 66, x: 78, y: 76 },
            { t: 'Q', cx: 72, cy: 83, x: 61, y: 80 }
          ],
          p.fur,
          OL
        )
      ]
    case 'bushy': {
      const out: Prim[] = [ell(78, 73, 11, 15.5, p.fur, OL, -0.5)]
      if (sp.tailAccent) out.push(ell(85, 61, 7, 8.5, sp.tailAccent, OL, -0.5))
      return out
    }
    case 'ring': {
      const ring = sp.tailAccent ?? '#5A3A24'
      return [
        ell(78, 73, 10.5, 15.5, p.fur, OL, -0.5),
        ell(82, 66, 9, 4, ring, undefined, -0.5),
        ell(76, 78, 9.5, 4, ring, undefined, -0.5),
        ell(85, 60, 6.5, 7.5, ring, OL, -0.5)
      ]
    }
    case 'stub':
      return [cir(70, 84, 7, sp.tailAccent ?? p.fur, OL)]
    case 'thin': {
      const st: Stroke = { color: p.fur, width: 3, cap: 'round' }
      if (sp.id === 'pig') {
        // Curly pig tail.
        return [
          path(
            [
              { t: 'M', x: 68, y: 80 },
              { t: 'Q', cx: 80, cy: 80, x: 79, y: 73 },
              { t: 'Q', cx: 78, cy: 68, x: 73, y: 71 },
              { t: 'Q', cx: 70, cy: 73, x: 73, y: 75 }
            ],
            undefined,
            st,
            false
          )
        ]
      }
      // Long thin mouse tail.
      return [
        path(
          [
            { t: 'M', x: 66, y: 82 },
            { t: 'Q', cx: 86, cy: 82, x: 87, y: 68 },
            { t: 'Q', cx: 87, cy: 60, x: 82, y: 59 }
          ],
          undefined,
          st,
          false
        )
      ]
    }
    default:
      return []
  }
}

// --- ears (left side; right = mirror) ---------------------------------------

function buildEar(sp: SpeciesDef, OL: Stroke): Prim[] {
  const p = sp.palette
  const inner = sp.earInner ?? p.earInner
  const scale = sp.earScale ?? 1
  const out: Prim[] = []

  switch (sp.ears) {
    case 'pointed': {
      out.push(
        path(
          [
            { t: 'M', x: 30, y: 3 },
            { t: 'Q', cx: 21, cy: 11, x: 24, y: 24 },
            { t: 'Q', cx: 34, cy: 20, x: 44, y: 22 },
            { t: 'Q', cx: 40, cy: 8, x: 30, y: 3 }
          ],
          p.fur,
          OL
        )
      )
      out.push(
        path(
          [
            { t: 'M', x: 30, y: 10 },
            { t: 'Q', cx: 27, cy: 16, x: 29, y: 21 },
            { t: 'Q', cx: 34, cy: 19, x: 38, y: 20 },
            { t: 'Q', cx: 35, cy: 13, x: 30, y: 10 }
          ],
          inner
        )
      )
      if (sp.earTip) {
        out.push(
          path(
            [
              { t: 'M', x: 30, y: 3 },
              { t: 'Q', cx: 25, cy: 8, x: 26, y: 13 },
              { t: 'Q', cx: 31, cy: 11, x: 34, y: 11 },
              { t: 'Q', cx: 33, cy: 6, x: 30, y: 3 }
            ],
            sp.earTip
          )
        )
      }
      return out
    }
    case 'round': {
      const r = 11 * scale
      const cx = 30 - (scale - 1) * 4
      const cy = 15 - (scale - 1) * 3
      const outer = sp.markings === 'panda' ? (sp.markColor ?? '#2B2B2B') : p.fur
      out.push(cir(cx, cy, r, outer, OL))
      if (sp.markings !== 'panda') out.push(cir(cx + 1, cy + 1, r * 0.55, inner))
      return out
    }
    case 'long': {
      out.push(ell(38, 8, 6.5, 17, p.fur, OL, -0.1))
      out.push(ell(38.5, 9, 3.4, 12.5, inner, undefined, -0.1))
      return out
    }
    case 'floppy': {
      const col = sp.id === 'pig' ? p.furDark : p.furDark
      out.push(
        path(
          [
            { t: 'M', x: 33, y: 14 },
            { t: 'Q', cx: 15, cy: 15, x: 15, y: 34 },
            { t: 'Q', cx: 16, cy: 44, x: 27, y: 41 },
            { t: 'Q', cx: 33, cy: 28, x: 37, y: 18 }
          ],
          col,
          OL
        )
      )
      out.push(
        path(
          [
            { t: 'M', x: 30, y: 20 },
            { t: 'Q', cx: 21, cy: 22, x: 21, y: 33 },
            { t: 'Q', cx: 22, cy: 39, x: 28, y: 37 },
            { t: 'Q', cx: 30, cy: 28, x: 32, y: 22 }
          ],
          inner
        )
      )
      return out
    }
    default:
      return []
  }
}

// --- head + head-level markings/muzzle --------------------------------------

function buildHead(sp: SpeciesDef, OL: Stroke): Prim[] {
  const p = sp.palette
  const out: Prim[] = []

  // Frog eye-bulges (fur domes) sit as part of the head silhouette.
  if (sp.eyesOnTop) {
    out.push(cir(36, 16, 10, p.fur, OL))
    out.push(cir(64, 16, 10, p.fur, OL))
  }

  // Head volume.
  out.push(cir(MID, HEAD_Y, HEAD_R, p.fur, OL))

  // Penguin: white face plate leaving a dark cap.
  if (sp.markings === 'penguin') {
    out.push(ell(MID, 37, 16.5, 17, p.cream))
  }

  // Panda eye patches (under the eyes).
  if (sp.markings === 'panda') {
    const m = sp.markColor ?? '#2B2B2B'
    out.push(ell(40, 35, 7, 9, m, undefined, 0.25))
    out.push(ell(60, 35, 7, 9, m, undefined, -0.25))
  }

  // Fox / red-panda pale face mask.
  if (sp.markings === 'fox' || sp.markings === 'redpanda') {
    out.push(ell(MID, 44, 15, 12, p.cream))
    out.push(ell(37, 30, 6, 7, p.cream))
    out.push(ell(63, 30, 6, 7, p.cream))
    if (sp.markings === 'redpanda') {
      const t: Stroke = { color: sp.markColor ?? '#5A3A24', width: 2.4, cap: 'round' }
      out.push(line(41, 40, 39, 50, t))
      out.push(line(59, 40, 61, 50, t))
    }
  }

  // Tiger forehead + cheek stripes.
  if (sp.markings === 'tiger') {
    const t: Stroke = { color: sp.markColor ?? '#3A2A24', width: 2.2, cap: 'round' }
    out.push(line(50, 11, 50, 20, t))
    out.push(line(42, 13, 40, 21, t))
    out.push(line(58, 13, 60, 21, t))
    out.push(line(26, 34, 33, 35, t))
    out.push(line(74, 34, 67, 35, t))
  }

  // Muzzle patch (nose/mouth sit on top, drawn in the face layer).
  if (sp.muzzle === 'dog') {
    out.push(ell(MID, 48, 13, 10, p.cream, OL))
  } else if (sp.muzzle === 'round') {
    out.push(ell(MID, 47, 11, 8.5, p.cream, OL))
  } else if (sp.muzzle === 'snout') {
    const snout = sp.nose
    out.push(ell(MID, 46, 10.5, 8, snout, OL))
    out.push(ell(46, 46, 1.6, 2.4, 'rgba(0,0,0,0.35)'))
    out.push(ell(54, 46, 1.6, 2.4, 'rgba(0,0,0,0.35)'))
  }

  return out
}

// --- face / expressions -----------------------------------------------------

function buildFace(sp: SpeciesDef, opts: ModelOptions, OL: Stroke): Prim[] {
  const expr = opts.expr
  const out: Prim[] = []

  // Eye geometry (species tweaks).
  const bird = sp.markings === 'penguin' || sp.markings === 'bird'
  const eyeCX = sp.eyesOnTop ? 14 : bird ? 8 : 11
  const eyeCY = sp.eyesOnTop ? 16 : bird ? 33 : 37
  const wide = expr === 'surprised'
  const eyeRX = (sp.eyesOnTop ? 6 : bird ? 5 : 6.6) * (wide ? 1.12 : 1)
  const eyeRY = (sp.eyesOnTop ? 7 : bird ? 6 : 8.2) * (wide ? 1.12 : 1)
  const L = { x: 50 - eyeCX, y: eyeCY }
  const R = { x: 50 + eyeCX, y: eyeCY }

  // Round-eyed looks that can also blink. The half-lidded moods (chill/grumpy)
  // and the fully-closed ones (sleepy) are handled on their own branches below.
  const openEyes =
    expr === 'neutral' ||
    expr === 'happy' ||
    expr === 'surprised' ||
    expr === 'alert' ||
    expr === 'excited' ||
    expr === 'curious'
  const doBlink = !!opts.blink && openEyes

  // Frog gets big white sclera behind the pupils.
  if (sp.eyesOnTop) {
    out.push(cir(L.x, L.y, 7, '#FFFFFF', OL))
    out.push(cir(R.x, R.y, 7, '#FFFFFF', OL))
  }

  // --- eyes ---
  if (opts.yawning && (expr === 'neutral' || expr === 'happy' || expr === 'sleepy')) {
    pushSleepyEyes(out, L, R)
  } else if (doBlink) {
    pushBlink(out, L, R)
  } else if (expr === 'sleepy') {
    pushSleepyEyes(out, L, R)
  } else if (expr === 'love') {
    pushArcEyes(out, L, R)
  } else if (expr === 'angry') {
    pushAngryEyes(out, L, R, sp)
  } else if (expr === 'chill' && !sp.eyesOnTop) {
    // Relaxed, half-open "content" eyes — calm and easy.
    pushHalfLidEyes(out, L, R, eyeRX, eyeRY, 'relaxed')
  } else if (expr === 'grumpy' && !sp.eyesOnTop) {
    // Sulky half-lids under a low, inward furrow (softer than the angry glare,
    // and with no red vein).
    pushHalfLidEyes(out, L, R, eyeRX, eyeRY, 'annoyed')
    pushBrows(out, L, R, sp, 'sulky')
  } else {
    // neutral / happy / surprised / alert / excited / curious (+ frog fallback).
    // Alert opens the eyes wider (watchful); happy stays the warm round default,
    // so the two now read differently even before brows/mouth.
    const scale = expr === 'alert' ? 1.16 : 1
    pushRoundEyes(out, L, R, eyeRX * scale, eyeRY * scale, sp.eyesOnTop ? 3.6 : 0)
    if (!sp.eyesOnTop) {
      if (expr === 'excited') pushSparkle(out, L, R, eyeRX)
      else if (expr === 'alert') pushBrows(out, L, R, sp, 'raised')
      else if (expr === 'curious') pushBrows(out, L, R, sp, 'quizzical')
    }
  }

  // --- nose / beak ---
  if (bird) {
    // Orange beak (diamond).
    const by = sp.markings === 'penguin' ? 42 : 40
    out.push(
      path(
        [
          { t: 'M', x: 50, y: by },
          { t: 'Q', cx: 56, cy: by + 3, x: 50, y: by + 6 },
          { t: 'Q', cx: 44, cy: by + 3, x: 50, y: by }
        ],
        sp.accent ?? '#F5A623',
        OL
      )
    )
  } else if (sp.muzzle === 'snout') {
    // Nostrils already on the snout (head layer); no separate nose.
  } else if (sp.eyesOnTop) {
    // Frog nostril dots.
    out.push(cir(47, 34, 0.9, sp.nose))
    out.push(cir(53, 34, 0.9, sp.nose))
  } else {
    pushNose(out, sp)
  }

  // --- mouth ---
  if (opts.yawning) {
    pushYawn(out, opts.yawn ?? 0.5)
  } else if (bird) {
    // beak is the mouth
  } else if (sp.eyesOnTop) {
    pushFrogMouth(out, expr)
  } else if (expr === 'love') {
    pushOpenSmile(out, sp)
  } else if (expr === 'excited') {
    pushGrin(out) // big open joyful grin
  } else if (expr === 'angry') {
    pushFrown(out)
  } else if (expr === 'grumpy') {
    pushPout(out) // wider, flatter down-tug than the angry frown
  } else if (expr === 'surprised') {
    out.push(cir(50, 51, 2.4, MOUTH))
  } else if (expr === 'curious') {
    out.push(cir(50, 50.5, 1.7, MOUTH)) // tiny "oh?"
  } else if (expr === 'alert') {
    out.push(ell(50, 50.5, 2, 1.6, MOUTH)) // small attentive open mouth
  } else {
    // neutral / happy / chill — a gentle species-appropriate smile (happy wider).
    pushMouth(out, sp, expr === 'happy')
  }

  // --- whiskers ---
  if (sp.whiskers && !opts.yawning) {
    const w: Stroke = { color: WHISKER, width: 1, cap: 'round' }
    out.push(line(32, 45, 16, 42, w))
    out.push(line(32, 48, 15, 48, w))
    out.push(line(32, 51, 16, 54, w))
    out.push(line(68, 45, 84, 42, w))
    out.push(line(68, 48, 85, 48, w))
    out.push(line(68, 51, 84, 54, w))
  }

  // --- cheeks / blush ---
  if (
    sp.cheeks ||
    expr === 'happy' ||
    expr === 'love' ||
    expr === 'excited' ||
    expr === 'grumpy'
  ) {
    // Excited/love get a strong rosy blush; grumpy gets bigger, softer PUFFED
    // cheeks (sulky, not glowing); species with natural cheek pouches keep theirs.
    const strong = expr === 'love' || expr === 'excited' || (sp.cheeks && expr !== 'angry' && expr !== 'grumpy')
    const rx = sp.cheeks ? 5.5 : expr === 'grumpy' ? 5 : 4
    const ry = sp.cheeks ? 4 : expr === 'grumpy' ? 3.4 : 2.6
    const col = strong ? BLUSH : 'rgba(240,150,165,0.4)'
    const cyb = sp.eyesOnTop ? 30 : 45
    out.push(ell(35, cyb, rx, ry, col))
    out.push(ell(65, cyb, rx, ry, col))
  }

  // --- anger vein overlay ---
  if (expr === 'angry') {
    pushAngerVein(out, opts.angerPulse ?? 0.9)
  }

  return out
}

// --- eye styles -------------------------------------------------------------

function pushRoundEyes(
  out: Prim[],
  L: { x: number; y: number },
  R: { x: number; y: number },
  rx: number,
  ry: number,
  pupilInset: number
): void {
  for (const e of [L, R]) {
    if (pupilInset > 0) {
      // Frog-style: dark pupil inside the white sclera.
      out.push(cir(e.x, e.y, 4, EYE))
      out.push(cir(e.x - 1.3, e.y - 1.5, 1.5, HI))
    } else {
      out.push(ell(e.x, e.y, rx, ry, EYE))
      out.push(cir(e.x - rx * 0.32, e.y - ry * 0.34, rx * 0.42, HI))
      out.push(cir(e.x + rx * 0.28, e.y + ry * 0.24, rx * 0.2, 'rgba(255,255,255,0.7)'))
    }
  }
}

function pushBlink(out: Prim[], L: { x: number; y: number }, R: { x: number; y: number }): void {
  const st: Stroke = { color: EYE, width: 2, cap: 'round' }
  for (const e of [L, R]) out.push(line(e.x - 4.5, e.y, e.x + 4.5, e.y, st))
}

function pushSleepyEyes(
  out: Prim[],
  L: { x: number; y: number },
  R: { x: number; y: number }
): void {
  // Downward "︶ ︶" closed arcs.
  const st: Stroke = { color: EYE, width: 2.1, cap: 'round' }
  for (const e of [L, R]) {
    out.push(
      path(
        [
          { t: 'M', x: e.x - 4.6, y: e.y - 0.5 },
          { t: 'Q', cx: e.x, cy: e.y + 4, x: e.x + 4.6, y: e.y - 0.5 }
        ],
        undefined,
        st,
        false
      )
    )
  }
}

function pushArcEyes(out: Prim[], L: { x: number; y: number }, R: { x: number; y: number }): void {
  // Happy upward "‿ ‿".
  const st: Stroke = { color: EYE, width: 2.4, cap: 'round' }
  for (const e of [L, R]) {
    out.push(
      path(
        [
          { t: 'M', x: e.x - 4.6, y: e.y + 1.5 },
          { t: 'Q', cx: e.x, cy: e.y - 4, x: e.x + 4.6, y: e.y + 1.5 }
        ],
        undefined,
        st,
        false
      )
    )
  }
}

function pushAngryEyes(
  out: Prim[],
  L: { x: number; y: number },
  R: { x: number; y: number },
  sp: SpeciesDef
): void {
  // Narrowed glare + inner-down brows.
  for (const e of [L, R]) {
    out.push(ell(e.x, e.y + 1, 4, 4, EYE))
    out.push(cir(e.x - 1, e.y, 1, HI))
  }
  const st: Stroke = { color: sp.palette.furDarkest, width: 2.2, cap: 'round' }
  out.push(line(L.x - 4, L.y - 6, L.x + 4, L.y - 3, st))
  out.push(line(R.x + 4, R.y - 6, R.x - 4, R.y - 3, st))
}

// Half-open "content" (chill) or "sulky" (grumpy) eyes: a flat top lid with a
// rounded lower half, built as a filled quad path (no arc()). Annoyed sits a
// touch lower and closes further; relaxed stays more open. A small catch-light
// keeps them lively rather than dead.
function pushHalfLidEyes(
  out: Prim[],
  L: { x: number; y: number },
  R: { x: number; y: number },
  rx: number,
  ry: number,
  mode: 'relaxed' | 'annoyed'
): void {
  const w = rx * 1.02
  const h = ry * (mode === 'annoyed' ? 0.72 : 0.95)
  const lidY = mode === 'annoyed' ? 0.5 : -0.5
  for (const e of [L, R]) {
    const top = e.y + lidY
    out.push(
      path(
        [
          { t: 'M', x: e.x - w, y: top },
          { t: 'L', x: e.x + w, y: top },
          { t: 'Q', cx: e.x, cy: top + h, x: e.x - w, y: top }
        ],
        EYE
      )
    )
    out.push(cir(e.x - w * 0.28, top + h * 0.35, w * 0.22, HI))
  }
}

// Little brows above the eyes. `raised` = both high & arched (alert/attentive),
// `quizzical` = one flat + one high (curious "hmm?"), `sulky` = both angled down
// toward the nose (grumpy — softer than the angry glare). Drawn in the species'
// darkest fur so they read on any coat.
function pushBrows(
  out: Prim[],
  L: { x: number; y: number },
  R: { x: number; y: number },
  sp: SpeciesDef,
  kind: 'raised' | 'quizzical' | 'sulky'
): void {
  const st: Stroke = { color: sp.palette.furDarkest, width: 1.8, cap: 'round' }
  if (kind === 'raised') {
    for (const e of [L, R]) {
      out.push(
        path(
          [
            { t: 'M', x: e.x - 4.5, y: e.y - 8 },
            { t: 'Q', cx: e.x, cy: e.y - 11.5, x: e.x + 4.5, y: e.y - 8 }
          ],
          undefined,
          st,
          false
        )
      )
    }
  } else if (kind === 'quizzical') {
    // Left brow low & flat, right brow high & arched.
    out.push(line(L.x - 4.5, L.y - 7, L.x + 4, L.y - 6.5, st))
    out.push(
      path(
        [
          { t: 'M', x: R.x - 4.5, y: R.y - 8.5 },
          { t: 'Q', cx: R.x, cy: R.y - 12.5, x: R.x + 4.5, y: R.y - 9 }
        ],
        undefined,
        st,
        false
      )
    )
  } else {
    // sulky: inner ends pulled down toward the center.
    out.push(line(L.x - 4.5, L.y - 7.5, L.x + 4, L.y - 4.5, st))
    out.push(line(R.x + 4.5, R.y - 7.5, R.x - 4, R.y - 4.5, st))
  }
}

// A 4-point "sparkle" catch-light over each pupil — the starry-eyed excited look.
function pushSparkle(
  out: Prim[],
  L: { x: number; y: number },
  R: { x: number; y: number },
  rx: number
): void {
  const st: Stroke = { color: 'rgba(255,255,255,0.95)', width: 1.3, cap: 'round' }
  for (const e of [L, R]) {
    const cx = e.x - rx * 0.12
    const cy = e.y - rx * 0.18
    const s = rx * 0.72
    out.push(line(cx, cy - s, cx, cy + s, st))
    out.push(line(cx - s, cy, cx + s, cy, st))
    out.push(cir(cx, cy, rx * 0.2, '#FFFFFF'))
  }
}

// --- nose / mouths ----------------------------------------------------------

function pushNose(out: Prim[], sp: SpeciesDef): void {
  const scale = sp.noseScale ?? 1
  const ny = 46
  if (sp.muzzle === 'round' || sp.muzzle === 'dog') {
    // Rounded nose (koala big).
    out.push(ell(MID, ny, 3.4 * scale, 2.8 * scale, sp.nose))
    out.push(cir(MID - 1 * scale, ny - 1 * scale, 0.9 * scale, 'rgba(255,255,255,0.5)'))
  } else {
    // Little triangle (cat/fox/bunny/mouse/tiger/hamster).
    out.push(
      path(
        [
          { t: 'M', x: 47, y: 44.5 },
          { t: 'L', x: 53, y: 44.5 },
          { t: 'Q', cx: 50, cy: 48, x: 50, y: 48 },
          { t: 'Q', cx: 47, cy: 44.5, x: 47, y: 44.5 }
        ],
        sp.nose
      )
    )
  }
}

function pushMouth(out: Prim[], sp: SpeciesDef, big: boolean): void {
  const st: Stroke = { color: MOUTH, width: 1.6, cap: 'round' }
  if (sp.muzzle === 'cat') {
    // ω cat mouth under the nose.
    out.push(
      path([{ t: 'M', x: 50, y: 48 }, { t: 'Q', cx: 46, cy: 52, x: 43, y: 50 }], undefined, st, false)
    )
    out.push(
      path([{ t: 'M', x: 50, y: 48 }, { t: 'Q', cx: 54, cy: 52, x: 57, y: 50 }], undefined, st, false)
    )
  } else {
    // Simple smile.
    out.push(
      path(
        [{ t: 'M', x: 44, y: 50 }, { t: 'Q', cx: 50, cy: big ? 57 : 54, x: 56, y: 50 }],
        undefined,
        st,
        false
      )
    )
  }
}

function pushOpenSmile(out: Prim[], sp: SpeciesDef): void {
  out.push(
    path(
      [
        { t: 'M', x: 44, y: 50 },
        { t: 'Q', cx: 50, cy: 60, x: 56, y: 50 },
        { t: 'Q', cx: 50, cy: 52, x: 44, y: 50 }
      ],
      MOUTH
    )
  )
  out.push(ell(50, 55, 3.2, 2.6, TONGUE))
  void sp
}

function pushFrown(out: Prim[]): void {
  const st: Stroke = { color: MOUTH, width: 1.8, cap: 'round' }
  out.push(
    path([{ t: 'M', x: 45, y: 53 }, { t: 'Q', cx: 50, cy: 49, x: 55, y: 53 }], undefined, st, false)
  )
}

// Big open joyful grin (excited) — wider than the love smile, with a happy
// tongue tip.
function pushGrin(out: Prim[]): void {
  out.push(
    path(
      [
        { t: 'M', x: 42, y: 49 },
        { t: 'Q', cx: 50, cy: 62, x: 58, y: 49 },
        { t: 'Q', cx: 50, cy: 53, x: 42, y: 49 }
      ],
      MOUTH
    )
  )
  out.push(ell(50, 55.5, 3, 2.2, TONGUE))
}

// Sulky pout (grumpy) — a wider, flatter down-tug than the angry frown so the
// two read differently; paired with the sulky brows and puffed cheeks.
function pushPout(out: Prim[]): void {
  const st: Stroke = { color: MOUTH, width: 1.8, cap: 'round' }
  out.push(
    path([{ t: 'M', x: 44, y: 53 }, { t: 'Q', cx: 50, cy: 49.5, x: 56, y: 53 }], undefined, st, false)
  )
}

function pushFrogMouth(out: Prim[], expr: Mood): void {
  const st: Stroke = { color: '#3F8437', width: 2, cap: 'round' }
  // Positive dy bows the wide mouth down at the center (a smile); negative bows
  // it up (a frown). Grumpy frowns; the lively/soft moods widen the smile.
  const dy =
    expr === 'happy' || expr === 'love' || expr === 'excited'
      ? 7
      : expr === 'chill'
        ? 6
        : expr === 'sleepy'
          ? 2
          : expr === 'grumpy'
            ? -4
            : 5
  out.push(
    path([{ t: 'M', x: 30, y: 46 }, { t: 'Q', cx: 50, cy: 46 + dy, x: 70, y: 46 }], undefined, st, false)
  )
}

function pushYawn(out: Prim[], open: number): void {
  const o = Math.max(0.1, open)
  out.push(ell(50, 51 + o * 2, 3.4, 2 + o * 5, MOUTH))
  out.push(ell(50, 53 + o * 3, 2, 1 + o * 2, TONGUE))
}

function pushAngerVein(out: Prim[], pulse: number): void {
  const s = 0.8 + pulse * 0.3
  const cx = 70
  const cy = 15
  const st: Stroke = { color: ANGER, width: 1.6, cap: 'round' }
  const arm = 4 * s
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    out.push(
      line(
        cx + Math.cos(a) * 1.5 * s,
        cy + Math.sin(a) * 1.5 * s,
        cx + Math.cos(a) * arm,
        cy + Math.sin(a) * arm,
        st
      )
    )
  }
}

// ===========================================================================
// buildProfileModel — the SIDE-ON, four-legged plan (facing RIGHT)
// ===========================================================================
// The front-facing plan above is what the pet shows at rest / when petted /
// while pawing a notification. This second plan is what it shows while WALKING
// across the screen: a proper side profile with four legs the canvas swings in
// a diagonal-pair gait, so it moves like a real animal instead of shuffling
// face-on. Facing left is just the whole thing mirrored by the renderer, so we
// only ever build it facing right.
//
// It is data-driven from the SAME SpeciesDef as buildModel (palette + ears/
// tail/muzzle/markings/nose/…), so adding an animal still means editing only
// species.ts. Markings are deliberately simplified in profile (a stripe or two,
// a dark leg) — a side silhouette carries the animal more than face patches do,
// and busy overlays read as noise at overlay sizes.
//
// Three body archetypes, chosen from morphology already on the species:
//   • quadruped  — the default (cat, dog, fox, bear, …): 4 legs, horizontal body
//   • bird       — muzzle === 'beak' (penguin, chick): upright egg, 2 feet, side
//                  beak, near flipper; the canvas rocks it into a waddle
//   • frog       — eyesOnTop (frog): low crouch, bulging eyes on top, 4 short legs

// Side-profile layout anchors (100x100, y down, nose toward +x / the right).
const PF_BODY = { cx: 43, cy: 63, rx: 27, ry: 17 }
const PF_HEAD = { cx: 74, cy: 41, r: 17 }
const PF_LEG_TOP = 70 // hip/shoulder line where legs meet the body underside
const PF_FOOT_Y = 90 // planted-foot height
// x of each of the four legs. Front pair sit under the chest (near the head),
// back pair under the rump; "near" legs are a touch outboard of their "far"
// partners so both read.
const PF_LEG_X = { nearFront: 67, farFront: 59, nearBack: 28, farBack: 20 }

const PF_EYE = { x: 79, y: 37 } // near eye, on the viewer-facing cheek

export function buildProfileModel(sp: SpeciesDef, opts: ModelOptions): CompanionModel {
  const p = sp.palette
  const OL: Stroke = { color: p.outline, width: 1.4 }
  const bird = sp.muzzle === 'beak'
  const frog = !!sp.eyesOnTop

  if (bird) return buildBirdProfile(sp, opts, OL)
  if (frog) return buildFrogProfile(sp, opts, OL)

  // --- default quadruped -----------------------------------------------------
  // Paint order (back → front): shadow, tail, the two FAR legs (behind the
  // body), body, the far ear + head, then the two NEAR legs (in front of the
  // body), near ear, and finally the face. Each leg is its own part so the
  // canvas can swing it about its hip anchor.
  return [
    { id: 'shadow', prims: buildProfileShadow() },
    { id: 'tail', prims: buildProfileTail(sp, OL), anchor: { x: 18, y: 60 } },
    {
      id: 'legFarBack',
      prims: buildProfileLeg(sp, PF_LEG_X.farBack, false),
      anchor: { x: PF_LEG_X.farBack, y: PF_LEG_TOP }
    },
    {
      id: 'legFarFront',
      prims: buildProfileLeg(sp, PF_LEG_X.farFront, false),
      anchor: { x: PF_LEG_X.farFront, y: PF_LEG_TOP }
    },
    { id: 'body', prims: buildProfileBody(sp, OL) },
    { id: 'earFar', prims: buildProfileEar(sp, false, OL), anchor: { x: 68, y: 26 } },
    { id: 'head', prims: buildProfileHead(sp, OL) },
    {
      id: 'legNearBack',
      prims: buildProfileLeg(sp, PF_LEG_X.nearBack, true),
      anchor: { x: PF_LEG_X.nearBack, y: PF_LEG_TOP }
    },
    {
      id: 'legNearFront',
      prims: buildProfileLeg(sp, PF_LEG_X.nearFront, true),
      anchor: { x: PF_LEG_X.nearFront, y: PF_LEG_TOP }
    },
    { id: 'earNear', prims: buildProfileEar(sp, true, OL), anchor: { x: 72, y: 25 } },
    { id: 'face', prims: buildProfileFace(sp, opts) }
  ]
}

// The side shadow is a touch left of centre to sit under the profile body mass.
function buildProfileShadow(): Prim[] {
  return [ell(46, 94, 25, 5, 'rgba(30,22,14,0.15)')]
}

// One quadruped leg: a rounded column + a paw, anchored (for animation) at the
// hip. Far legs are drawn in the body's shade so they recede; a panda's legs go
// black. Everything is full ellipses → maps 1:1 to the SVG preview.
function buildProfileLeg(sp: SpeciesDef, x: number, near: boolean, footY = PF_FOOT_Y): Prim[] {
  const p = sp.palette
  const OL: Stroke = { color: p.outline, width: 1.2 }
  // Panda / fox / red-panda wear dark legs ("socks") — a strong side-view cue.
  const darkLegs =
    sp.markings === 'panda' || sp.markings === 'fox' || sp.markings === 'redpanda'
  const legCol = darkLegs ? (sp.markColor ?? '#2B2B2B') : near ? p.fur : p.furDark
  const pawCol = darkLegs
    ? (sp.markColor ?? '#2B2B2B')
    : (sp.pawColor ?? (near ? p.fur : p.furDark))
  const w = near ? 4 : 3.6
  const top = PF_LEG_TOP
  const cy = (top + footY) / 2
  const ry = (footY - top) / 2 + 1.5
  return [ell(x, cy, w, ry, legCol, OL), ell(x, footY, 5.2, 3.3, pawCol, OL)]
}

// Horizontal body volume + belly patch + a light marking hint.
function buildProfileBody(sp: SpeciesDef, OL: Stroke): Prim[] {
  const p = sp.palette
  const out: Prim[] = [ell(PF_BODY.cx, PF_BODY.cy, PF_BODY.rx, PF_BODY.ry, p.fur, OL)]

  const belly = sp.bellyColor ?? p.cream
  if (sp.belly === 'bib') out.push(ell(54, 70, 15, 9, belly))
  else if (sp.belly === 'round') out.push(ell(47, 70, 21, 11, belly))

  if (sp.markings === 'tiger') {
    const st: Stroke = { color: sp.markColor ?? '#3A2A24', width: 2.4, cap: 'round' }
    out.push(line(30, 52, 28, 62, st))
    out.push(line(40, 49, 38, 60, st))
    out.push(line(50, 49, 48, 60, st))
  }
  // (fox / red-panda dark "socks" are drawn on the legs, not as a body band.)
  return out
}

// Head volume + muzzle/snout + head-level marking hints (facing right).
function buildProfileHead(sp: SpeciesDef, OL: Stroke): Prim[] {
  const p = sp.palette
  const out: Prim[] = [cir(PF_HEAD.cx, PF_HEAD.cy, PF_HEAD.r, p.fur, OL)]

  // Panda: dark ear already; add the eye patch on the near side.
  if (sp.markings === 'panda') {
    out.push(ell(80, 37, 6, 7.5, sp.markColor ?? '#2B2B2B', undefined, -0.15))
  }
  // Fox / red-panda pale cheek.
  if (sp.markings === 'fox' || sp.markings === 'redpanda') {
    out.push(ell(82, 46, 9, 8, p.cream))
  }
  // Tiger head stripes.
  if (sp.markings === 'tiger') {
    const st: Stroke = { color: sp.markColor ?? '#3A2A24', width: 2, cap: 'round' }
    out.push(line(70, 27, 69, 33, st))
    out.push(line(64, 30, 62, 35, st))
  }

  // Muzzle / snout pushes forward (to the right).
  if (sp.muzzle === 'dog' || sp.muzzle === 'round') {
    out.push(ell(87, 46, 8.5, 7.5, p.cream, OL))
  } else if (sp.muzzle === 'cat') {
    out.push(ell(88, 47, 6.5, 5.5, sp.bellyColor ?? p.cream, OL))
  } else if (sp.muzzle === 'snout') {
    out.push(ell(90, 45, 6.5, 6.5, sp.nose, OL))
    out.push(ell(90, 43, 1.4, 2, 'rgba(0,0,0,0.35)'))
    out.push(ell(90, 47, 1.4, 2, 'rgba(0,0,0,0.35)'))
  }
  return out
}

// A single profile ear. Near ear is full fur + inner; far ear is smaller,
// set back and drawn in the darker shade so it sits "behind" the head.
function buildProfileEar(sp: SpeciesDef, near: boolean, OL: Stroke): Prim[] {
  if (sp.ears === 'none') return []
  const p = sp.palette
  const inner = sp.earInner ?? p.earInner
  const scale = (sp.earScale ?? 1) * (near ? 1 : 0.82)
  const col = sp.markings === 'panda' ? (sp.markColor ?? '#2B2B2B') : near ? p.fur : p.furDark
  // Near ear sits forward/up on the head; far ear peeks from behind, back-left.
  const bx = near ? 72 : 66
  const by = near ? 26 : 25
  const out: Prim[] = []

  switch (sp.ears) {
    case 'pointed': {
      const h = 15 * scale
      const w = 8 * scale
      out.push(
        path(
          [
            { t: 'M', x: bx - w * 0.4, y: by },
            { t: 'Q', cx: bx + w * 0.2, cy: by - h, x: bx + w, y: by - h * 0.55 },
            { t: 'Q', cx: bx + w * 0.6, cy: by, x: bx - w * 0.4, y: by }
          ],
          col,
          OL
        )
      )
      if (near && sp.earTip) {
        out.push(
          path(
            [
              { t: 'M', x: bx + w * 0.2, y: by - h * 0.55 },
              { t: 'Q', cx: bx + w * 0.3, cy: by - h, x: bx + w, y: by - h * 0.55 },
              { t: 'Q', cx: bx + w * 0.6, cy: by - h * 0.4, x: bx + w * 0.2, y: by - h * 0.55 }
            ],
            sp.earTip
          )
        )
      }
      if (near) out.push(ell(bx + w * 0.25, by - h * 0.4, w * 0.28, h * 0.34, inner, undefined, 0.3))
      return out
    }
    case 'long': {
      out.push(ell(bx, by - 12, 5 * scale, 15 * scale, col, OL, near ? 0.15 : 0.05))
      if (near) out.push(ell(bx, by - 12, 2.6 * scale, 11 * scale, inner, undefined, 0.15))
      return out
    }
    case 'floppy': {
      out.push(ell(bx - 2, by + 4, 6.5 * scale, 9 * scale, p.furDark, OL, 0.35))
      if (near) out.push(ell(bx - 2, by + 4, 3.2 * scale, 5.5 * scale, inner, undefined, 0.35))
      return out
    }
    case 'round':
    default: {
      const r = 9 * scale
      out.push(cir(bx, by - r * 0.4, r, col, OL))
      if (near && sp.markings !== 'panda') out.push(cir(bx, by - r * 0.4, r * 0.5, inner))
      return out
    }
  }
}

// Profile tail at the rump (left). Reuses the tail vocabulary, re-posed side-on.
function buildProfileTail(sp: SpeciesDef, OL: Stroke): Prim[] {
  const p = sp.palette
  switch (sp.tail) {
    case 'curl':
      return [
        path(
          [
            { t: 'M', x: 18, y: 60 },
            { t: 'Q', cx: 4, cy: 54, x: 8, y: 42 },
            { t: 'Q', cx: 11, cy: 36, x: 16, y: 40 },
            { t: 'Q', cx: 12, cy: 46, x: 15, y: 52 },
            { t: 'Q', cx: 17, cy: 57, x: 22, y: 60 }
          ],
          p.fur,
          OL
        )
      ]
    case 'bushy': {
      const out: Prim[] = [ell(12, 52, 11, 14, p.fur, OL, 0.5)]
      if (sp.tailAccent) out.push(ell(7, 42, 6.5, 8, sp.tailAccent, OL, 0.5))
      return out
    }
    case 'ring': {
      const ring = sp.tailAccent ?? '#5A3A24'
      return [
        ell(13, 53, 10, 14, p.fur, OL, 0.5),
        ell(9, 46, 8, 3.6, ring, undefined, 0.5),
        ell(15, 58, 9, 3.6, ring, undefined, 0.5),
        ell(6, 40, 6, 7, ring, OL, 0.5)
      ]
    }
    case 'stub':
      return [cir(17, 58, 6.5, sp.tailAccent ?? p.fur, OL)]
    case 'thin': {
      const st: Stroke = { color: p.fur, width: 3, cap: 'round' }
      if (sp.id === 'pig') {
        return [
          path(
            [
              { t: 'M', x: 18, y: 58 },
              { t: 'Q', cx: 8, cy: 58, x: 9, y: 51 },
              { t: 'Q', cx: 10, cy: 46, x: 15, y: 49 },
              { t: 'Q', cx: 18, cy: 51, x: 15, y: 53 }
            ],
            undefined,
            st,
            false
          )
        ]
      }
      return [
        path(
          [
            { t: 'M', x: 18, y: 60 },
            { t: 'Q', cx: 2, cy: 58, x: 4, y: 44 },
            { t: 'Q', cx: 5, cy: 38, x: 10, y: 38 }
          ],
          undefined,
          st,
          false
        )
      ]
    }
    default:
      return []
  }
}

// Profile face: one near eye (expression-aware), nose at the muzzle tip, a small
// mouth, optional whiskers/cheeks. Kept lighter than the front face — a profile
// only shows one side.
function buildProfileFace(sp: SpeciesDef, opts: ModelOptions): Prim[] {
  const out: Prim[] = []
  const expr = opts.expr
  const E = PF_EYE
  const openEyes =
    expr === 'neutral' ||
    expr === 'happy' ||
    expr === 'surprised' ||
    expr === 'alert' ||
    expr === 'excited' ||
    expr === 'curious'
  const doBlink = !!opts.blink && openEyes
  const closed = opts.yawning || expr === 'sleepy' || doBlink

  // --- near eye ---
  if (expr === 'love') {
    const st: Stroke = { color: EYE, width: 2.2, cap: 'round' }
    out.push(
      path(
        [
          { t: 'M', x: E.x - 4, y: E.y + 1 },
          { t: 'Q', cx: E.x, cy: E.y - 4, x: E.x + 4, y: E.y + 1 }
        ],
        undefined,
        st,
        false
      )
    )
  } else if (closed) {
    const st: Stroke = { color: EYE, width: 2, cap: 'round' }
    out.push(
      path(
        [
          { t: 'M', x: E.x - 4, y: E.y - 0.5 },
          { t: 'Q', cx: E.x, cy: E.y + 3, x: E.x + 4, y: E.y - 0.5 }
        ],
        undefined,
        st,
        false
      )
    )
  } else if (expr === 'angry') {
    out.push(ell(E.x, E.y + 1, 3.8, 3.8, EYE))
    out.push(cir(E.x - 1, E.y, 1, HI))
    const st: Stroke = { color: sp.palette.furDarkest, width: 2.2, cap: 'round' }
    out.push(line(E.x - 4, E.y - 6, E.x + 4.5, E.y - 3.5, st))
  } else if (expr === 'chill' || expr === 'grumpy') {
    // Half-lidded near eye (filled lower half): calm (chill) or sulky (grumpy).
    const h = expr === 'grumpy' ? 4 : 5.2
    const top = E.y + (expr === 'grumpy' ? 0.5 : -0.5)
    out.push(
      path(
        [
          { t: 'M', x: E.x - 4.4, y: top },
          { t: 'L', x: E.x + 4.4, y: top },
          { t: 'Q', cx: E.x, cy: top + h, x: E.x - 4.4, y: top }
        ],
        EYE
      )
    )
    out.push(cir(E.x - 1.2, top + h * 0.4, 1, HI))
    if (expr === 'grumpy') {
      const bst: Stroke = { color: sp.palette.furDarkest, width: 2, cap: 'round' }
      out.push(line(E.x - 4.5, E.y - 6.5, E.x + 4.5, E.y - 4, bst))
    }
  } else {
    const wide = expr === 'surprised' || expr === 'alert'
    const rx = 4.6 * (wide ? 1.14 : 1)
    const ry = 5.6 * (wide ? 1.14 : 1)
    out.push(ell(E.x, E.y, rx, ry, EYE))
    out.push(cir(E.x - rx * 0.32, E.y - ry * 0.34, rx * 0.42, HI))
    if (expr === 'excited') {
      const sst: Stroke = { color: 'rgba(255,255,255,0.95)', width: 1.2, cap: 'round' }
      out.push(line(E.x - 0.6, E.y - 3, E.x - 0.6, E.y + 3, sst))
      out.push(line(E.x - 3.6, E.y, E.x + 2.4, E.y, sst))
    }
  }

  // --- nose (at the muzzle tip) ---
  const bird = sp.muzzle === 'beak'
  if (!bird && sp.muzzle !== 'snout') {
    out.push(cir(92, 46, 2.2, sp.nose))
  }

  // --- mouth ---
  if (!opts.yawning) {
    const st: Stroke = { color: MOUTH, width: 1.6, cap: 'round' }
    if (expr === 'love') {
      out.push(
        path(
          [
            { t: 'M', x: 86, y: 50 },
            { t: 'Q', cx: 90, cy: 55, x: 94, y: 50 },
            { t: 'Q', cx: 90, cy: 52, x: 86, y: 50 }
          ],
          MOUTH
        )
      )
    } else if (expr === 'angry') {
      out.push(
        path([{ t: 'M', x: 87, y: 52 }, { t: 'Q', cx: 90, cy: 49, x: 93, y: 52 }], undefined, st, false)
      )
    } else if (expr === 'grumpy') {
      // Sulky down-tug (mirrors the front pout).
      out.push(
        path([{ t: 'M', x: 86, y: 52 }, { t: 'Q', cx: 90, cy: 49.5, x: 94, y: 52 }], undefined, st, false)
      )
    } else {
      const dy = expr === 'happy' || expr === 'excited' ? 4 : expr === 'chill' ? 3.2 : 2.5
      out.push(
        path([{ t: 'M', x: 86, y: 50 }, { t: 'Q', cx: 90, cy: 50 + dy, x: 94, y: 50 }], undefined, st, false)
      )
    }
  } else {
    out.push(ell(91, 51, 3, 3.4, MOUTH))
  }

  // --- whiskers (sweep forward off the muzzle) ---
  if (sp.whiskers && !opts.yawning) {
    const w: Stroke = { color: WHISKER, width: 1, cap: 'round' }
    out.push(line(88, 45, 99, 41, w))
    out.push(line(88, 48, 99, 49, w))
  }

  // --- cheek blush ---
  if (sp.cheeks || expr === 'happy' || expr === 'love' || expr === 'excited' || expr === 'grumpy') {
    const strong = expr === 'love' || expr === 'excited' || (sp.cheeks && expr !== 'angry' && expr !== 'grumpy')
    const rx = sp.cheeks ? 5 : expr === 'grumpy' ? 4.4 : 3.6
    const ry = sp.cheeks ? 3.6 : expr === 'grumpy' ? 3 : 2.4
    out.push(ell(82, 45, rx, ry, strong ? BLUSH : 'rgba(240,150,165,0.4)'))
  }

  if (expr === 'angry') pushAngerVein(out, opts.angerPulse ?? 0.9)
  return out
}

// --- bird profile (penguin, chick): upright egg, side beak, two feet ---------
// Birds are bipedal, so there's no quadruped gait — the canvas rocks the whole
// body into a waddle instead. We emit the two feet as legNearFront/legFarFront
// so the same gait plumbing can nudge them, but the read comes from the rock.
function buildBirdProfile(sp: SpeciesDef, opts: ModelOptions, OL: Stroke): CompanionModel {
  const p = sp.palette
  const accent = sp.accent ?? '#F5A623'
  const foot = (x: number, near: boolean): Prim[] => [
    path(
      [
        { t: 'M', x: x - 5, y: 90 },
        { t: 'Q', cx: x + 2, cy: 88, x: x + 6, y: 90 },
        { t: 'Q', cx: x + 2, cy: 94, x: x - 5, y: 90 }
      ],
      near ? accent : p.furDark,
      OL
    )
  ]
  const expr = opts.expr
  const openEyes = expr === 'neutral' || expr === 'happy' || expr === 'surprised'
  const closed = !!opts.blink && openEyes ? true : opts.yawning || expr === 'sleepy'
  const eye: Prim[] = closed
    ? [
        {
          k: 'path',
          d: [
            { t: 'M', x: 56, y: 34 },
            { t: 'Q', cx: 60, cy: 37, x: 64, y: 34 }
          ],
          closed: false,
          stroke: { color: EYE, width: 2, cap: 'round' }
        }
      ]
    : [cir(60, 33, 4.4, EYE), cir(58.7, 31.7, 1.7, HI)]

  return [
    { id: 'shadow', prims: [ell(48, 94, 22, 5, 'rgba(30,22,14,0.15)')] },
    {
      id: 'legFarFront',
      prims: foot(43, false),
      anchor: { x: 43, y: 84 }
    },
    {
      id: 'legNearFront',
      prims: foot(53, true),
      anchor: { x: 53, y: 84 }
    },
    {
      id: 'body',
      prims: [
        // Upright egg body, tilted a hair forward in the walk direction.
        ell(47, 60, 20, 27, p.fur, OL, 0.06),
        // Pale front / belly plate (penguin) — chick is all one colour.
        ...(sp.markings === 'penguin' ? [ell(52, 64, 13, 22, p.cream)] : []),
        // Near flipper on the body side.
        ell(33, 60, 5.5, 15, p.furDark, OL, 0.25)
      ]
    },
    {
      id: 'head',
      prims: [
        cir(54, 30, 15, p.fur, OL),
        ...(sp.markings === 'penguin' ? [ell(58, 33, 11, 12, p.cream)] : []),
        // Beak points to the right (direction of travel).
        path(
          [
            { t: 'M', x: 68, y: 30 },
            { t: 'Q', cx: 78, cy: 33, x: 68, y: 37 },
            { t: 'Q', cx: 66, cy: 33, x: 68, y: 30 }
          ],
          accent,
          OL
        )
      ]
    },
    { id: 'face', prims: eye }
  ]
}

// --- frog profile: low crouch, eyes bulging on top, four short splayed legs ---
function buildFrogProfile(sp: SpeciesDef, opts: ModelOptions, OL: Stroke): CompanionModel {
  const p = sp.palette
  const shortLeg = (x: number, near: boolean): Prim[] => buildProfileLeg(sp, x, near, 88)
  const expr = opts.expr
  const openEyes = expr === 'neutral' || expr === 'happy' || expr === 'surprised'
  const closed = (!!opts.blink && openEyes) || opts.yawning || expr === 'sleepy'

  return [
    { id: 'shadow', prims: [ell(48, 94, 26, 5, 'rgba(30,22,14,0.15)')] },
    {
      id: 'legFarBack',
      prims: shortLeg(24, false),
      anchor: { x: 24, y: 74 }
    },
    {
      id: 'legFarFront',
      prims: shortLeg(66, false),
      anchor: { x: 66, y: 74 }
    },
    {
      id: 'body',
      prims: [
        // Wide, low crouch.
        ell(48, 73, 30, 13, p.fur, OL),
        ell(52, 76, 20, 8, sp.bellyColor ?? p.cream)
      ]
    },
    {
      id: 'legNearBack',
      prims: shortLeg(30, true),
      anchor: { x: 30, y: 74 }
    },
    {
      id: 'legNearFront',
      prims: shortLeg(70, true),
      anchor: { x: 70, y: 74 }
    },
    {
      id: 'head',
      prims: [
        // Head is the front of the body; a pair of eye-bulge domes on top.
        cir(64, 58, 11, p.fur, OL),
        cir(70, 50, 9, p.fur, OL)
      ]
    },
    {
      id: 'face',
      prims: (() => {
        const out: Prim[] = []
        // Big eye on the near bulge.
        out.push(cir(72, 49, 6, '#FFFFFF', OL))
        if (closed) {
          out.push(
            line(69, 49, 75, 49, { color: EYE, width: 2, cap: 'round' })
          )
        } else {
          out.push(cir(73, 49, 3.4, EYE))
          out.push(cir(71.7, 47.7, 1.4, HI))
        }
        // Wide mouth across the front.
        const st: Stroke = { color: '#3F8437', width: 2, cap: 'round' }
        const dy = expr === 'happy' || expr === 'love' ? 5 : 3
        out.push(
          path([{ t: 'M', x: 58, y: 70 }, { t: 'Q', cx: 76, cy: 70 + dy, x: 86, y: 66 }], undefined, st, false)
        )
        return out
      })()
    }
  ]
}

