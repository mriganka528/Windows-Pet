import type { Mood } from './mood'
import type { SpeciesDef } from './species'
import { M, L, Q, ell, path, curve, type Prim } from './primitives'
import { volume, alpha, tint } from './surfaces'

const INK = '#453029'
const MOUTH = '#64352F'
const TONGUE = '#EBA3AA'

/** Layered irises, a dark pupil and two reflections replace flat dot eyes. */
function glossyEye(
  sp: SpeciesDef,
  x: number,
  y: number,
  radius: number,
  height: number,
  gazeY: number
): Prim[] {
  const iris = sp.eyesOnTop
    ? '#607249'
    : sp.id === 'cat' || sp.id === 'tiger'
      ? '#806239'
      : '#67452F'
  const outline = { color: '#3C2C25', width: 0.35 }
  const r = radius
  return [
    volume(ell(x, y, r + 0.25, height + 0.3, '#FFF5DB', outline), '#FFFFF8', '#BBAE94'),
    {
      ...ell(x + 0.1, y + 0.1, r * 0.98, height, iris),
      gradient: {
        kind: 'radial',
        cx: 0.56,
        cy: 0.8,
        radius: 0.72,
        stops: [
          [0, tint(iris, '#EBC879', 0.2)],
          [0.46, iris],
          [0.82, '#2C211D'],
          [1, '#161418']
        ]
      }
    },
    volume(ell(x + 0.1, y + gazeY * r, r * 0.66, height * 0.8, '#131319'), '#28242A', '#090A0D'),
    ell(x - r * 0.33, y - height * 0.37, r * 0.29, height * 0.3, '#FFFFFF', undefined, 0.14),
    ell(x + r * 0.31, y + height * 0.32, r * 0.115, height * 0.12, 'rgba(255,255,255,0.82)'),
    curve(
      [M(x - r * 0.36, y + height * 0.72), Q(x, y + height * 0.84, x + r * 0.4, y + height * 0.63)],
      'rgba(185,211,219,0.48)',
      0.45
    )
  ]
}

export function expressionEye(
  sp: SpeciesDef,
  mood: Mood,
  x: number,
  y: number,
  side: number,
  options: {
    blink?: boolean
    closed?: boolean
    profile?: boolean
    radius?: number
    gazeY?: number
  } = {}
): Prim[] {
  const r = options.radius ?? 5
  const ink = sp.id === 'panda' ? '#A6A09A' : alpha(INK, 0.84)
  const closed =
    options.closed || mood === 'sleepy' || (options.blink && mood !== 'angry' && mood !== 'alert')
  if (closed || mood === 'love')
    return [
      curve(
        [
          M(x - r * 0.9, y),
          Q(x, y + (mood === 'love' && !closed ? -r * 0.65 : r * 0.48), x + r * 0.9, y)
        ],
        ink,
        1.15
      ),
      ...(mood === 'sleepy'
        ? [
            curve(
              [M(x + side * r * 0.85, y + 0.1), L(x + side * r * 1.03, y + 0.9)],
              alpha(INK, 0.52),
              0.6
            )
          ]
        : [])
    ]
  const squint = mood === 'angry' ? 0.54 : mood === 'grumpy' ? 0.5 : mood === 'chill' ? 0.58 : 1
  const excited = mood === 'excited'
  const curious = mood === 'curious'
  const height =
    r *
    (excited
      ? 1.27
      : mood === 'alert' || mood === 'surprised'
        ? 1.21
        : curious && side > 0 && !options.profile
          ? 0.97
          : 1.12) *
    squint
  const eye = glossyEye(sp, x, y + (squint < 1 ? r * 0.3 : 0), r, height, options.gazeY ?? 0)
  if (mood === 'angry' || mood === 'grumpy') {
    const angry = mood === 'angry'
    eye.push(
      curve(
        [
          M(x + side * r * 1.05, y - r * (angry ? 0.85 : 0.65)),
          Q(x, y - r * 0.62, x - side * r * 0.92, y - r * (angry ? 0.08 : 0.2))
        ],
        ink,
        angry ? 1.8 : 1.15
      )
    )
    eye.push(
      curve(
        [M(x - r * 0.92, y - r * 0.08), Q(x, y - r * 0.28, x + r * 0.92, y - r * 0.08)],
        ink,
        0.85
      )
    )
  } else if (mood === 'chill') {
    eye.push(
      curve(
        [M(x - r * 0.92, y - r * 0.17), Q(x, y + r * 0.08, x + r * 0.92, y - r * 0.17)],
        ink,
        0.9
      )
    )
    eye.push(
      curve(
        [M(x - r * 0.8, y - r * 0.7), Q(x, y - r * 0.5, x + r * 0.8, y - r * 0.7)],
        alpha(INK, 0.4),
        0.65
      )
    )
  } else if (curious)
    eye.push(
      curve(
        side < 0 || options.profile
          ? [M(x - r * 0.8, y - r * 1.25), Q(x, y - r * 1.95, x + r * 0.8, y - r * 1.35)]
          : [M(x - r * 0.8, y - r * 1.22), Q(x, y - r * 1.28, x + r * 0.8, y - r * 1.1)],
        ink,
        0.9
      )
    )
  else if (mood === 'alert')
    eye.push(curve([M(x - r * 0.8, y - r * 1.55), L(x + r * 0.8, y - r * 1.55)], ink, 0.95))
  else if (mood !== 'neutral')
    eye.push(
      curve(
        [
          M(x - r * 0.75, y - r * 1.32),
          Q(x, y - r * (excited ? 1.8 : 1.62), x + r * 0.75, y - r * 1.32)
        ],
        alpha(INK, 0.65),
        0.8
      )
    )
  return eye
}

