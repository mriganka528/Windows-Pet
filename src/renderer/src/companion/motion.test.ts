import { describe, it, expect } from 'vitest'
import {
  clampToBounds,
  facingFromDelta,
  groundLineTop,
  pickWanderTarget,
  stepToward,
  notificationTarget,
  webcamTarget,
  WEBCAM_TOP_MARGIN,
  CLOSE_INSET_X,
  PAW_CONTACT_FX,
  DEFAULT_WANDER,
  TRAVEL_SPEED_SCALE,
  type Bounds,
  type Rect,
  type WanderConfig
} from './motion'

const bounds: Bounds = { width: 1000, height: 600 }
const cfg: WanderConfig = { ...DEFAULT_WANDER, spriteSize: 80, speed: 100 }

describe('groundLineTop', () => {
  it('rests the sprite body on the bottom edge', () => {
    expect(groundLineTop(bounds, cfg)).toBe(520) // 600 - 80
  })
  it('never goes negative on a tiny screen', () => {
    expect(groundLineTop({ width: 50, height: 40 }, cfg)).toBe(0)
  })
})

describe('clampToBounds', () => {
  it('keeps the full body on-screen', () => {
    expect(clampToBounds({ x: -20, y: 999 }, bounds, cfg)).toEqual({ x: 0, y: 520 })
    expect(clampToBounds({ x: 9999, y: -5 }, bounds, cfg)).toEqual({ x: 920, y: 0 })
  })
})

describe('facingFromDelta', () => {
  it('faces right when moving right, left when moving left', () => {
    expect(facingFromDelta(5, 'left')).toBe('right')
    expect(facingFromDelta(-5, 'right')).toBe('left')
  })
  it('keeps previous facing when not moving horizontally', () => {
    expect(facingFromDelta(0, 'left')).toBe('left')
    expect(facingFromDelta(0, 'right')).toBe('right')
  })
})

describe('pickWanderTarget', () => {
  it('settles on the ground line when the roam roll misses', () => {
    // rng sequence: first call -> x fraction, second -> roam roll (high = no roam)
    const rng = seq([0.5, 0.99])
    const t = pickWanderTarget(bounds, cfg, rng)
    expect(t.x).toBe(460) // round(0.5 * 920)
    expect(t.y).toBe(520) // ground line
  })
  it('roams anywhere on the whole screen when the roll is under the chance', () => {
    // x=0.5, roam hits (0.0 < roamChance), y fraction = 0.25 -> mid-screen height
    const rng = seq([0.5, 0.0, 0.25])
    const t = pickWanderTarget(bounds, cfg, rng)
    expect(t.x).toBe(460) // round(0.5 * 920)
    expect(t.y).toBe(130) // round(0.25 * 520) — well above the ground line
    expect(t.y).toBeLessThan(520)
  })
  it('keeps a roamed target fully on-screen (any x, any y)', () => {
    // Extreme fractions still clamp inside the movable box via maxX/maxY.
    const rng = seq([1.0, 0.0, 1.0]) // x=max, roam hits, y=max
    const t = pickWanderTarget(bounds, cfg, rng)
    expect(t.x).toBe(920) // maxX = 1000 - 80
    expect(t.y).toBe(520) // maxY = 600 - 80
  })
})

