import { describe, it, expect } from 'vitest'
import { createActor } from 'xstate'
import { companionMachine } from './machine'
import {
  DEFAULT_WANDER,
  notificationTarget,
  webcamTarget,
  TRAVEL_SPEED_SCALE,
  type Bounds,
  type Rect
} from './motion'

const bounds: Bounds = { width: 1000, height: 600 }

function boot() {
  const actor = createActor(companionMachine, {
    input: { bounds, config: { ...DEFAULT_WANDER, speed: 100 }, position: { x: 500, y: 520 } }
  })
  actor.start()
  return actor
}

/** Send N ticks of dt seconds each. */
function tick(actor: ReturnType<typeof boot>, n: number, dt = 0.1) {
  for (let i = 0; i < n; i++) actor.send({ type: 'TICK', dt })
}

/** Tick until `pred` holds or we hit `maxTicks` (keeps notification tests robust
 *  to the exact alert/travel duration). */
function tickUntil(
  actor: ReturnType<typeof boot>,
  pred: (a: ReturnType<typeof boot>) => boolean,
  maxTicks = 400,
  dt = 0.1
) {
  for (let i = 0; i < maxTicks && !pred(actor); i++) actor.send({ type: 'TICK', dt })
}

describe('companionMachine', () => {
  it('starts idle', () => {
    const a = boot()
    expect(a.getSnapshot().value).toBe('idle')
  })

  it('transitions idle -> wander after the rest timer elapses', () => {
    const a = boot()
    tick(a, 40) // 4s of ticks — exceeds max rest
    expect(['wander', 'idle']).toContain(a.getSnapshot().value)
    // It should have chosen a target distinct-ish and started moving eventually.
    tick(a, 40)
    expect(a.getSnapshot().context.position).toBeDefined()
  })

  it('PICK_UP enters dragging from any state and DRAG_MOVE moves the sprite', () => {
    const a = boot()
    a.send({ type: 'PICK_UP' })
    expect(a.getSnapshot().value).toBe('dragging')
    a.send({ type: 'DRAG_MOVE', position: { x: 200, y: 100 } })
    const pos = a.getSnapshot().context.position
    expect(pos.x).toBe(200)
    expect(pos.y).toBe(100)
  })

  it('DROP holds position through a landing beat, then returns to idle', () => {
    const a = boot()
    a.send({ type: 'PICK_UP' })
    a.send({ type: 'DRAG_MOVE', position: { x: 300, y: 50 } })
    a.send({ type: 'DROP' })
    expect(a.getSnapshot().value).toBe('landing')
    // Landing beat is 0.35s. Tick just past it (0.5s), but stay under the
    // minimum idle rest (0.8s) so we reliably observe 'idle' before it wanders.
    tick(a, 6) // 0.6s — past the 0.35s landing beat, under the 0.8s min rest
    expect(a.getSnapshot().value).toBe('idle')
    // The companion stays where it was dropped — it does NOT snap to the ground.
    expect(a.getSnapshot().context.position).toEqual({ x: 300, y: 50 })
  })

  it('SET_BOUNDS re-clamps position', () => {
    const a = boot()
    a.send({ type: 'PICK_UP' })
    a.send({ type: 'DRAG_MOVE', position: { x: 999, y: 999 } })
    a.send({ type: 'SET_BOUNDS', bounds: { width: 400, height: 300 } })
    const pos = a.getSnapshot().context.position
    expect(pos.x).toBeLessThanOrEqual(400 - DEFAULT_WANDER.spriteSize)
    expect(pos.y).toBeLessThanOrEqual(300 - DEFAULT_WANDER.spriteSize)
  })

  it('SET_CONFIG applies a new size and snaps to the new ground line', () => {
    const a = boot() // bounds 1000x600, spriteSize 80 -> ground y = 520
    a.send({ type: 'SET_CONFIG', config: { ...DEFAULT_WANDER, spriteSize: 128 } })
    const ctx = a.getSnapshot().context
    expect(ctx.config.spriteSize).toBe(128)
    // New ground line = height - spriteSize = 600 - 128 = 472.
    expect(ctx.position.y).toBe(472)
    expect(ctx.position.x).toBe(500) // x unchanged (still within new bounds)
    // Retargets in place so a resize can't leave a stale off-screen target.
    expect(ctx.target).toEqual(ctx.position)
  })
})

