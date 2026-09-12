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
  CLOSE_INSET_Y,
  PAW_CONTACT_FX,
  PAW_CONTACT_FY,
  notificationClosePoint,
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
  it('overlaps the message with its raised paw at the close button', () => {
    const rect: Rect = { x: 620, y: 440, width: 360, height: 110 }
    const t = notificationTarget(rect, bounds, cfg)
    expect(t.x + PAW_CONTACT_FX * cfg.spriteSize).toBeCloseTo(958)
    expect(t.y + PAW_CONTACT_FY * cfg.spriteSize).toBeCloseTo(460)
    expect(t.y + cfg.spriteSize * 0.5).toBeGreaterThan(rect.y)
  })

  it('aims at the X of a left-hugging toast too', () => {
    const rect: Rect = { x: 20, y: 100, width: 300, height: 120 }
    const t = notificationTarget(rect, bounds, cfg)
    expect(t.x + PAW_CONTACT_FX * cfg.spriteSize).toBeCloseTo(298)
    expect(t.y + PAW_CONTACT_FY * cfg.spriteSize).toBeCloseTo(120)
  })

  it('keeps the body visible at the top edge with the close point inside the sprite', () => {
    const rect: Rect = { x: 820, y: 0, width: 200, height: 50 }
    const t = notificationTarget(rect, bounds, cfg)
    const close = notificationClosePoint(rect)
    expect(close.x).toBeGreaterThan(t.x)
    expect(close.x).toBeLessThan(t.x + cfg.spriteSize)
    expect(close.y).toBeGreaterThan(t.y)
    expect(close.y).toBeLessThan(t.y + cfg.spriteSize)
    expect(t.y).toBe(0)
  })

  it('stays over the message for a top-left toast', () => {
    const rect: Rect = { x: 0, y: 0, width: 360, height: 150 }
    const t = notificationTarget(rect, bounds, cfg)
    expect(t.x + cfg.spriteSize).toBeLessThan(rect.x + rect.width)
    expect(t.y).toBe(0)
  })

  it('uses the measured button centre instead of a guessed inset', () => {
    const rect = { x: 620, y: 400, width: 360, height: 150 }
    const close = { x: 941, y: 437 }
    const t = notificationTarget(rect, bounds, cfg, close)
    expect(t.x + PAW_CONTACT_FX * cfg.spriteSize).toBeCloseTo(close.x)
    expect(t.y + PAW_CONTACT_FY * cfg.spriteSize).toBeCloseTo(close.y)
  })

  it.each([48, 80, 128])(
    'aligns a %ipx pet with the cross while keeping its body inside the desktop',
    (spriteSize) => {
      const screen = { ...bounds, workArea: { x: 0, y: 0, width: 1000, height: 552 } }
      const rect = { x: 620, y: 260, width: 360, height: 280 }
      const t = notificationTarget(rect, screen, { ...cfg, spriteSize })
      expect(t.y).toBeGreaterThanOrEqual(0)
      expect(t.y + spriteSize).toBeLessThanOrEqual(screen.workArea.height)
      expect(t.y + spriteSize * PAW_CONTACT_FY).toBeCloseTo(rect.y + CLOSE_INSET_Y)
      expect(t.x + spriteSize * PAW_CONTACT_FX).toBeCloseTo(rect.x + rect.width - CLOSE_INSET_X)
      expect(t.x).toBeGreaterThanOrEqual(0)
      expect(t.x + spriteSize).toBeLessThanOrEqual(screen.width)
    }
  )

  it('stays within the work area even when a banner leaves no free side', () => {
    const t = notificationTarget({ x: 0, y: 0, width: 1000, height: 600 }, bounds, cfg)
    expect(t.x).toBeGreaterThanOrEqual(0)
    expect(t.y).toBeGreaterThanOrEqual(0)
    expect(t.x + cfg.spriteSize).toBeLessThanOrEqual(bounds.width)
    expect(t.y + cfg.spriteSize).toBeLessThanOrEqual(bounds.height)
  })

  it('lands the paw tip on the close button (contact alignment)', () => {
    // Away from any edge, the placed body + paw-contact fraction should put the
    // paw tip on closeX within rounding (this is the invariant PAW_CONTACT_FX buys).
    const rect: Rect = { x: 620, y: 440, width: 360, height: 110 }
    const t = notificationTarget(rect, bounds, cfg)
    const closeX = rect.x + rect.width - CLOSE_INSET_X
    expect(Math.abs(t.x + PAW_CONTACT_FX * cfg.spriteSize - closeX)).toBeLessThanOrEqual(1)
    expect(t.y + PAW_CONTACT_FY * cfg.spriteSize).toBeCloseTo(rect.y + CLOSE_INSET_Y)
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
