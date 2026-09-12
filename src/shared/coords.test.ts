import { describe, it, expect } from 'vitest'
import {
  screenPointToLocalPoint,
  screenRectToLocalRect,
  rectCenter,
  type ScreenRect
} from './coords'

it.each([1, 1.25, 1.5, 2])(
  'maps a measured cross to overlay coordinates at %s DPI scale',
  (scale) => {
    expect(
      screenPointToLocalPoint({ x: 960 * scale, y: 420 * scale }, { x: 100, y: 20 }, scale)
    ).toEqual({ x: 860, y: 400 })
  }
)

describe('screenRectToLocalRect', () => {
  it('is identity at scale 1 with a zero origin (primary display, no scaling)', () => {
    const r: ScreenRect = { x: 1500, y: 880, width: 360, height: 110 }
    expect(screenRectToLocalRect(r, { x: 0, y: 0 }, 1)).toEqual({
      x: 1500,
      y: 880,
      width: 360,
      height: 110
    })
  })

  it('divides physical px by the display scale factor', () => {
    // A 150%-scaled display: physical 2400x1620 toast origin -> DIP 1600x1080.
    const r: ScreenRect = { x: 2400, y: 1500, width: 300, height: 150 }
    const local = screenRectToLocalRect(r, { x: 0, y: 0 }, 1.5)
    expect(local.x).toBeCloseTo(1600)
    expect(local.y).toBeCloseTo(1000)
    expect(local.width).toBeCloseTo(200)
    expect(local.height).toBeCloseTo(100)
  })

  it('subtracts the overlay origin (after scaling to DIP)', () => {
    const r: ScreenRect = { x: 200, y: 100, width: 50, height: 20 }
    // overlay sits at DIP (100, 40); scale 1 so physical==DIP.
    const local = screenRectToLocalRect(r, { x: 100, y: 40 }, 1)
    expect(local).toEqual({ x: 100, y: 60, width: 50, height: 20 })
  })

  it('never divides by zero if a bad scale is passed', () => {
    const r: ScreenRect = { x: 10, y: 10, width: 10, height: 10 }
    expect(screenRectToLocalRect(r, { x: 0, y: 0 }, 0)).toEqual({
      x: 10,
      y: 10,
      width: 10,
      height: 10
    })
  })

  it('rectCenter returns the middle of a local rect', () => {
    expect(rectCenter({ x: 10, y: 20, width: 100, height: 40 })).toEqual({ x: 60, y: 40 })
  })
})