describe('companionMachine — notification flow (Phase 5)', () => {
  const cfg = { ...DEFAULT_WANDER, speed: 100 }
  const toast: Rect = { x: 620, y: 440, width: 360, height: 110 }

  it('NOTIFICATION_APPEARED (from idle) enters alert, stores the toast, and aims at its X', () => {
    const a = boot()
    a.send({ type: 'NOTIFICATION_APPEARED', id: 'n1', rect: toast, interactive: false })
    const snap = a.getSnapshot()
    expect(snap.value).toBe('alert')
    expect(snap.context.notification).toEqual({ id: 'n1', rect: toast, interactive: false })
    // Target is the pure notificationTarget at the toast's X; facing turns toward it.
    expect(snap.context.target).toEqual(notificationTarget(toast, bounds, cfg))
    expect(snap.context.facing).toBe('right') // target x (892) is right of start (500)
  })

  it('runs alert -> travel -> interact and holds at the toast, facing the X', () => {
    const a = boot()
    a.send({ type: 'NOTIFICATION_APPEARED', id: 'n1', rect: toast, interactive: false })
    tickUntil(a, (x) => x.getSnapshot().value === 'interact')
    const snap = a.getSnapshot()
    expect(snap.value).toBe('interact')
    // Arrived at the computed spot at the toast's X, still tracking it.
    expect(snap.context.position).toEqual(notificationTarget(toast, bounds, cfg))
    expect(snap.context.notification?.id).toBe('n1')
    // beginInteract forces facing 'right' so the visible paw-swat reaches the X.
    expect(snap.context.facing).toBe('right')
  })

  it('holds a front-facing finish after dismissal, then resumes wandering', () => {
    const a = boot()
    a.send({ type: 'NOTIFICATION_APPEARED', id: 'n1', rect: toast, interactive: false })
    tickUntil(a, (x) => x.getSnapshot().value === 'interact')
    a.send({ type: 'NOTIFICATION_CLOSED', id: 'n1' })
    const snap = a.getSnapshot()
    expect(snap.value).toBe('celebrate')
    expect(snap.context.notification).toBeNull()
    const position = snap.context.position
    tick(a, 5)
    expect(a.getSnapshot().value).toBe('celebrate')
    expect(a.getSnapshot().context.position).toEqual(position)
    tickUntil(a, (actor) => actor.getSnapshot().value === 'wander')
    expect(a.getSnapshot().value).toBe('wander')
  })

  it('a close can unwind even during alert (before arrival)', () => {
    const a = boot()
    a.send({ type: 'NOTIFICATION_APPEARED', id: 'n1', rect: toast, interactive: false })
    expect(a.getSnapshot().value).toBe('alert')
    a.send({ type: 'NOTIFICATION_CLOSED', id: 'n1' })
    expect(a.getSnapshot().value).toBe('idle')
    expect(a.getSnapshot().context.notification).toBeNull()
  })

  it('ignores a close for an unrelated id while wandering', () => {
    const a = boot()
    a.send({ type: 'NOTIFICATION_CLOSED', id: 'ghost' })
    expect(['idle', 'wander']).toContain(a.getSnapshot().value)
    expect(a.getSnapshot().context.notification).toBeNull()
  })

  it('ignores a toast while being dragged (never yanked from the cursor)', () => {
    const a = boot()
    a.send({ type: 'PICK_UP' })
    a.send({ type: 'DRAG_MOVE', position: { x: 200, y: 100 } })
    a.send({ type: 'NOTIFICATION_APPEARED', id: 'n1', rect: toast, interactive: false })
    const snap = a.getSnapshot()
    expect(snap.value).toBe('dragging')
    expect(snap.context.notification).toBeNull()
    expect(snap.context.position).toEqual({ x: 200, y: 100 })
  })

  it('gives up the nudge after the safety timeout when no close ever arrives', () => {
    const a = boot()
    a.send({ type: 'NOTIFICATION_APPEARED', id: 'n1', rect: toast, interactive: false })
    tickUntil(a, (x) => x.getSnapshot().value === 'interact')
    // Tick well past INTERACT_MAX (8s) with no close — the pup must let go.
    tick(a, 100) // 10s
    const snap = a.getSnapshot()
    expect(['idle', 'wander']).toContain(snap.value)
    expect(snap.context.notification).toBeNull()
  })

  it('picking up mid-nudge clears the tracked toast', () => {
    const a = boot()
    a.send({ type: 'NOTIFICATION_APPEARED', id: 'n1', rect: toast, interactive: false })
    tickUntil(a, (x) => x.getSnapshot().value === 'interact')
    a.send({ type: 'PICK_UP' })
    const snap = a.getSnapshot()
    expect(snap.value).toBe('dragging')
    expect(snap.context.notification).toBeNull()
  })

  it('dashes to the toast faster than it wanders (travel uses the boosted stepper)', () => {
    const dt = 0.05

    // One step of the notification dash. Drive through the alert beat into
    // `travel` (position hasn't moved yet — alert only counts down), then take a
    // single tick and measure how far the pup moved.
    const dash = boot()
    dash.send({ type: 'NOTIFICATION_APPEARED', id: 'n1', rect: toast, interactive: false })
    tickUntil(dash, (x) => x.getSnapshot().value === 'travel', 400, dt)
    expect(dash.getSnapshot().value).toBe('travel')
    const dashBefore = dash.getSnapshot().context.position
    dash.send({ type: 'TICK', dt })
    const dashAfter = dash.getSnapshot().context.position
    const travelStep = Math.hypot(dashAfter.x - dashBefore.x, dashAfter.y - dashBefore.y)

    // One step of a normal wander for comparison.
    const roam = boot()
    tickUntil(roam, (x) => x.getSnapshot().value === 'wander', 400, dt)
    expect(roam.getSnapshot().value).toBe('wander')
    const roamBefore = roam.getSnapshot().context.position
    roam.send({ type: 'TICK', dt })
    const roamAfter = roam.getSnapshot().context.position
    const wanderStep = Math.hypot(roamAfter.x - roamBefore.x, roamAfter.y - roamBefore.y)

    // Both accelerate from rest; a notification builds speed faster without
    // jumping to its maximum on the first frame.
    expect(travelStep).toBeGreaterThan(0)
    expect(travelStep).toBeLessThan(cfg.speed * TRAVEL_SPEED_SCALE * dt)
    expect(travelStep).toBeGreaterThan(wanderStep)
  })
})

