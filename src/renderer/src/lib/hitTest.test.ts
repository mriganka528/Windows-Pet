import { describe, it, expect } from 'vitest'
import { isPointInRect, type Rect } from './hitTest'

const rect: Rect = { left: 100, top: 100, right: 180, bottom: 180 }

describe('isPointInRect', () => {
  it('returns true for a point inside the rect', () => {
    expect(isPointInRect(140, 140, rect)).toBe(true)
  })

  it('returns false for a point clearly outside', () => {
    expect(isPointInRect(10, 10, rect)).toBe(false)
  })

  it('is inclusive of the exact edges', () => {
    expect(isPointInRect(100, 100, rect)).toBe(true)
    expect(isPointInRect(180, 180, rect)).toBe(true)
  })

  it('honors padding around the rect', () => {
    // 6px outside the right edge, but within 6px padding.
    expect(isPointInRect(186, 140, rect, 6)).toBe(true)
    // 7px outside with 6px padding -> miss.
    expect(isPointInRect(187, 140, rect, 6)).toBe(false)
  })
})
