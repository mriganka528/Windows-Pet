// ---------------------------------------------------------------------------
// Companion behavior state machine (XState v5).
// ---------------------------------------------------------------------------
// States: idle <-> wander, plus dragging (+ a brief landing beat), the Phase-5
// notification-reaction flow (alert -> travel -> interact), a music-driven
// `dance`, and the Feature-3 webcam pose flow (webcamTravel -> posing).
//
//   idle    — resting on the ground line; after a pause, picks a target -> wander
//   wander  — walking toward `target`; on arrival -> idle
//   dragging— following the cursor (position driven by DRAG_MOVE); on DROP ->
//             landing
//   landing — short "recover" beat after being dropped -> idle
//   alert   — a toast just appeared: a brief "notice" beat (ears up / "!") before
//             trotting over -> travel
//   travel  — DASHING (faster than wander) to the spot beside the toast; on
//             arrival -> interact
//   interact— the "nudge": hold beside the toast being agitated until it closes
//             (NOTIFICATION_CLOSED) or a safety timeout elapses -> idle
//   dance   — music is playing: bop in place (the sprite animates itself) until
//             the music stops -> idle. Entered only from idle/wander so it never
//             interrupts a drag or a notification reaction; a toast appearing
//             DOES interrupt the dance (dance -> alert).
//   webcamTravel — a webcam just went live: DASH (like travel) to the top-centre
//             spot under the camera; on arrival -> posing.
//   posing  — hold a cute photogenic pose (front-on, sparkly) for a short beat,
//             then resume roaming (-> idle). A toast interrupts; the camera going
//             off ends it early. Entered from idle/wander/dance via a guarded TICK
//             on the `webcamActive` flag, so it never interrupts a drag or nudge.
//
// `musicActive` is a context flag toggled by MUSIC_START / MUSIC_STOP (the
// renderer's system-audio hook sends these on the detector's on/off edges). We
// keep it as a flag + enter `dance` from idle/wander via a guarded TICK — rather
// than making MUSIC_START jump straight to dance — so music starting mid-drag or
// mid-nudge is deferred until the pup is free, instead of yanking it away.
//
// The notification flow is entered from idle/wander/dance only (a new toast is
// ignored while dragging or already reacting, so the pup never thrashes).
// NOTIFICATION_CLOSED for the toast we're currently reacting to unwinds us
// straight back to idle from any of alert/travel/interact.
//
// The machine is pure logic: actions mutate context (position/target/facing),
// but nothing here touches the DOM. The React layer runs a requestAnimationFrame
// loop that sends TICK { dt } and feeds SET_BOUNDS / drag / notification events;
// the renderer reads context to draw. This keeps behavior testable without a browser.

import { setup, assign } from 'xstate'
import {
  clampToBounds,
  facingFromDelta,
  groundLineTop,
  pickWanderTarget,
  stepToward,
  notificationTarget,
  webcamTarget,
  DEFAULT_WANDER,
  TRAVEL_SPEED_SCALE,
  type Bounds,
  type Facing,
  type Rect,
  type Vec2,
  type WanderConfig
} from './motion'

/** The toast the companion is currently reacting to (overlay-local geometry). */
export interface NotificationTargetInfo {
  /** Stable id assigned by the watcher; matched on NOTIFICATION_CLOSED. */
  id: string
  /** Toast rectangle in overlay-local CSS px (already coordinate-converted). */
  rect: Rect
  /** Whether the toast exposes actions (reply/buttons). Carried through as
   *  metadata only: auto-close mode dismisses every toast (the user's chosen
   *  scope is "close everything"), so this does NOT gate the paw-close. */
  interactive: boolean
}