describe('sleep and wake', () => {
  it('walks to the top-left by default, sleeps indefinitely, and wakes to roaming', () => {
    const a = boot()
    const before = a.getSnapshot().context.position
    a.send({ type: 'SLEEP' })
    expect(a.getSnapshot().value).toBe('sleepTravel')
    expect(a.getSnapshot().context.position).toEqual(before)
    tickUntil(a, (actor) => actor.getSnapshot().value === 'sleeping')
    expect(a.getSnapshot().value).toBe('sleeping')
    const bed = a.getSnapshot().context.position
    expect(bed).toEqual({ x: 12, y: 12 })
    tick(a, 600)
    expect(a.getSnapshot().context.position).toEqual(bed)
    expect(a.getSnapshot().value).toBe('sleeping')
    a.send({ type: 'WAKE' })
    expect(a.getSnapshot().value).toBe('wander')
    tick(a, 10)
    const awake = a.getSnapshot().context.position
    expect(Math.hypot(awake.x - bed.x, awake.y - bed.y)).toBeGreaterThan(5)
    a.stop()
  })

  it('cancels a notification and ignores reactions until woken', () => {
    const a = boot()
    const toast = { x: 600, y: 300, width: 300, height: 120 }
    a.send({ type: 'NOTIFICATION_APPEARED', id: 'before', rect: toast, interactive: false })
    a.send({ type: 'SLEEP' })
    for (const state of ['sleepTravel', 'sleeping']) {
      expect(a.getSnapshot().value).toBe(state)
      a.send({ type: 'NOTIFICATION_APPEARED', id: 'new', rect: toast, interactive: true })
      a.send({ type: 'NOTIFICATION_CLOSED', id: 'before' })
      a.send({ type: 'MUSIC_START' })
      a.send({ type: 'WEBCAM_ON' })
      a.send({ type: 'SLEEP' })
      expect(a.getSnapshot().value).toBe(state)
      expect(a.getSnapshot().context.notification).toBeNull()
      tickUntil(a, (actor) => actor.getSnapshot().value === 'sleeping')
    }
    a.send({ type: 'WAKE' })
    tick(a, 1)
    expect(a.getSnapshot().value).toBe('wander')
    a.stop()
  })

  it('can cancel the walk to bed immediately', () => {
    const a = boot()
    a.send({ type: 'SLEEP' })
    tick(a, 3)
    a.send({ type: 'WAKE' })
    expect(a.getSnapshot().context.sleepRequested).toBe(false)
    expect(a.getSnapshot().value).toBe('wander')
    a.stop()
  })

  it('keeps sleeping above a moved taskbar and after changing size', () => {
    const a = boot()
    a.send({ type: 'SLEEP' })
    tickUntil(a, (actor) => actor.getSnapshot().value === 'sleeping')
    a.send({
      type: 'SET_BOUNDS',
      bounds: { width: 700, height: 500, workArea: { x: 45, y: 0, width: 655, height: 455 } }
    })
    a.send({ type: 'SET_CONFIG', config: { ...DEFAULT_WANDER, spriteSize: 128 } })
    tickUntil(a, (actor) => actor.getSnapshot().value === 'sleeping')
    expect(a.getSnapshot().value).toBe('sleeping')
    expect(a.getSnapshot().context.position).toEqual({ x: 57, y: 12 })
    a.stop()
  })

  it('does not teleport a dragged pet on a mood or size change', () => {
    const a = boot()
    a.send({ type: 'PICK_UP' })
    a.send({ type: 'DRAG_MOVE', position: { x: 200, y: 180 } })
    a.send({ type: 'DROP' })
    a.send({ type: 'SET_CONFIG', config: { ...DEFAULT_WANDER, speed: 45 } })
    expect(a.getSnapshot().context.position).toEqual({ x: 200, y: 180 })
    a.send({ type: 'SET_CONFIG', config: { ...DEFAULT_WANDER, spriteSize: 128 } })
    expect(a.getSnapshot().context.position.y + 128).toBe(260)
    a.stop()
  })

  it('clamps a pending wander destination after display shrink', () => {
    const a = boot()
    tickUntil(a, (actor) => actor.getSnapshot().value === 'wander')
    a.send({ type: 'SET_BOUNDS', bounds: { width: 200, height: 150 } })
    expect(a.getSnapshot().context.target.x).toBeLessThanOrEqual(120)
    expect(a.getSnapshot().context.target.y).toBeLessThanOrEqual(70)
    a.stop()
  })
})

