import { useEffect, useRef } from 'react'
import type { Facing } from './motion'
import type { Mood } from './mood'
import type { SpritePalette } from '../../../shared/settings'
import type { SpeciesDef } from './species'
import { buildModel, buildProfileModel, type Prim, type PartId } from './spriteModel'
import { initialActivity, stepActivity, actionProgress, type ActivityState } from './activity'

// ---------------------------------------------------------------------------
// Canvas2D companion sprite — flat-vector kawaii + a lively little life.
// ---------------------------------------------------------------------------
// The art is now DATA-DRIVEN. buildModel(species, opts) (see spriteModel.ts)
// returns the character as an ordered list of PART GROUPS — shadow, tail, legs,
// body, ears, head, face — each a list of flat drawing PRIMITIVES (ellipse /
// circle / quad-path / line) laid out in a fixed 100x100 space, front-facing and
// symmetric. This component's only jobs are (1) rebuild that model each frame
// with the current expression/blink/yawn, and (2) PAINT it with flat fills +
// clean outlines, applying the animation as per-part transforms.
//
// Why flat (vs the old radial-gradient pseudo-3D): the target look is the soft,
// high-key kawaii of the reference art — flat coats, a single thin unifying
// outline, glossy eye catch-lights. That reads better at overlay sizes, recolors
// cleanly across the theme "coats", and is cheaper per frame than per-shape
// gradients. Adding an animal is a data edit in species.ts — no code here.
//
// Liveliness (Phase 3, preserved): the pet BREATHES at rest, and performs
// ambient idle actions (glance, ear-twitch, tail-flick, shake, stretch, yawn)
// chosen by the pure scheduler in activity.ts. A pet triggers a happy hop + tail
// wag; anger makes it shiver. Liveliness scales with `energy`; `reducedMotion`
// calms everything. Fur/skin come from `palette` (the theme coat), overlaid onto
// the chosen `species` morphology; facial features stay constant for a stable,
// readable expression.
//
// HYBRID ORIENTATION (walk like a real animal): there are two body plans.
//   • FRONT — the symmetric face-on plan (buildModel). Shown at rest, while
//     held, while reacting, and while pawing a notification.
//   • PROFILE — a side-on QUADRUPED (buildProfileModel) whose four legs swing in
//     a diagonal-pair gait. Shown only while actually travelling (`moving`).
// The pet turns front↔profile with a quick edge-on "turn" squish so it pivots
// instead of popping. All the new inputs (`moving`, `gesturing`, `swatNonce`)
// default to the resting front pose, so the Settings preview is unchanged.
//
// EVENT GESTURES: while reacting to a notification the pet raises a front paw
// (`gesturing`); to dismiss one it does a one-shot forward paw-SWAT (bump
// `swatNonce`) and then settles back to its natural pose.
//
// DANCE (music): while `dancing` the front pose bops — a bouncy vertical bounce,
// a side-to-side rock, a head nod and a paw tap, all on a shared beat clock. Each
// detected beat (bump `beatNonce`) fires a one-shot squash-&-stretch "pop" on top
// (same one-shot pattern as the swat). Dance eases in/out so it starts and stops
// smoothly, and is calmed by `reducedMotion` like everything else.
//
// FUTURE (kept in mind): music "dance" / webcam "peek" are just extra IdleAction
// poses — add the action in activity.ts and a transform branch here.