export interface CompanionContext {
  position: Vec2
  target: Vec2
  facing: Facing
  bounds: Bounds
  config: WanderConfig
  /** Seconds remaining to rest while idle before picking a new target. */
  restRemaining: number
  /** Seconds remaining in the landing recover beat. */
  landRemaining: number
  /** The toast currently being reacted to, or null when just wandering. */
  notification: NotificationTargetInfo | null
  /** Seconds remaining in the "notice" beat before trotting to the toast. */
  alertRemaining: number
  /** Seconds remaining in the nudge hold before giving up (safety timeout). */
  interactRemaining: number
  /** Whether music is currently detected (drives entering/leaving `dance`).
   *  Toggled by MUSIC_START / MUSIC_STOP from the renderer's audio hook. */
  musicActive: boolean
  /** Whether a webcam is currently in use (Feature 3). Toggled by WEBCAM_ON /
   *  WEBCAM_OFF from main's consent-store watcher. Gates entering the pose flow. */
  webcamActive: boolean
  /** True once we've done the photogenic pose for the CURRENT camera session, so
   *  we pose once on the rising edge then resume roaming instead of re-posing every
   *  idle tick while the camera stays on. Reset to false on WEBCAM_OFF. */
  posedThisSession: boolean
  /** Seconds remaining in the "hold the pose" beat before resuming normal roaming. */
  poseRemaining: number
}

export type CompanionEvent =
  | { type: 'TICK'; dt: number }
  | { type: 'SET_BOUNDS'; bounds: Bounds }
  | { type: 'SET_CONFIG'; config: WanderConfig }
  | { type: 'PICK_UP' }
  | { type: 'DRAG_MOVE'; position: Vec2 }
  | { type: 'DROP' }
  | { type: 'NOTIFICATION_APPEARED'; id: string; rect: Rect; interactive: boolean }
  | { type: 'NOTIFICATION_CLOSED'; id: string }
  | { type: 'MUSIC_START' }
  | { type: 'MUSIC_STOP' }
  | { type: 'WEBCAM_ON' }
  | { type: 'WEBCAM_OFF' }

export interface CompanionInput {
  bounds: Bounds
  config?: WanderConfig
  position?: Vec2
}

const REST_MIN = 0.8
const REST_MAX = 2.6
const LANDING_TIME = 0.35
// The "notice" beat: how long the pup reacts in place (perk up / "!") before it
// trots over to the toast. Short so it feels responsive but readable.
const ALERT_TIME = 0.45
// Safety cap on the nudge hold. A toast normally closes within a few seconds and
// we unwind on NOTIFICATION_CLOSED; this only fires if that event never arrives
// (e.g. the toast lingers or the close was missed) so the pup can't get stuck.
const INTERACT_MAX = 8
// How long the pet holds its photogenic pose under the camera before resuming
// normal roaming. A few seconds: long enough to read as "posing for the shot",
// short enough not to feel stuck (the user asked for "pose briefly, then resume").
const POSE_TIME = 3.2

function initialContext(input: CompanionInput): CompanionContext {
  const config = input.config ?? DEFAULT_WANDER
  const bounds = input.bounds
  const ground = groundLineTop(bounds, config)
  const position = input.position ?? { x: Math.round(bounds.width / 2), y: ground }
  return {
    position: clampToBounds(position, bounds, config),
    target: { ...position },
    facing: 'right',
    bounds,
    config,
    restRemaining: REST_MIN,
    landRemaining: 0,
    notification: null,
    alertRemaining: 0,
    interactRemaining: 0,
    musicActive: false,
    webcamActive: false,
    posedThisSession: false,
    poseRemaining: 0
  }
}

