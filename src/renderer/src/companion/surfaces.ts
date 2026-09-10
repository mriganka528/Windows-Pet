import { ell, curve, M, Q, type Prim } from './primitives'

/** Small, deterministic color operations keep every coat compatible with the art. */
export function tint(color: string, toward: string, amount: number): string {
  if (!/^#[\da-f]{6}$/i.test(color)) return color
  return (
    '#' +
    [1, 3, 5]
      .map((i) =>
        Math.round(
          parseInt(color.slice(i, i + 2), 16) * (1 - amount) +
            parseInt(toward.slice(i, i + 2), 16) * amount
        )
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  )
}

export function alpha(color: string, opacity: number): string {
  if (!/^#[\da-f]{6}$/i.test(color)) return color
  return `rgba(${[1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)).join(',')},${opacity})`
}

/** Elliptical light falloff gives each cheek, limb and body its own soft volume. */
export function volume(primitive: Prim, light?: string, dark?: string): Prim {
  if (!primitive.fill) return primitive
  const base = primitive.fill
  const highlight = light ?? tint(base, '#FFFDF5', 0.26)
  const shade = dark ?? tint(base, '#31251F', 0.32)
  return {
    ...primitive,
    stroke: primitive.stroke ?? {
      color: alpha(dark ?? tint(base, '#31251F', 0.32), 0.14),
      width: 0.35
    },
    gradient: {
      kind: 'radial',
      cx: 0.3,
      cy: 0.22,
      radius: 0.72,
      stops: [
        [0, highlight],
        [0.22, tint(base, highlight, 0.35)],
        [0.45, base],
        [0.76, tint(base, shade, 0.6)],
        [1, shade]
      ]
    }
  }
}

export function softShadow(cx: number, cy: number, rx: number, ry: number, opacity = 0.16): Prim {
  return {
    ...ell(cx, cy, rx, ry, '#493B30'),
    gradient: {
      kind: 'radial',
      cx: 0.5,
      cy: 0.5,
      radius: 0.52,
      stops: [
        [0, `rgba(43,32,23,${opacity})`],
        [0.55, `rgba(43,32,23,${opacity * 0.45})`],
        [1, 'rgba(43,32,23,0)']
      ]
    }
  }
}

/** A few short, curved fibers give the cheeks and shoulders a soft fur edge. */
export function furDetail(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
  count = 9
): Prim[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = Math.PI * (1.1 + (i / count) * 0.82)
    const x = cx + Math.cos(angle) * rx
    const y = cy + Math.sin(angle) * ry
    return curve([M(x, y), Q(x - 0.6, y + 1.3, x - 0.1, y + 2.2)], alpha(color, 0.2), 0.45)
  })
}

export function primitiveBounds(primitive: Prim): {
  x: number
  y: number
  width: number
  height: number
} {
  if (primitive.k === 'ellipse')
    return {
      x: primitive.cx - primitive.rx,
      y: primitive.cy - primitive.ry,
      width: primitive.rx * 2,
      height: primitive.ry * 2
    }
  const points = primitive.d.flatMap((s) => (s.t === 'Q' ? [{ x: s.cx, y: s.cy }, s] : [s]))
  const left = Math.min(...points.map((p) => p.x))
  const top = Math.min(...points.map((p) => p.y))
  return {
    x: left,
    y: top,
    width: Math.max(0.01, Math.max(...points.map((p) => p.x)) - left),
    height: Math.max(0.01, Math.max(...points.map((p) => p.y)) - top)
  }
}