export interface SpriteCanvasProps {
  size: number
  facing: Facing
  /** Which face to draw. */
  expression: Mood
  /** The animal (colors + morphology). Its palette is overridden by `palette`. */
  species: SpeciesDef
  /** Fur/skin colors (from the color-theme setting; 'natural' = species' own). */
  palette: SpritePalette
  /** true while held — dangles the legs and shrinks the shadow (lifted). */
  dragging: boolean
  /** true while resting — enables breathing + ambient idle actions. */
  idle: boolean
  /** Liveliness multiplier (mood-driven). ~0.7 chill … 1 happy … ~1.3 alert. */
  energy?: number
  /** Calms all motion and disables ambient idle actions (accessibility). */
  reducedMotion?: boolean
  /** true while travelling across the screen → show the side-profile 4-leg gait. */
  moving?: boolean
  /** true while reacting to a notification → hold a front paw up (pointing). */
  gesturing?: boolean
  /** Increment this to fire a one-shot forward paw-swat (dismiss a notification). */
  swatNonce?: number
  /** true while music is playing → bop in place (front pose). */
  dancing?: boolean
  /** Increment on each detected beat to fire a one-shot squash-&-stretch pop. */
  beatNonce?: number
  /** Dance-speed multiplier from the music's tempo (1 = natural bop; >1 faster
   *  song, <1 slower). Scales ONLY the dance oscillators, so a quick song makes
   *  a quick bop and a slow one a lazy sway — breathing/idle stay mood-driven. */
  danceTempo?: number
  /** true while striking the webcam "say cheese" pose (Feature 3): forces the
   *  front pose, a sparkly grin, a raised paw (wave) + a proud little bounce. */
  posing?: boolean
  /** Increment to fire a one-shot happy "hop" — the launch-greeting bounce. It
   *  reuses the very same vertical hop a pet triggers (petAtRef), so it needs no
   *  separate animation and never depends on which face is showing. */
  hopNonce?: number
}

const TAU = Math.PI * 2

// One-shot reaction durations (seconds).
const HOP_TIME = 0.55
const WAG_TIME = 1.2
const SWAT_TIME = 0.5 // a single forward paw bat
const TURN_TIME = 0.26 // edge-on squish when turning front↔profile
const BEAT_TIME = 0.22 // one squash-&-stretch pop per detected beat
const DANCE_RATE = 6.5 // radians/sec of the bop oscillator (bouncy but not frantic)

// --- animation pivots (100x100 design space) --------------------------------
// These match the front-facing layout anchors in spriteModel.ts.
const HEAD_PIVOT = { x: 50, y: 34 } // head+ears+face turn here (look-around)
const EAR_FRONT_PIVOT = { x: 70, y: 16 } // front ear twitches here
const TAIL_PIVOT = { x: 64, y: 82 } // tail wags here
const FEET_PIVOT = { x: 50, y: 90 } // squash/stretch about the planted feet
const SWAY_PIVOT = { x: 50, y: 62 } // "held" point while dragged
const SHAKE_PIVOT = { x: 50, y: 55 } // whole-body shake
const PAW_PIVOT = { x: 62, y: 74 } // front-right leg pivots at the shoulder
const TURN_PIVOT = { x: 50, y: 62 } // vertical axis we "spin" about when turning

// Profile gait: the four leg parts, each with a fore-aft swing phase. A trot
// moves diagonal pairs together (near-front + far-back, then far-front +
// near-back), which is what reads as a believable four-legged walk.
const GAIT_RATE = 8.5
const GAIT_SWING = 0.42 // radians of fore-aft swing about the hip
const GAIT_PHASE: Record<string, number> = {
  legNearFront: 0,
  legFarBack: 0,
  legFarFront: Math.PI,
  legNearBack: Math.PI
}
// NB: each leg's hip pivot is carried on the part itself (Part.anchor, set by
// buildProfileModel) and read as `gp.anchor` in the gait loop below — that's the
// single source of truth, so there is intentionally no duplicate anchor table here.