export const companionMachine = setup({
  types: {
    context: {} as CompanionContext,
    events: {} as CompanionEvent,
    input: {} as CompanionInput
  },
  actions: {
    updateBounds: assign(({ context, event }) => {
      if (event.type !== 'SET_BOUNDS') return {}
      return {
        bounds: event.bounds,
        position: clampToBounds(context.position, event.bounds, context.config)
      }
    }),
    // Live size / motion change from Settings. Additive (like updateBounds) so
    // the tested idle/wander/drag flow is untouched. Snap to the (new) ground
    // line and retarget in place so a resize can't leave a stale off-screen
    // target or a mid-air body.
    updateConfig: assign(({ context, event }) => {
      if (event.type !== 'SET_CONFIG') return {}
      const config = event.config
      const grounded = { x: context.position.x, y: groundLineTop(context.bounds, config) }
      const position = clampToBounds(grounded, context.bounds, config)
      return { config, position, target: { ...position } }
    }),
    // Advance the rest timer while idle.
    tickRest: assign(({ context, event }) => {
      if (event.type !== 'TICK') return {}
      return { restRemaining: Math.max(0, context.restRemaining - event.dt) }
    }),
    // Pick a fresh wander target and reset facing toward it.
    chooseTarget: assign(({ context }) => {
      const target = pickWanderTarget(context.bounds, context.config)
      return {
        target,
        facing: facingFromDelta(target.x - context.position.x, context.facing)
      }
    }),
    // Move toward the target during wander.
    tickWander: assign(({ context, event }) => {
      if (event.type !== 'TICK') return {}
      const r = stepToward(context.position, context.target, context.config, event.dt, context.facing)
      return { position: r.pos, facing: r.facing }
    }),
    // Move toward the target during a notification dash — same stepper, but at
    // TRAVEL_SPEED_SCALE× so the pup visibly RUNS to the toast (the user's
    // request) instead of ambling at wander speed. Distinct action (not a param
    // on tickWander) so the wander path stays byte-for-byte the tested one.
    tickTravel: assign(({ context, event }) => {
      if (event.type !== 'TICK') return {}
      const r = stepToward(
        context.position,
        context.target,
        context.config,
        event.dt,
        context.facing,
        TRAVEL_SPEED_SCALE
      )
      return { position: r.pos, facing: r.facing }
    }),
    // While dragging, position is dictated by the cursor.
    applyDrag: assign(({ context, event }) => {
      if (event.type !== 'DRAG_MOVE') return {}
      const clamped = clampToBounds(event.position, context.bounds, context.config)
      return {
        position: clamped,
        facing: facingFromDelta(clamped.x - context.position.x, context.facing)
      }
    }),
    // On drop, the companion STAYS where it was dropped (the user repositioned
    // it deliberately — exit criterion: "reposition it anywhere on screen").
    // Landing is just a brief in-place recover beat; target = current position
    // so the subsequent wander starts fresh from here.
    beginLanding: assign(({ context }) => ({
      landRemaining: LANDING_TIME,
      target: { ...context.position }
    })),
    tickLanding: assign(({ context, event }) => {
      if (event.type !== 'TICK') return {}
      // Just count down the recover beat; position holds where it was dropped.
      return {
        landRemaining: Math.max(0, context.landRemaining - event.dt)
      }
    }),
    resetRest: assign(() => ({
      restRemaining: REST_MIN + Math.random() * (REST_MAX - REST_MIN)
    })),
    // A toast appeared: remember it, aim at its close (X) button, face that way,
    // and start the brief "notice" beat. Coordinate conversion (screen px ->
    // overlay-local px) already happened upstream, so event.rect is overlay-local.
    beginAlert: assign(({ context, event }) => {
      if (event.type !== 'NOTIFICATION_APPEARED') return {}
      const target = notificationTarget(event.rect, context.bounds, context.config)
      return {
        notification: { id: event.id, rect: event.rect, interactive: event.interactive },
        target,
        facing: facingFromDelta(target.x - context.position.x, context.facing),
        alertRemaining: ALERT_TIME
      }
    }),
    tickAlert: assign(({ context, event }) => {
      if (event.type !== 'TICK') return {}
      return { alertRemaining: Math.max(0, context.alertRemaining - event.dt) }
    }),
    // Arrived at the toast's close button — start the nudge hold (safety-capped
    // countdown) and force facing 'right' so the front-pose swat reaches into the
    // toast's TOP-RIGHT corner (the X) no matter which side we approached from.
    // notificationTarget always parks the body up-and-left of the X, so 'right' is
    // always the correct way to face; the front<->profile turn-squish masks the
    // flip on arrival.
    beginInteract: assign(() => ({ interactRemaining: INTERACT_MAX, facing: 'right' as const })),
    tickInteract: assign(({ context, event }) => {
      if (event.type !== 'TICK') return {}
      return { interactRemaining: Math.max(0, context.interactRemaining - event.dt) }
    }),
    // Forget the current toast (on close, timeout, or pick-up).
    clearNotification: assign(() => ({ notification: null })),
    // Music on/off flag (from the renderer's audio detector edges). Entering the
    // dance itself is left to the guarded TICK in idle/wander, so this only ever
    // sets a flag — never forces a state change out of a drag/notification flow.
    musicOn: assign(() => ({ musicActive: true })),
    musicOff: assign(() => ({ musicActive: false })),
    // Webcam in-use edges from main's consent-store watcher (Feature 3). Like the
    // music flags these only set state; the hop into the pose flow is a guarded
    // TICK in idle/wander/dance, so a camera turning on mid-drag / mid-nudge is
    // deferred until the pet is free rather than yanking it away. Turning the
    // camera OFF also clears posedThisSession so the NEXT camera session re-poses.
    webcamOn: assign(() => ({ webcamActive: true })),
    webcamOff: assign(() => ({ webcamActive: false, posedThisSession: false })),
    // Aim for the top-centre spot under the camera and face that way, then the
    // FAST stepper (tickTravel) scurries us up there — same urgent dash as a toast.
    beginWebcamTravel: assign(({ context }) => {
      const target = webcamTarget(context.bounds, context.config)
      return {
        target,
        facing: facingFromDelta(target.x - context.position.x, context.facing)
      }
    }),
    // Arrived under the camera: start the "hold the pose" beat.
    beginPose: assign(() => ({ poseRemaining: POSE_TIME })),
    tickPose: assign(({ context, event }) => {
      if (event.type !== 'TICK') return {}
      return { poseRemaining: Math.max(0, context.poseRemaining - event.dt) }
    }),
    // Pose done: mark this camera session as posed so we resume roaming instead of
    // re-posing every idle tick while the camera is still on.
    finishPose: assign(() => ({ posedThisSession: true }))
  },
  guards: {
    restDone: ({ context }) => context.restRemaining <= 0,
    arrived: ({ context }) => {
      const dx = context.target.x - context.position.x
      const dy = context.target.y - context.position.y
      return Math.hypot(dx, dy) < 0.5
    },
    landingDone: ({ context }) => context.landRemaining <= 0,
    alertDone: ({ context }) => context.alertRemaining <= 0,
    interactDone: ({ context }) => context.interactRemaining <= 0,
    // True when the closing toast is the one we're actually reacting to. Lets a
    // single root-level NOTIFICATION_CLOSED handler unwind alert/travel/interact
    // while stale ids (or closes that arrive when we're just wandering) are ignored.
    closingCurrent: ({ context, event }) =>
      event.type === 'NOTIFICATION_CLOSED' && context.notification?.id === event.id,
    musicActive: ({ context }) => context.musicActive,
    notMusicActive: ({ context }) => !context.musicActive,
    // Enter the pose flow only on the rising edge of a camera session: the camera
    // is on AND we haven't already posed for it. posedThisSession latches after one
    // pose (reset on WEBCAM_OFF) so we don't loop the pose while the camera stays on.
    wantsPose: ({ context }) => context.webcamActive && !context.posedThisSession,
    poseDone: ({ context }) => context.poseRemaining <= 0
  }
}).createMachine({
  id: 'companion',
  context: ({ input }) => initialContext(input),
  // Dragging can begin from anywhere. A close for the toast we're reacting to
  // also unwinds us from anywhere (guard makes it a no-op otherwise).
  on: {
    SET_BOUNDS: { actions: 'updateBounds' },
    SET_CONFIG: { actions: 'updateConfig' },
    PICK_UP: { target: '.dragging', actions: 'clearNotification' },
    NOTIFICATION_CLOSED: { guard: 'closingCurrent', target: '.idle', actions: 'clearNotification' },
    // Music on/off just flip the flag from any state; the actual hop into/out of
    // `dance` is handled by the guarded TICK in idle/wander/dance, so we never
    // interrupt a drag or a notification reaction mid-flow.
    MUSIC_START: { actions: 'musicOn' },
    MUSIC_STOP: { actions: 'musicOff' },
    // Webcam on/off flip a flag from any state (like music); entering the pose is
    // a guarded TICK in idle/wander/dance so a drag or notification reaction is
    // never interrupted. The webcamTravel/posing states add their own WEBCAM_OFF
    // handler (to also unwind to idle), which overrides this one there.
    WEBCAM_ON: { actions: 'webcamOn' },
    WEBCAM_OFF: { actions: 'webcamOff' }
  },
  initial: 'idle',
  states: {
    idle: {
      entry: 'resetRest',
      on: {
        TICK: [
          { guard: 'wantsPose', target: 'webcamTravel', actions: 'beginWebcamTravel' },
          { guard: 'musicActive', target: 'dance' },
          { guard: 'restDone', target: 'wander', actions: 'chooseTarget' },
          { actions: 'tickRest' }
        ],
        NOTIFICATION_APPEARED: { target: 'alert', actions: 'beginAlert' }
      }
    },
    wander: {
      on: {
        TICK: [
          { guard: 'wantsPose', target: 'webcamTravel', actions: 'beginWebcamTravel' },
          { guard: 'musicActive', target: 'dance' },
          { guard: 'arrived', target: 'idle' },
          { actions: 'tickWander' }
        ],
        NOTIFICATION_APPEARED: { target: 'alert', actions: 'beginAlert' }
      }
    },
    dragging: {
      on: {
        DRAG_MOVE: { actions: 'applyDrag' },
        DROP: { target: 'landing', actions: 'beginLanding' },
        // Ignore toast appearances while the user is actively holding the pup —
        // the App also gates this, but the explicit no-op keeps the machine
        // correct on its own (never yank the sprite out of the user's hand).
        NOTIFICATION_APPEARED: {}
      }
    },
    landing: {
      on: {
        TICK: [
          { guard: 'landingDone', target: 'idle' },
          { actions: 'tickLanding' }
        ]
      }
    },
    // A toast appeared: react in place for a beat, then trot over.
    alert: {
      on: {
        TICK: [
          { guard: 'alertDone', target: 'travel' },
          { actions: 'tickAlert' }
        ]
      }
    },
    // Walk to the spot beside the toast. Uses the FAST stepper (tickTravel) so
    // the pup dashes over at TRAVEL_SPEED_SCALE× wander speed, then hands off to
    // the paw-swat in `interact` on arrival.
    travel: {
      on: {
        TICK: [
          { guard: 'arrived', target: 'interact', actions: 'beginInteract' },
          { actions: 'tickTravel' }
        ]
      }
    },
    // The nudge: hold beside the toast until it closes (root NOTIFICATION_CLOSED)
    // or the safety timeout elapses.
    interact: {
      on: {
        TICK: [
          { guard: 'interactDone', target: 'idle', actions: 'clearNotification' },
          { actions: 'tickInteract' }
        ]
      }
    },
    // Music is playing: bop in place. The sprite drives the actual dance
    // animation on its own rAF (from the `dancing` prop), so there's no position
    // math here — we just hold this state until the music stops. A toast still
    // wins: NOTIFICATION_APPEARED interrupts the dance and runs the reaction
    // (afterwards we return to idle, and if the music is still going the guarded
    // idle TICK drops us right back into dance).
    dance: {
      on: {
        TICK: [
          { guard: 'wantsPose', target: 'webcamTravel', actions: 'beginWebcamTravel' },
          { guard: 'notMusicActive', target: 'idle' }
        ],
        NOTIFICATION_APPEARED: { target: 'alert', actions: 'beginAlert' }
      }
    },
    // Feature 3: a webcam went live. Scurry (fast, like a toast dash) to the
    // top-centre spot under the camera; on arrival, strike the pose. A toast still
    // wins (NOTIFICATION_APPEARED -> alert); the camera turning back off unwinds us.
    webcamTravel: {
      on: {
        TICK: [
          { guard: 'arrived', target: 'posing', actions: 'beginPose' },
          { actions: 'tickTravel' }
        ],
        NOTIFICATION_APPEARED: { target: 'alert', actions: 'beginAlert' },
        WEBCAM_OFF: { target: 'idle', actions: 'webcamOff' }
      }
    },
    // Hold a cute photogenic pose for a beat (the sprite forces a front pose +
    // sparkly expression from the `posing` prop), then resume roaming — even if the
    // camera stays on (posedThisSession latches so we don't re-pose until it cycles
    // off/on). A toast interrupts; the camera turning off ends the pose early.
    posing: {
      on: {
        TICK: [
          { guard: 'poseDone', target: 'idle', actions: 'finishPose' },
          { actions: 'tickPose' }
        ],
        NOTIFICATION_APPEARED: { target: 'alert', actions: 'beginAlert' },
        WEBCAM_OFF: { target: 'idle', actions: 'webcamOff' }
      }
    }
  }
})
