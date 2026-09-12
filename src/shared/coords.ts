// ---------------------------------------------------------------------------
// Coordinate conversion: watcher screen pixels -> overlay-window-local CSS px.
// ---------------------------------------------------------------------------
// DEPENDENCY-FREE and Node/DOM-free on purpose (same rule as settings.ts) so the
// Electron main process can import it AND it can be unit-tested in isolation.
//
// THE TWO COORDINATE SPACES
//   • The Native Watcher reports bounding rectangles in **physical screen
//     pixels** (it declares Per-Monitor-V2 DPI awareness, so a toast at the
//     bottom-right of a 150%-scaled 1920x1080 panel comes back in real device
//     pixels, e.g. x≈2600 on the virtual desktop).
//   • The Electron overlay window's bounds — and the renderer's CSS pixel space
//     (window.innerWidth, the sprite's position) — are in **DIP**
//     (device-independent pixels). CSS px == DIP for layout.
//
// So to point the companion (which lives in overlay-local CSS px) at a toast the
// watcher found (physical screen px), we:
//   1. physical screen px  ->  DIP screen px      (divide by the display scale)
//   2. DIP screen px       ->  overlay-local px   (subtract the overlay origin)
//
// SCOPE (Phase 5): this is exact for the **primary display**, whose origin is
// (0,0) in both spaces and whose scale we pass in. True multi-monitor with mixed
// per-display scale factors needs per-point resolution (Electron's
// `screen.screenToDipPoint`) and one overlay per display — that's deferred (see
// IMPLEMENTATION_PLAN Phase 5 "convert global screen coords ... important once
// multi-monitor is in play"). Main passes the primary display's scaleFactor and
// the overlay's DIP origin here.

export interface ScreenRect {
  /** Physical-pixel left/top/size as reported by the watcher. */
  x: number
  y: number
  width: number
  height: number
}

export interface LocalRect {
  /** Overlay-window-local CSS px (same space as the sprite position). */
  x: number
  y: number
  width: number
  height: number
}

export interface Point2 {
  x: number
  y: number
}

export function screenPointToLocalPoint(
  point: Point2,
  overlayOriginDip: Point2,
  scaleFactor: number
): Point2 {
  const scale = scaleFactor > 0 ? scaleFactor : 1
  return { x: point.x / scale - overlayOriginDip.x, y: point.y / scale - overlayOriginDip.y }
}

/**
 * Convert a watcher screen rectangle (physical px) into overlay-window-local CSS
 * px. `scaleFactor` is the display's DPI scale (e.g. 1.0, 1.25, 1.5);
 * `overlayOriginDip` is the overlay window's top-left in DIP screen coords (for a
 * primary-display overlay this is typically {x:0, y:0}).
 *
 * Pure: no clamping, no DOM. Callers that need the value on-screen should clamp
 * against the overlay bounds afterwards.
 */
export function screenRectToLocalRect(
  screenRect: ScreenRect,
  overlayOriginDip: Point2,
  scaleFactor: number
): LocalRect {
  // Guard against a bad/zero scale sneaking in (never divide by zero).
  const scale = scaleFactor > 0 ? scaleFactor : 1
  return {
    x: screenRect.x / scale - overlayOriginDip.x,
    y: screenRect.y / scale - overlayOriginDip.y,
    width: screenRect.width / scale,
    height: screenRect.height / scale
  }
}

/** Center point of a local rect (handy for aiming/among tests). */
export function rectCenter(rect: LocalRect): Point2 {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}