export function SpriteCanvas({
  size,
  facing,
  expression,
  species,
  palette,
  dragging,
  idle,
  energy = 1,
  reducedMotion = false,
  moving = false,
  gesturing = false,
  swatNonce = 0,
  dancing = false,
  beatNonce = 0,
  danceTempo = 1,
  posing = false,
  hopNonce = 0
}: SpriteCanvasProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)

  // Clocks. `real` advances in wall-clock seconds (scheduler + one-shots); `osc`
  // advances scaled by energy so oscillators (bob, wag, blink) speed up with a
  // livelier mood. `lastTs` lets us derive dt from rAF timestamps.
  const realRef = useRef(0)
  const oscRef = useRef(0)
  const lastTsRef = useRef(0)

  // Ambient idle-action scheduler state (pure; stepped each frame).
  const activityRef = useRef<ActivityState>(initialActivity())

  // One-shot reaction bookkeeping.
  const prevExprRef = useRef<Mood>(expression)
  const petAtRef = useRef<number>(-999)
  // Launch-greeting "hop" one-shot: fires when hopNonce changes. It writes the
  // same petAtRef timestamp a pet does, so the welcome bounce (a little hop + a
  // happy tail wag) reuses the existing curve and needs no separate animation.
  const prevHopRef = useRef<number>(hopNonce)
  // Paw-swat one-shot: fires when swatNonce changes.
  const prevSwatRef = useRef<number>(swatNonce)
  const swatAtRef = useRef<number>(-999)
  // Beat "pop" one-shot: fires when beatNonce changes (App bumps it per beat).
  const prevBeatRef = useRef<number>(beatNonce)
  const beatAtRef = useRef<number>(-999)
  // Dance level, eased toward 0/1 so the bop lifts in and settles out smoothly.
  const danceRef = useRef<number>(0)
  // Tempo-following dance clock. A phase accumulator advanced at DANCE_RATE × an
  // eased tempo multiplier, so the bop speeds up / slows with the music. Using a
  // phase accumulator (not t × rate) means a shifting tempo estimate never pops
  // the animation — the phase stays continuous — and it decouples dance speed
  // from mood energy so the dance follows the SONG. danceTempoRef is the smoothed
  // multiplier gliding toward the incoming danceTempo prop.
  const danceClockRef = useRef<number>(0)
  const danceTempoRef = useRef<number>(1)
  // Webcam pose level, eased toward 0/1 so the "say cheese" pose lifts in and
  // settles out smoothly (mirrors danceRef).
  const poseRef = useRef<number>(0)
  // Sustained paw-raise, eased toward 0/1 so it lifts and lowers smoothly.
  const pawRaiseRef = useRef<number>(0)
  // Orientation ('front' | 'profile') + the moment we last flipped, for the turn.
  const orientRef = useRef<'front' | 'profile'>('front')
  const turnAtRef = useRef<number>(-999)

  const propsRef = useRef({
    size, facing, expression, species, palette, dragging, idle, energy, reducedMotion,
    moving, gesturing, swatNonce, dancing, beatNonce, danceTempo, posing, hopNonce
  })
  propsRef.current = {
    size, facing, expression, species, palette, dragging, idle, energy, reducedMotion,
    moving, gesturing, swatNonce, dancing, beatNonce, danceTempo, posing, hopNonce
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Bind non-null locals — TS won't carry the outer guards into the closure.
    const cnv: HTMLCanvasElement = canvas
    const c: CanvasRenderingContext2D = ctx
    let mounted = true

    function draw(ts: number): void {
      if (!mounted) return
      const {
        size, facing, expression, species, palette, dragging, idle, energy, reducedMotion,
        moving, gesturing, swatNonce, dancing, beatNonce, danceTempo, posing, hopNonce
      } = propsRef.current

      // --- time step -------------------------------------------------------
      const last = lastTsRef.current
      const dt = last === 0 ? 0 : Math.min(0.05, (ts - last) / 1000)
      lastTsRef.current = ts
      realRef.current += dt
      const e = energy > 0 ? energy : 1
      oscRef.current += dt * e
      const now = realRef.current
      const t = oscRef.current
      const motion = reducedMotion ? 0.45 : 1

      // Feature 3: while posing for the webcam, force the sparkly "say cheese!"
      // face (excited = sparkle eyes + big open grin + blush) regardless of the
      // underlying mood. Everything else draws the real mood-driven expression.
      const faceExpr: Mood = posing ? 'excited' : expression

      // --- one-shot reactions ----------------------------------------------
      if (expression !== prevExprRef.current) {
        if (expression === 'love') petAtRef.current = now
        prevExprRef.current = expression
      }
      // Launch-greeting hop: the same vertical bounce (+ tail wag) a pet triggers,
      // but fired by a nonce so it plays exactly once on startup and doesn't need
      // the love face — the welcome shows the happy face instead.
      if (hopNonce !== prevHopRef.current) {
        petAtRef.current = now
        prevHopRef.current = hopNonce
      }
      // Paw-swat fires when the nonce changes (App bumps it to dismiss a toast).
      if (swatNonce !== prevSwatRef.current) {
        swatAtRef.current = now
        prevSwatRef.current = swatNonce
      }
      const swatAge = now - swatAtRef.current
      const swatting = swatAge >= 0 && swatAge < SWAT_TIME
      const swatEnv = swatting ? Math.sin((swatAge / SWAT_TIME) * Math.PI) : 0

      // Beat "pop" fires when beatNonce changes (App bumps it on each detected
      // beat). A brief squash-&-stretch layered over the ongoing bop.
      if (beatNonce !== prevBeatRef.current) {
        beatAtRef.current = now
        prevBeatRef.current = beatNonce
      }
      const beatAge = now - beatAtRef.current
      const beatEnv = beatAge >= 0 && beatAge < BEAT_TIME ? Math.sin((beatAge / BEAT_TIME) * Math.PI) : 0

      // Dance level eases toward 1 while music plays, back to 0 when it stops, so
      // the pup starts/stops bopping smoothly instead of snapping.
      const rawDance = dancing ? 1 : 0
      danceRef.current += (rawDance - danceRef.current) * Math.min(1, dt * 6)
      const danceLevel = danceRef.current

      // Advance the tempo-adaptive dance clock (runs every frame; danceLevel gates
      // whether it shows). Ease the multiplier toward the latest tempo reading,
      // then integrate DANCE_RATE × tempo into a continuous phase `dp`. Clamp the
      // incoming value defensively so a stray reading can't run the bop wild.
      const tempoTarget = Math.max(0.4, Math.min(2.2, danceTempo > 0 ? danceTempo : 1))
      danceTempoRef.current += (tempoTarget - danceTempoRef.current) * Math.min(1, dt * 3)
      danceClockRef.current += dt * DANCE_RATE * danceTempoRef.current
      const dp = danceClockRef.current

      // Front paw eases up while pointing (gesturing), mid-swat, or posing for the
      // camera (a little wave), down otherwise.
      const rawRaise = gesturing || swatting || posing ? 1 : 0
      pawRaiseRef.current += (rawRaise - pawRaiseRef.current) * Math.min(1, dt * 8)
      const pawRaise = pawRaiseRef.current

      // Webcam pose level eases toward 1 while posing, back to 0 after — the
      // front-pose bounce + head tilt below ride on it (the face is forced to the
      // sparkly grin via faceExpr).
      const rawPose = posing ? 1 : 0
      poseRef.current += (rawPose - poseRef.current) * Math.min(1, dt * 6)
      const poseLevel = poseRef.current

      // --- orientation (hybrid) --------------------------------------------
      // Side profile only while genuinely travelling and not doing paw work,
      // dancing, or posing for the camera; everything else (rest, drag, react,
      // point, swat, dance, pose) is the front pose.
      const orient: 'front' | 'profile' =
        moving && !dragging && !gesturing && !swatting && !dancing && !posing ? 'profile' : 'front'
      if (orient !== orientRef.current) {
        turnAtRef.current = now
        orientRef.current = orient
      }
      const turnAge = now - turnAtRef.current
      const turn = turnAge >= 0 && turnAge < TURN_TIME ? Math.sin((turnAge / TURN_TIME) * Math.PI) : 0

      const resting = idle && !dragging

      // --- ambient idle-action scheduler (only bites at true rest) ---------
      activityRef.current = stepActivity(activityRef.current, dt, { resting, energy: e, reducedMotion })
      const action = activityRef.current.action
      const ap = actionProgress(activityRef.current)
      const env = action === 'idle' ? 0 : Math.sin(ap * Math.PI)

      // --- device-pixel-ratio sizing ---------------------------------------
      const dpr = window.devicePixelRatio || 1
      const px = Math.round(size * dpr)
      if (cnv.width !== px || cnv.height !== px) {
        cnv.width = px
        cnv.height = px
      }

      c.save()
      c.clearRect(0, 0, cnv.width, cnv.height)
      c.scale(dpr, dpr)

      const s = size / 100 // design space is 100x100

      // Shared per-frame values.
      const blink = t % 3.2 < 0.13
      const angerPulse = 0.5 + Math.sin(t * 10) * 0.5
      // Overlay the chosen theme coat onto the species' morphology.
      const drawSp: SpeciesDef = { ...species, palette }

      // Pet-love hop (front only) — computed here so the shadow can react.
      const wagAge = now - petAtRef.current
      const wagging = wagAge >= 0 && wagAge < WAG_TIME
      const hop = wagAge >= 0 && wagAge < HOP_TIME ? -Math.sin((wagAge / HOP_TIME) * Math.PI) * 9 : 0

      // Flip for left-facing. Profile is built facing right, so this is what
      // makes it walk leftwards; the front body is symmetric (subtle cue only).
      if (facing === 'left') {
        c.translate(size, 0)
        c.scale(-1, 1)
      }

      // Ground shadow (un-bobbed). Profile mass sits a little left of centre.
      const shadowCx = orient === 'profile' ? 46 : 50
      drawShadow(c, s, orient === 'front' && dragging ? 0.55 : 1, orient === 'front' ? hop : 0, shadowCx)

      // Turn squish: as the pet pivots front↔profile it briefly goes edge-on.
      c.save()
      if (turn) {
        c.translate(TURN_PIVOT.x * s, TURN_PIVOT.y * s)
        c.scale(1 - turn * 0.5, 1)
        c.translate(-TURN_PIVOT.x * s, -TURN_PIVOT.y * s)
      }

      if (orient === 'profile') {
        // ---------------- SIDE-PROFILE QUADRUPED (walking) ----------------
        const model = buildProfileModel(drawSp, {
          expr: faceExpr,
          blink,
          dragging,
          yawning: false,
          yawn: 0,
          angerPulse
        })
        const bird = species.muzzle === 'beak'
        // Body rises on each beat (trot lift); birds rock side-to-side (waddle).
        const gaitBob = -Math.abs(Math.sin(t * GAIT_RATE)) * 2 * motion
        const waddle = bird ? Math.sin(t * GAIT_RATE * 0.5) * 0.06 * motion : 0

        c.save()
        c.translate(0, gaitBob * s)
        if (waddle) {
          c.translate(48 * s, 88 * s)
          c.rotate(waddle)
          c.translate(-48 * s, -88 * s)
        }

        for (const gp of model) {
          if (gp.id === 'shadow') continue // drawn separately above
          if (gp.id.startsWith('leg') && gp.anchor) {
            // Swing the leg fore-aft about its hip; diagonal pairs share a phase.
            const phase = GAIT_PHASE[gp.id] ?? 0
            const rot = Math.sin(t * GAIT_RATE + phase) * GAIT_SWING * motion
            c.save()
            pivot(c, gp.anchor, s, rot)
            paint(c, gp.prims, s)
            c.restore()
          } else if (gp.id === 'tail' && gp.anchor) {
            c.save()
            pivot(c, gp.anchor, s, Math.sin(t * GAIT_RATE * 0.5) * 0.12 * motion)
            paint(c, gp.prims, s)
            c.restore()
          } else {
            paint(c, gp.prims, s)
          }
        }
        c.restore() // gaitBob / waddle
      } else {
        // ---------------- FRONT-FACING (rest / drag / react / paw) --------
        // No walk cycle here — travel is the profile plan. This pose breathes,
        // performs ambient idle actions, reacts, and does the paw work.
        const bob = dragging ? 0 : Math.sin(t * 2.4) * 0.9 * motion
        const breathY = dragging ? 0 : Math.sin(t * 2.4) * 0.02 * motion

        // --- dance (music) ---------------------------------------------------
        // A bouncy front-pose bop while `dancing`, all sharing one tempo-driven
        // phase `dp` (advanced at DANCE_RATE × the eased music tempo above), so a
        // fast song makes a fast bop and a slow one a lazy sway. danceLevel eases
        // 0↔1 (fade in/out); beatEnv pops on each detected beat.
        const danceBob = danceLevel * Math.sin(dp) * 5 * motion // vertical bounce
        const danceSwayX = danceLevel * Math.sin(dp * 0.5) * 2 * motion // shimmy L/R
        const danceTilt = danceLevel * Math.sin(dp * 0.5) * 0.14 * motion // rock on feet
        const danceHeadBob = danceLevel * Math.sin(dp + 0.6) * 0.13 * motion // head nod
        const dancePaw = danceLevel * Math.max(0, Math.sin(dp)) * 7 * motion // paw tap
        const beatStretch = beatEnv * danceLevel * 0.14 * motion // per-beat squash&stretch

        // Curious cocks its head to one side — a steady inquisitive tilt with a
        // slow drift (headYaw is a roll about HEAD_PIVOT, so this reads as a
        // head-tilt, pairing with the quizzical brow + wide eyes + "oh?" mouth).
        const curiousTilt = faceExpr === 'curious' ? (0.14 + Math.sin(t * 1.5) * 0.03) * motion : 0
        // Feature 3: proud little chest-up bounce + coquettish head tilt while
        // posing for the camera (rides the eased poseLevel; the paw is already up
        // via rawRaise and the face is the forced sparkly grin). The lift reads as
        // "ta-da!", the slow sine as a gentle sway for the shot.
        const poseLift = poseLevel * (-2.2 + Math.sin(t * 3) * 1.4) * motion
        const poseTilt = poseLevel * (0.12 + Math.sin(t * 1.6) * 0.04) * motion
        const headYaw =
          (action === 'lookAround' ? Math.sin(ap * Math.PI * 2) * 0.2 * motion : 0) +
          danceHeadBob +
          curiousTilt +
          poseTilt
        const earTwitch = action === 'earTwitch' ? Math.sin(ap * Math.PI * 6) * env * 0.5 * motion : 0
        const shakeRot = action === 'shake' ? Math.sin(ap * Math.PI * 11) * env * 0.09 * motion : 0
        const shakeX = action === 'shake' ? Math.sin(ap * Math.PI * 11) * env * 1.3 * motion : 0
        const stretchX = action === 'stretch' ? env * 0.16 * motion : 0
        const stretchY = action === 'stretch' ? -env * 0.1 * motion : 0
        const stretchDip = action === 'stretch' ? env * 3 * motion : 0
        const yawnLift = action === 'yawn' ? -env * 2 * motion : 0

        const flick = action === 'tailFlick' ? env : 0
        const wagBase = Math.sin(t * 2)
        const wagBoost = 1 + (flick + (wagging ? 1 : 0)) * 1.4
        const wagFast = (flick + (wagging ? 0.6 : 0)) * Math.sin(t * 22) * 0.5
        const wag = wagBase * wagBoost * motion + wagFast

        const shiver = faceExpr === 'angry' ? Math.sin(t * 26) * 1.3 * motion : 0
        const sway = dragging ? Math.sin(t * 2.4) * 0.08 : 0
        const dangle = dragging ? 4 : 0

        const yawning =
          action === 'yawn' &&
          (faceExpr === 'neutral' || faceExpr === 'happy' || faceExpr === 'sleepy')
        const model = buildModel(drawSp, {
          expr: faceExpr,
          blink,
          dragging,
          yawning,
          yawn: env,
          angerPulse
        })
        const part: Partial<Record<PartId, Prim[]>> = {}
        for (const gp of model) part[gp.id] = gp.prims

        // Front-right paw: rises while pointing, and on a swat drives up-and-FORWARD
        // in a big, clearly visible bat at the toast's X (bigger reach + lift, less
        // downward drop than before so the raised paw stays readable). Also taps
        // up/down to the beat while dancing. The peak reach lands the foot at ~
        // (0.82, 0.80) of the sprite box — matched by PAW_CONTACT_F* in motion.ts so
        // the paw tip meets the close button.
        const pawLift = (pawRaise * 13 + swatEnv * 6) * motion + dancePaw
        const pawFwd = (pawRaise * 3 + swatEnv * 18) * motion
        const pawDrop = swatEnv * 2 * motion
        const pawRot = (-pawRaise * 0.55 + swatEnv * 0.95) * motion

        c.save()
        c.translate(
          (shiver + shakeX + danceSwayX) * s,
          (bob + hop + stretchDip + yawnLift + danceBob + poseLift) * s
        )
        if (sway) pivot(c, SWAY_PIVOT, s, sway)
        if (shakeRot) pivot(c, SHAKE_PIVOT, s, shakeRot)
        if (danceTilt) pivot(c, FEET_PIVOT, s, danceTilt)
        const sx = 1 + stretchX - beatStretch * 0.5
        const sy = 1 + stretchY + breathY + beatStretch
        if (sx !== 1 || sy !== 1) {
          c.translate(FEET_PIVOT.x * s, FEET_PIVOT.y * s)
          c.scale(sx, sy)
          c.translate(-FEET_PIVOT.x * s, -FEET_PIVOT.y * s)
        }

        c.save()
        pivot(c, TAIL_PIVOT, s, wag * 0.12)
        paint(c, part.tail, s)
        c.restore()

        c.save()
        c.translate(0, dangle * s)
        paint(c, part.legBack, s)
        c.restore()

        // Front leg carries the paw gesture: rotate at the shoulder, then lift
        // and reach. Reduces to the plain resting leg when pawRaise/swat are 0.
        c.save()
        pivot(c, PAW_PIVOT, s, pawRot)
        c.translate(pawFwd * s, (dangle - pawLift + pawDrop) * s)
        paint(c, part.legFront, s)
        c.restore()

        paint(c, part.body, s)

        c.save()
        if (headYaw) pivot(c, HEAD_PIVOT, s, headYaw)
        paint(c, part.earBack, s)
        c.save()
        if (earTwitch) pivot(c, EAR_FRONT_PIVOT, s, earTwitch)
        paint(c, part.earFront, s)
        c.restore()
        paint(c, part.head, s)
        paint(c, part.face, s)
        c.restore()

        c.restore() // body group
      }

      c.restore() // turn squish
      c.restore() // dpr + facing

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => {
      mounted = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, display: 'block', pointerEvents: 'none' }}
    />
  )
}