describe('stepToward', () => {
  it('moves at most speed*dt and reports facing', () => {
    const r = stepToward({ x: 0, y: 0 }, { x: 1000, y: 0 }, cfg, 0.1, 'left')
    expect(r.arrived).toBe(false)
    expect(r.pos.x).toBeCloseTo(10) // 100 px/s * 0.1s
    expect(r.facing).toBe('right')
  })
  it('snaps to target and reports arrival when within one step', () => {
    const r = stepToward({ x: 995, y: 0 }, { x: 1000, y: 0 }, cfg, 0.1, 'left')
    expect(r.arrived).toBe(true)
    expect(r.pos).toEqual({ x: 1000, y: 0 })
  })
  it('scales the step by speedScale (the notification dash moves faster)', () => {
    // Same start/target/dt, but scaled: covers speed*scale*dt in one step.
    const r = stepToward({ x: 0, y: 0 }, { x: 1000, y: 0 }, cfg, 0.1, 'left', TRAVEL_SPEED_SCALE)
    expect(r.arrived).toBe(false)
    expect(r.pos.x).toBeCloseTo(100 * TRAVEL_SPEED_SCALE * 0.1) // 45 at scale 4.5
  })
  it('defaults speedScale to 1 so existing callers are unchanged', () => {
    const plain = stepToward({ x: 0, y: 0 }, { x: 1000, y: 0 }, cfg, 0.1, 'left')
    const explicit = stepToward({ x: 0, y: 0 }, { x: 1000, y: 0 }, cfg, 0.1, 'left', 1)
    expect(explicit.pos.x).toBeCloseTo(plain.pos.x)
  })
  it('TRAVEL_SPEED_SCALE is a meaningful speed-up (>1) that still lands within a frame', () => {
    // Guardrail: fast enough to read as an urgent dash, but not so fast it can
    // overshoot wildly in a single slow (~0.1s) tick. Keep it a sane multiple.
    expect(TRAVEL_SPEED_SCALE).toBeGreaterThan(1)
    expect(TRAVEL_SPEED_SCALE).toBeLessThanOrEqual(6)
  })
})

describe('notificationTarget', () => {
  it('aims the front paw at the top-right X of a right-hugging toast (common case)', () => {
    // A real Windows toast tucks into the bottom-right; the dismiss (X) sits at
    // its TOP-RIGHT corner. The pup parks up-and-left so its raised paw reaches it.
    const rect: Rect = { x: 620, y: 440, width: 360, height: 110 }
    const t = notificationTarget(rect, bounds, cfg)
    // closeX = 620+360-22 = 958; x = round(958 - 0.82*80) = round(892.4) = 892
    expect(t.x).toBe(892)
    // closeY = 440+20 = 460; y = round(460 - 0.8*80) = round(396) = 396
    expect(t.y).toBe(396)
  })

  it('aims at the X of a left-hugging toast too', () => {
    const rect: Rect = { x: 20, y: 100, width: 300, height: 120 }
    const t = notificationTarget(rect, bounds, cfg)
    // closeX = 20+300-22 = 298; x = round(298 - 65.6) = 232
    expect(t.x).toBe(232)
    // closeY = 100+20 = 120; y = round(120 - 64) = 56
    expect(t.y).toBe(56)
  })

  it('clamps the target so the whole body stays on-screen', () => {
    // Toast pinned to the very top-right → naive paw-align y would be negative and
    // x would push the body off the right edge; both clamp back inside bounds.
    const rect: Rect = { x: 820, y: 0, width: 200, height: 50 }
    const t = notificationTarget(rect, bounds, cfg)
    expect(t.x).toBe(920) // clamped from round(998-65.6)=932 to maxX=1000-80
    expect(t.y).toBe(0) // clamped up from round(20-64) = -44
  })

  it('lands the paw tip on the close button (contact alignment)', () => {
    // Away from any edge, the placed body + paw-contact fraction should put the
    // paw tip on closeX within rounding (this is the invariant PAW_CONTACT_FX buys).
    const rect: Rect = { x: 620, y: 440, width: 360, height: 110 }
    const t = notificationTarget(rect, bounds, cfg)
    const closeX = rect.x + rect.width - CLOSE_INSET_X
    expect(Math.abs(t.x + PAW_CONTACT_FX * cfg.spriteSize - closeX)).toBeLessThanOrEqual(1)
  })
})

describe('webcamTarget', () => {
  it('centres the body horizontally and parks it near the top edge', () => {
    // The photogenic pose spot: right under a typical top-centre camera.
    const t = webcamTarget(bounds, cfg)
    expect(t.x).toBe(460) // round(1000/2 - 80/2)
    expect(t.y).toBe(WEBCAM_TOP_MARGIN) // 8 — comfortably inside, so no clamp
  })

  it('keeps the whole body on-screen on a tiny display (clamps to origin)', () => {
    // When the sprite is wider/taller than the screen, centring + top-margin both
    // clamp back to 0 so nothing hangs off the edge.
    const t = webcamTarget({ width: 50, height: 40 }, cfg)
    expect(t).toEqual({ x: 0, y: 0 })
  })
})

/** Deterministic rng stub returning the given values then its last value. */
function seq(values: number[]): () => number {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}