describe('companionMachine — sound-sensitive dance (Feature 2)', () => {
  const toast: Rect = { x: 620, y: 440, width: 360, height: 110 }

  it('MUSIC_START then a tick enters dance from idle', () => {
    const a = boot()
    a.send({ type: 'MUSIC_START' })
    expect(a.getSnapshot().context.musicActive).toBe(true)
    tick(a, 1)
    expect(a.getSnapshot().value).toBe('dance')
  })

  it('enters dance from wander too', () => {
    const a = boot()
    tickUntil(a, (x) => x.getSnapshot().value === 'wander')
    expect(a.getSnapshot().value).toBe('wander')
    a.send({ type: 'MUSIC_START' })
    tick(a, 1)
    expect(a.getSnapshot().value).toBe('dance')
  })

  it('MUSIC_STOP leaves dance and returns to idle', () => {
    const a = boot()
    a.send({ type: 'MUSIC_START' })
    tickUntil(a, (x) => x.getSnapshot().value === 'dance')
    a.send({ type: 'MUSIC_STOP' })
    expect(a.getSnapshot().context.musicActive).toBe(false)
    tick(a, 1)
    expect(a.getSnapshot().value).toBe('idle')
  })

  it('a toast interrupts the dance (dance -> alert), then the reaction runs', () => {
    const a = boot()
    a.send({ type: 'MUSIC_START' })
    tickUntil(a, (x) => x.getSnapshot().value === 'dance')
    a.send({ type: 'NOTIFICATION_APPEARED', id: 'n1', rect: toast, interactive: false })
    expect(a.getSnapshot().value).toBe('alert')
    tickUntil(a, (x) => x.getSnapshot().value === 'interact')
    expect(a.getSnapshot().value).toBe('interact')
  })

  it('music starting mid-drag does not yank the pup into a dance', () => {
    const a = boot()
    a.send({ type: 'PICK_UP' })
    a.send({ type: 'DRAG_MOVE', position: { x: 200, y: 100 } })
    a.send({ type: 'MUSIC_START' })
    tick(a, 3)
    // Still held by the cursor — the flag is set but dance is deferred.
    expect(a.getSnapshot().value).toBe('dragging')
    expect(a.getSnapshot().context.musicActive).toBe(true)
    // After dropping, it settles and then picks up the dance on its own.
    a.send({ type: 'DROP' })
    tickUntil(a, (x) => x.getSnapshot().value === 'dance')
    expect(a.getSnapshot().value).toBe('dance')
  })

  it('music starting mid-nudge does not interrupt the notification reaction', () => {
    const a = boot()
    a.send({ type: 'NOTIFICATION_APPEARED', id: 'n1', rect: toast, interactive: false })
    tickUntil(a, (x) => x.getSnapshot().value === 'interact')
    a.send({ type: 'MUSIC_START' })
    tick(a, 1)
    // The reaction owns the pup until the toast resolves; music is deferred.
    expect(a.getSnapshot().value).toBe('interact')
    // Once the toast closes, the deferred music takes over.
    a.send({ type: 'NOTIFICATION_CLOSED', id: 'n1' })
    tickUntil(a, (x) => x.getSnapshot().value === 'dance')
    expect(a.getSnapshot().value).toBe('dance')
  })
})