// ---------------------------------------------------------------------------
// Flat primitive painter (design coordinates: 100x100, origin top-left, y down).
// ---------------------------------------------------------------------------

/** Rotate the context about a design-space pivot (scaled by s). */
function pivot(c: CanvasRenderingContext2D, p: { x: number; y: number }, s: number, ang: number): void {
  c.translate(p.x * s, p.y * s)
  c.rotate(ang)
  c.translate(-p.x * s, -p.y * s)
}

/** Paint one part group's primitives (fill then outline), each in 100-space × s. */
function paint(c: CanvasRenderingContext2D, prims: Prim[] | undefined, s: number): void {
  if (!prims) return
  for (const pr of prims) {
    c.beginPath()
    switch (pr.k) {
      case 'ellipse':
        // Canvas ellipse takes rotation natively — same convention as the SVG
        // preview's rotate(), so in-app and offline art match.
        c.ellipse(pr.cx * s, pr.cy * s, pr.rx * s, pr.ry * s, pr.rot ?? 0, 0, TAU)
        break
      case 'circle':
        c.arc(pr.cx * s, pr.cy * s, pr.r * s, 0, TAU)
        break
      case 'line':
        c.moveTo(pr.x1 * s, pr.y1 * s)
        c.lineTo(pr.x2 * s, pr.y2 * s)
        break
      case 'path':
        for (const seg of pr.d) {
          if (seg.t === 'M') c.moveTo(seg.x * s, seg.y * s)
          else if (seg.t === 'L') c.lineTo(seg.x * s, seg.y * s)
          else c.quadraticCurveTo(seg.cx * s, seg.cy * s, seg.x * s, seg.y * s)
        }
        if (pr.closed) c.closePath()
        break
    }
    const fill = 'fill' in pr ? pr.fill : undefined
    if (fill) {
      c.fillStyle = fill
      c.fill()
    }
    const stroke = pr.stroke
    if (stroke) {
      c.lineWidth = stroke.width * s
      c.strokeStyle = stroke.color
      c.lineCap = stroke.cap ?? 'round'
      c.lineJoin = 'round'
      c.stroke()
    }
  }
}

/** Soft ground shadow. Kept flat to match the art, but responds to lift/drag:
 *  it shrinks + fades as the pet hops up, and is smaller when held. `cx` lets
 *  the profile pose sit its shadow under the (off-centre) body mass. */
function drawShadow(
  c: CanvasRenderingContext2D,
  s: number,
  scale: number,
  hop: number,
  cx = 50
): void {
  const lift = Math.max(0, -hop) / 9
  const x = cx * s
  const cy = 94 * s
  const rx = 24 * s * scale * (1 - lift * 0.25)
  const ry = 5 * s * scale * (1 - lift * 0.2)
  c.save()
  c.globalAlpha = 1 - lift * 0.4
  c.beginPath()
  c.ellipse(x, cy, rx, ry, 0, 0, TAU)
  c.fillStyle = 'rgba(30,22,14,0.16)'
  c.fill()
  c.restore()
}