function openSmile(x: number, y: number, w: number, height: number): Prim[] {
  return [
    volume(
      path(
        [
          M(x - w, y - 0.6),
          Q(x, y + 1, x + w, y - 0.6),
          Q(x + w * 0.65, y + height, x, y + height),
          Q(x - w * 0.65, y + height, x - w, y - 0.6)
        ],
        MOUTH
      ),
      '#874B42',
      '#2E1B22'
    ),
    volume(
      ell(x + w * 0.1, y + height * 0.78, w * 0.48, height * 0.24, TONGUE),
      '#F5C5C8',
      '#C37783'
    ),
    curve([M(x - w, y - 0.6), Q(x, y + 1, x + w, y - 0.6)], alpha(INK, 0.65), 0.7)
  ]
}

/** Softer smiles retain a different mouth silhouette for each resting mood. */
export function expressionMouth(
  sp: SpeciesDef,
  mood: Mood,
  x: number,
  y: number,
  width: number,
  yawn = 0
): Prim[] {
  const w = width
  if (yawn > 0.15)
    return [volume(ell(x, y + 1, w * 0.5, 1.2 + yawn * 3.5, MOUTH), '#865349', '#35222A')]
  switch (mood) {
    case 'excited':
      return openSmile(x, y, w, 5)
    case 'happy':
      return sp.id === 'dog' || sp.id === 'panda'
        ? openSmile(x, y, w * 0.82, 3.4)
        : [
            curve([M(x - w * 0.85, y), Q(x, y + 3.4, x + w * 0.85, y)], alpha(INK, 0.9), 0.9),
            ell(x - w * 0.83, y + 0.05, 0.45, 0.55, alpha(INK, 0.4)),
            ell(x + w * 0.83, y + 0.05, 0.45, 0.55, alpha(INK, 0.4))
          ]
    case 'love':
      return openSmile(x, y, w * 0.75, 3)
    case 'curious':
      return [volume(ell(x + 0.5, y + 1.1, w * 0.33, 2, MOUTH), '#996155', '#36232A')]
    case 'alert':
      return [
        curve(
          [M(x - w * 0.6, y + 0.7), Q(x, y + 0.25, x + w * 0.6, y + 0.7)],
          alpha(INK, 0.84),
          0.9
        )
      ]
    case 'chill':
      return [
        curve(
          [M(x - w * 0.6, y + 0.1), Q(x, y + 1.8, x + w * 0.8, y - 0.3)],
          alpha(INK, 0.75),
          0.85
        )
      ]
    case 'sleepy':
      return [
        curve(
          [M(x - w * 0.4, y + 0.2), Q(x, y + 1.1, x + w * 0.4, y + 0.2)],
          alpha(INK, 0.62),
          0.75
        )
      ]
    case 'grumpy':
      return [
        curve([M(x - w * 0.8, y + 1.6), Q(x, y - 1.6, x + w * 0.8, y + 1.6)], alpha(INK, 0.88), 1),
        curve([M(x - w * 0.25, y + 3), Q(x, y + 3.5, x + w * 0.25, y + 3)], alpha(INK, 0.35), 0.6)
      ]
    case 'angry':
      return sp.eyesOnTop
        ? [
            volume(
              path([M(x - w, y + 1), Q(x, y - 3, x + w, y + 1), Q(x, y + 4, x - w, y + 1)], MOUTH)
            )
          ]
        : [
            volume(
              path(
                [
                  M(x - w * 0.9, y + 1),
                  Q(x, y - 1.8, x + w * 0.9, y + 1),
                  L(x + w * 0.74, y + 3),
                  Q(x, y + 2, x - w * 0.74, y + 3)
                ],
                '#FFF7E2',
                { color: alpha(INK, 0.9), width: 0.8 }
              )
            ),
            curve([M(x - w * 0.28, y + 0.2), L(x - w * 0.28, y + 2.2)], alpha(INK, 0.7), 0.55),
            curve([M(x + w * 0.28, y + 0.2), L(x + w * 0.28, y + 2.2)], alpha(INK, 0.7), 0.55)
          ]
    case 'surprised':
      return [volume(ell(x, y + 1, w * 0.45, 2.8, MOUTH))]
    default:
      return [
        curve(
          [M(x - w * 0.5, y + 0.3), Q(x, y + 1.1, x + w * 0.5, y + 0.3)],
          alpha(INK, 0.65),
          0.75
        )
      ]
  }
}