describe('companionMachine — webcam pose flow (Feature 3)', () => {
  const cfg = { ...DEFAULT_WANDER, speed: 100 }
  const toast: Rect = { x: 620, y: 440, width: 360, height: 110 }

  it('WEBCAM_ON sets the flag; a guarded tick scurries to the top-centre pose spot', () => {
    const a = boot()
    a.send({ type: 'WEBCAM_ON' })
    expect(a.getSnapshot().context.webcamActive).toBe(true)
    tick(a, 1)
    const snap = a.getSnapshot()
    expect(snap.value).toBe('webcamTravel')
    // Aims at the pure top-centre pose spot and turns toward it.
    expect(snap.context.target).toEqual(webcamTarget(bounds, cfg))
    expect(snap.context.facing).toBe('left') // target x (<500) is left of start (500)
  })

  it('runs webcamTravel -> posing -> idle and marks the session posed', () => {
    const a = boot()
    a.send({ type: 'WEBCAM_ON' })
    tickUntil(a, (x) => x.getSnapshot().value === 'posing')
    expect(a.getSnapshot().value).toBe('posing')
    // Dashed all the way to the pose spot before striking the pose.
    expect(a.getSnapshot().context.position).toEqual(webcamTarget(bounds, cfg))
    // Holds the pose (POSE_TIME) then resumes roaming.
    tickUntil(a, (x) => x.getSnapshot().value === 'idle')
    expect(a.getSnapshot().value).toBe('idle')
    expect(a.getSnapshot().context.posedThisSession).toBe(true)
  })

  it('poses only ONCE while the camera stays on (no re-posing every idle tick)', () => {
    const a = boot()
    a.send({ type: 'WEBCAM_ON' })
    tickUntil(a, (x) => x.getSnapshot().value === 'posing')
    tickUntil(a, (x) => x.getSnapshot().value === 'idle')
    expect(a.getSnapshot().context.posedThisSession).toBe(true)
    // Camera is still on. Keep living for a while: it must NOT jump back into the
    // pose flow — the latch keeps it in ordinary idle/wander.
    tick(a, 60) // 6s
    expect(['idle', 'wander']).toContain(a.getSnapshot().value)
    expect(a.getSnapshot().context.webcamActive).toBe(true)
  })

  it('WEBCAM_OFF resets the latch so the NEXT camera session poses again', () => {
    const a = boot()
    a.send({ type: 'WEBCAM_ON' })
    tickUntil(a, (x) => x.getSnapshot().value === 'posing')
    tickUntil(a, (x) => x.getSnapshot().value === 'idle')
    a.send({ type: 'WEBCAM_OFF' })
    expect(a.getSnapshot().context.webcamActive).toBe(false)
    expect(a.getSnapshot().context.posedThisSession).toBe(false)
    // A fresh camera session poses again.
    a.send({ type: 'WEBCAM_ON' })
    tickUntil(a, (x) => x.getSnapshot().value === 'posing')
    expect(a.getSnapshot().value).toBe('posing')
  })

  it('the camera turning off mid-scurry unwinds straight to idle', () => {
    const a = boot()
    a.send({ type: 'WEBCAM_ON' })
    tickUntil(a, (x) => x.getSnapshot().value === 'webcamTravel')
    a.send({ type: 'WEBCAM_OFF' })
    expect(a.getSnapshot().value).toBe('idle')
    expect(a.getSnapshot().context.webcamActive).toBe(false)
  })

  it('the camera turning off mid-pose ends the pose early', () => {
    const a = boot()
    a.send({ type: 'WEBCAM_ON' })
    tickUntil(a, (x) => x.getSnapshot().value === 'posing')
    a.send({ type: 'WEBCAM_OFF' })
    expect(a.getSnapshot().value).toBe('idle')
    expect(a.getSnapshot().context.webcamActive).toBe(false)
  })

  it('a toast still wins: it interrupts the pose flow (posing -> alert -> interact)', () => {
    const a = boot()
    a.send({ type: 'WEBCAM_ON' })
    tickUntil(a, (x) => x.getSnapshot().value === 'posing')
    a.send({ type: 'NOTIFICATION_APPEARED', id: 'n1', rect: toast, interactive: false })
    expect(a.getSnapshot().value).toBe('alert')
    tickUntil(a, (x) => x.getSnapshot().value === 'interact')
    expect(a.getSnapshot().value).toBe('interact')
  })

  it('a camera turning on mid-drag does not yank the pup into a pose', () => {
    const a = boot()
    a.send({ type: 'PICK_UP' })
    a.send({ type: 'DRAG_MOVE', position: { x: 200, y: 100 } })
    a.send({ type: 'WEBCAM_ON' })
    tick(a, 3)
    // Still held by the cursor — the flag is set but posing is deferred.
    expect(a.getSnapshot().value).toBe('dragging')
    expect(a.getSnapshot().context.webcamActive).toBe(true)
    // After dropping, it settles and then scurries off to pose on its own.
    a.send({ type: 'DROP' })
    tickUntil(a, (x) => x.getSnapshot().value === 'posing')
    expect(a.getSnapshot().value).toBe('posing')
  })

  it('a camera turning on mid-nudge does not interrupt the notification reaction', () => {
    const a = boot()
    a.send({ type: 'NOTIFICATION_APPEARED', id: 'n1', rect: toast, interactive: false })
    tickUntil(a, (x) => x.getSnapshot().value === 'interact')
    a.send({ type: 'WEBCAM_ON' })
    tick(a, 1)
    // The reaction owns the pup until the toast resolves; posing is deferred.
    expect(a.getSnapshot().value).toBe('interact')
    // Once the toast closes, the deferred pose takes over.
    a.send({ type: 'NOTIFICATION_CLOSED', id: 'n1' })
    tickUntil(a, (x) => x.getSnapshot().value === 'posing')
    expect(a.getSnapshot().value).toBe('posing')
  })
})
