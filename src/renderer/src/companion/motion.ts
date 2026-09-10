// ---------------------------------------------------------------------------
// Pure motion / wander math for the companion.
// ---------------------------------------------------------------------------
// No DOM, no React, no XState — just numbers in, numbers out. This is where the
// "how does the dog move" logic lives so it can be unit-tested in isolation
// (the sandbox can't launch the GUI, so pure + tested is how we get confidence).
//
// Coordinate space: overlay-window-local CSS pixels. Origin top-left, x right,
// y down. The "ground line" is the y where the sprite's ANCHOR (bottom-center)
// rests when walking along the taskbar edge.

import type { SleepPosition } from '../../../shared/settings'

export interface Vec2 {
  x: number
  y: number
}

export interface Bounds {
  width: number
  height: number
  /** Usable desktop in overlay coordinates, excluding the taskbar. */
  workArea?: Rect
}

/** A rectangle in overlay-window-local CSS px (e.g. a notification's location).
 *  Structurally identical to shared/coords.LocalRect so either can be passed. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type Facing = 'left' | 'right'

/** How the companion is allowed to roam. Tunable per size/reduced-motion. */
export interface WanderConfig {
  /** Sprite size in px (square). Used to keep the body fully on-screen. */
  spriteSize: number
  /** Walk speed in px/second. */
  speed: number
  /** Fraction of the time the dog rests vs. walks (0..1). */
  restBias: number
  /** Chance of a full-desktop excursion rather than a shorter local stroll. */
  roamChance: number
  /** User control applies to normal walks, independently of urgent trips. */
  wanderSpeedMultiplier?: number
  sleepPosition?: SleepPosition
}

export const DEFAULT_WANDER: WanderConfig = {
  spriteSize: 80,
  speed: 90,
  restBias: 0.35,
  // A moderate exploration range for short, deliberate walks.
  roamChance: 0.75,
  wanderSpeedMultiplier: 1,
  sleepPosition: 'top-left'
}

/**
 * How much faster the companion moves while dashing to a toast (state `travel`)
 * than during a normal wander. Applied as a multiplier on `cfg.speed` via
 * `stepToward`'s `speedScale`, so it scales with whatever the user's size-based
 * wander speed is. Tuned to read as an urgent "runs over FAST" dash (the user's
 * request) while staying smooth: at the ~90px/s base and the 0.05s dt clamp the
 * app enforces, one tick moves ≲20px — comfortably under the sprite size, so it
 * never teleports past the toast between frames (`stepToward` also snaps to the
 * target on the final tick rather than overshooting).
 */
export const TRAVEL_SPEED_SCALE = 4.8
export const SLEEP_SPEED_SCALE = 4

/**
 * The y-coordinate of the sprite's top-left when resting on the ground line
 * (bottom of the screen, classic desktop-pet behavior). Keeps the whole body
 * on-screen.
 */
export function groundLineTop(bounds: Bounds, cfg: WanderConfig): number {
  const area = bounds.workArea
  return Math.max(0, (area ? area.y + area.height : bounds.height) - cfg.spriteSize)
}

/** Park inside the chosen work-area corner, leaving room around the pet. */
export function sleepTarget(bounds: Bounds, cfg: WanderConfig): Vec2 {
  const area = bounds.workArea ?? { x: 0, y: 0, width: bounds.width, height: bounds.height }
  const corner = cfg.sleepPosition ?? 'top-left'
  return clampToBounds(
    {
      x: corner.endsWith('right') ? area.x + area.width - cfg.spriteSize - 12 : area.x + 12,
      y: corner.startsWith('bottom') ? groundLineTop(bounds, cfg) - 12 : area.y + 12
    },
    bounds,
    cfg
  )
}

