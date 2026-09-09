// Pure geometry helper, extracted so it's unit-testable without a DOM.
// Used by the overlay to decide whether the cursor is over the sprite (and
// therefore whether the window should capture the mouse vs. stay click-through).

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Is the point (x, y) within `padding` px of the given rect?
 */
export function isPointInRect(x: number, y: number, rect: Rect, padding = 0): boolean {
  return (
    x >= rect.left - padding &&
    x <= rect.right + padding &&
    y >= rect.top - padding &&
    y <= rect.bottom + padding
  )
}
