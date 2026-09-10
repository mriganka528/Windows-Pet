export interface Stroke {
  color: string
  width: number
  cap?: 'round' | 'butt'
}
export interface Gradient {
  kind: 'radial' | 'linear'
  stops: [number, string][]
  cx?: number
  cy?: number
  radius?: number
}
export type Seg =
  | { t: 'M'; x: number; y: number }
  | { t: 'L'; x: number; y: number }
  | { t: 'Q'; cx: number; cy: number; x: number; y: number }
export type Prim =
  | {
      k: 'ellipse'
      cx: number
      cy: number
      rx: number
      ry: number
      rot?: number
      fill?: string
      stroke?: Stroke
      gradient?: Gradient
    }
  | { k: 'path'; d: Seg[]; closed?: boolean; fill?: string; stroke?: Stroke; gradient?: Gradient }
export const M = (x: number, y: number): Seg => ({ t: 'M', x, y })
export const L = (x: number, y: number): Seg => ({ t: 'L', x, y })
export const Q = (cx: number, cy: number, x: number, y: number): Seg => ({ t: 'Q', cx, cy, x, y })
export const ell = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fill: string,
  stroke?: Stroke,
  rot = 0
): Prim => ({ k: 'ellipse', cx, cy, rx, ry, fill, stroke, rot })
export const path = (d: Seg[], fill?: string, stroke?: Stroke, closed = true): Prim => ({
  k: 'path',
  d,
  fill,
  stroke,
  closed
})
export const curve = (d: Seg[], color: string, width = 1): Prim =>
  path(d, undefined, { color, width }, false)