export function expressionBeak(
  sp: SpeciesDef,
  mood: Mood,
  x: number,
  y: number,
  front: boolean
): Prim[] {
  const open =
    mood === 'excited' || mood === 'surprised'
      ? 2.8
      : mood === 'angry'
        ? 1.8
        : mood === 'happy'
          ? 0.7
          : 0
  if (front)
    return [
      ...(open ? [volume(ell(x, y + 2, 3.7, open + 1, MOUTH))] : []),
      volume(
        path(
          [M(x - 6, y + 0.4), Q(x, y - 5, x + 6, y + 0.4), Q(x, y + 3.7, x - 6, y + 0.4)],
          sp.nose
        ),
        '#FFD576',
        '#BA741C'
      ),
      volume(
        path([M(x - 4.1, y + open + 1.7), Q(x, y + open + 5.4, x + 4.1, y + open + 1.7)], sp.nose),
        '#FEC868',
        '#BA741C'
      ),
      ell(x - 1.6, y - 0.5, 1.7, 0.65, 'rgba(255,245,193,0.6)')
    ]
  return [
    ...(open ? [path([M(x - 3, y + 1), L(x + 8, y + 1.5), L(x - 2, y + open + 4)], MOUTH)] : []),
    volume(
      path(
        [M(x - 5, y - 2), Q(x + 2, y - 2.6, x + 8, y + 1.5), Q(x + 1, y + 3.3, x - 4, y + 3)],
        sp.nose
      ),
      '#FFD576',
      '#BA741C'
    ),
    volume(
      path(
        [M(x - 3, y + open + 2), L(x + 6, y + open + 1.8), Q(x, y + open + 5, x - 3, y + open + 2)],
        sp.nose
      ),
      '#FEC868',
      '#BA741C'
    )
  ]
}

export function angerMark(x: number, y: number): Prim[] {
  return [
    curve(
      [M(x - 2.5, y - 1.6), Q(x, y - 1.5, x, y + 0.4), Q(x, y - 1.5, x + 2.5, y - 1.6)],
      '#D14B40',
      1.15
    ),
    curve(
      [M(x - 2.5, y + 2.7), Q(x - 0.6, y + 2.7, x, y + 1), Q(x + 0.6, y + 2.7, x + 2.5, y + 2.7)],
      '#D14B40',
      1.15
    )
  ]
}