/** Clamp a sprite top-left position so the full body stays within bounds. */
export function clampToBounds(pos: Vec2, bounds: Bounds, cfg: WanderConfig): Vec2 {
  const maxX = Math.max(0, bounds.width - cfg.spriteSize)
  const maxY = Math.max(0, bounds.height - cfg.spriteSize)
  const area = bounds.workArea
  const minX = Math.min(maxX, Math.max(0, area?.x ?? 0))
  const minY = Math.min(maxY, Math.max(0, area?.y ?? 0))
  const right = Math.max(minX, Math.min(maxX, area ? area.x + area.width - cfg.spriteSize : maxX))
  const bottom = Math.max(minY, Math.min(maxY, area ? area.y + area.height - cfg.spriteSize : maxY))
  return {
    x: Math.min(Math.max(minX, pos.x), right),
    y: Math.min(Math.max(minY, pos.y), bottom)
  }
}

/** Facing implied by horizontal movement; keeps previous facing if no x-motion. */
export function facingFromDelta(dx: number, prev: Facing): Facing {
  if (dx > 0.001) return 'right'
  if (dx < -0.001) return 'left'
  return prev
}

/**
 * Deterministically pick the next wander target given a random source.
 * Returns a target the sprite should walk to (top-left coords). Passing an
 * explicit `rng` (default Math.random) keeps this testable.
 *
 * Mix full-desktop excursions and local strolls, varying both axes. Supplying
 * the current position also avoids picking an imperceptibly short destination.
 */
export function pickWanderTarget(
  bounds: Bounds,
  cfg: WanderConfig,
  rng: () => number = Math.random,
  origin?: Vec2
): Vec2 {
  const maxX = Math.max(0, bounds.width - cfg.spriteSize)
  const maxY = Math.max(0, bounds.height - cfg.spriteSize)
  const x = Math.round(rng() * maxX)

  if (origin) {
    const far = rng() < cfg.roamChance
    const angle = rng() * Math.PI * 2
    const distance = cfg.spriteSize * (1.4 + rng() * 3.2)
    let target = clampToBounds(
      far
        ? { x, y: rng() * maxY }
        : { x: origin.x + Math.cos(angle) * distance, y: origin.y + Math.sin(angle) * distance },
      bounds,
      cfg
    )
    if (Math.hypot(target.x - origin.x, target.y - origin.y) < cfg.spriteSize * 0.7) {
      target = clampToBounds(
        { x: origin.x < maxX / 2 ? maxX : 0, y: origin.y < maxY / 2 ? maxY : 0 },
        bounds,
        cfg
      )
    }
    return target
  }

  // Free roam across the entire screen (any x, any y).
  if (rng() < cfg.roamChance) {
    return { x, y: Math.round(rng() * maxY) }
  }
  // Otherwise settle back down onto the ground line.
  return { x, y: groundLineTop(bounds, cfg) }
}

/** Acceleration and braking in px/s; independent of the animation frame rate. */
export function easedStep(
  pos: Vec2,
  target: Vec2,
  cfg: WanderConfig,
  dt: number,
  facing: Facing,
  speed: number,
  speedScale = 1
): StepResult & { speed: number; distance: number } {
  const elapsed = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0
  const distance = Math.hypot(target.x - pos.x, target.y - pos.y)
  const acceleration = Math.max(80, cfg.speed * speedScale * 3.5)
  const desired = Math.min(cfg.speed * speedScale, Math.sqrt(2 * acceleration * distance))
  const nextSpeed =
    speed + Math.max(-acceleration * elapsed, Math.min(acceleration * elapsed, desired - speed))
  if (elapsed === 0) return { pos, facing, arrived: distance < 0.5, speed, distance: 0 }
  const result = stepToward(pos, target, { ...cfg, speed: nextSpeed }, elapsed, facing)
  return {
    ...result,
    speed: result.arrived ? 0 : nextSpeed,
    distance: Math.hypot(result.pos.x - pos.x, result.pos.y - pos.y)
  }
}

export interface StepResult {
  pos: Vec2
  arrived: boolean
  facing: Facing
}

/**
 * Move `pos` toward `target` by at most speed*dt. Returns the new position,
 * whether we've essentially arrived, and the facing implied by the motion.
 *
 * @param dtSeconds elapsed time since last step, in seconds
 * @param speedScale multiplier on `cfg.speed` for this step (default 1). Used by
 *   the notification dash (`travel`) to move faster than a normal wander without
 *   needing a second config — pass TRAVEL_SPEED_SCALE. Existing callers omit it
 *   and are unaffected.
 */
export function stepToward(
  pos: Vec2,
  target: Vec2,
  cfg: WanderConfig,
  dtSeconds: number,
  prevFacing: Facing,
  speedScale = 1
): StepResult {
  const dx = target.x - pos.x
  const dy = target.y - pos.y
  const dist = Math.hypot(dx, dy)
  const maxStep = cfg.speed * speedScale * dtSeconds

  if (dist <= maxStep || dist < 0.5) {
    return {
      pos: { x: target.x, y: target.y },
      arrived: true,
      facing: facingFromDelta(dx, prevFacing)
    }
  }

  const nx = pos.x + (dx / dist) * maxStep
  const ny = pos.y + (dy / dist) * maxStep
  return { pos: { x: nx, y: ny }, arrived: false, facing: facingFromDelta(dx, prevFacing) }
}

/**
 * The dismiss (X / close) button sits at a Windows toast's TOP-RIGHT corner.
 * These insets (overlay-local CSS px) put the aim point at that button's centre
 * for a typical Win11 toast — the exact spot the pet reaches its paw to tap shut.
 */
export const CLOSE_INSET_X = 22
export const CLOSE_INSET_Y = 20

/**
 * Where the pet's raised front paw lands as a FRACTION of the sprite box, facing
 * right. At the swat's peak the front leg's foot swings to roughly (0.82, 0.80)
 * of the box (see the swat transforms in SpriteCanvas). We offset the body
 * up-and-left by this so the paw *tip* reaches the X, instead of the body centre
 * sitting on it.
 */
export const PAW_CONTACT_FX = 0.82
export const PAW_CONTACT_FY = 0.8

/**
 * Where the sprite should stand to paw a notification's close button shut. Given
 * the toast's rectangle (overlay-local px), return a top-left target that lands
 * the pet's front paw right on the toast's TOP-RIGHT X, clamped so the whole body
 * stays on-screen.
 *
 * The pet is placed up-and-left of the X (by PAW_CONTACT_F* × sprite size) and
 * always made to face right on arrival (see machine `beginInteract`), so its
 * front-right leg reaches into the corner and bats the X. Pure and deterministic
 * so it's unit-testable.
 */
export function notificationTarget(rect: Rect, bounds: Bounds, cfg: WanderConfig): Vec2 {
  const sz = cfg.spriteSize
  const closeX = rect.x + rect.width - CLOSE_INSET_X
  const closeY = rect.y + CLOSE_INSET_Y
  const rawX = Math.round(closeX - PAW_CONTACT_FX * sz)
  const rawY = Math.round(closeY - PAW_CONTACT_FY * sz)
  return clampToBounds({ x: rawX, y: rawY }, bounds, cfg)
}

/**
 * How far below the very top edge the pet parks when posing for the webcam.
 * A built-in/clip-on camera sits at the screen's TOP-CENTRE, so the pet scurries
 * up there to be "in frame". A few px of margin keeps its head off the exact edge
 * (and clear of a laptop camera notch) while still reading as "up by the camera".
 */
export const WEBCAM_TOP_MARGIN = 8

/**
 * Where the sprite should stand to pose for the webcam: horizontally centred and
 * near the top edge (right under a typical top-centre camera). Returns a top-left
 * target, clamped so the whole body stays on-screen. Pure/deterministic for tests.
 */
export function webcamTarget(bounds: Bounds, cfg: WanderConfig): Vec2 {
  const rawX = Math.round(bounds.width / 2 - cfg.spriteSize / 2)
  return clampToBounds({ x: rawX, y: WEBCAM_TOP_MARGIN }, bounds, cfg)
}
