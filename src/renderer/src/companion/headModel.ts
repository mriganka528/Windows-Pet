import type { SpeciesDef } from './species'
import type { CompanionModel, ModelOptions } from './spriteModel'
import { expressionEye, expressionMouth, expressionBeak, angerMark } from './expressionArt'
import { M, L, Q, ell, path, curve, type Prim } from './primitives'
import { volume, tint, alpha, softShadow, furDetail } from './surfaces'

export interface HeadLayout {
  x: number
  y: number
  rx: number
  ry: number
  front: boolean
  earSize: number
}

/** Both orientations share the same cheek, muzzle, eye and ear construction. */
export function buildHead(sp: SpeciesDef, h: HeadLayout, opts: ModelOptions): CompanionModel {
  const p = sp.palette
  const { x, y, rx, ry, front } = h
  const asleep = opts.sleep ?? 0
  const bird = sp.muzzle === 'beak'
  const frog = !!sp.eyesOnTop
  const fluffy = ['cat', 'fox', 'redpanda', 'tiger'].includes(sp.id)
  const anchor = { x: front ? x : x - rx * 0.35, y: y + ry * 0.65 }
  const head: Prim[] = []
  const face: Prim[] = []
  const ear = (near: boolean): Prim[] => {
    if (sp.ears === 'none') return []
    const side = near ? 1 : -1
    const ex = front ? x + side * rx * 0.7 : x + (near ? -rx * 0.5 : rx * 0.38)
    const ey = y - ry * 0.64
    const r = h.earSize * (front || near ? 1 : 0.76)
    const color = sp.id === 'panda' ? sp.markColor! : near || front ? p.fur : p.furDark
    const inner = sp.earInner ?? p.earInner
    const edge = { color: alpha(p.furDarkest, 0.32), width: 0.45 }
    if (sp.ears === 'long') {
      const top = Math.max(2, ey - r * (1 - asleep * 0.65))
      const bend = asleep * (near ? -20 : -13)
      return [
        volume(
          path(
            [
              M(ex - 5, ey + 5),
              Q(ex - 8 + bend, top + 3, ex + bend, top),
              Q(ex + 6 + bend, top - 1, ex + 4, ey + 5)
            ],
            color,
            edge
          )
        ),
        volume(
          path(
            [
              M(ex - 2.7, ey + 1),
              Q(ex - 4 + bend, top + 5, ex + bend, top + 4),
              Q(ex + 2.5 + bend, top + 4, ex + 2.2, ey + 1)
            ],
            inner
          )
        )
      ]
    }
    if (sp.ears === 'floppy' && sp.id !== 'pig') {
      const direction = front ? side : -1
      return [
        volume(
          path(
            [
              M(ex - 5, ey - 2),
              Q(ex + direction * 13, ey - 1, ex + direction * 13, ey + 17),
              Q(ex + direction * 11, ey + 31, ex + direction * 4, ey + 23),
              Q(ex - direction * 1, ey + 14, ex - 5, ey - 2)
            ],
            p.furDark,
            edge
          ),
          p.fur,
          p.furDarkest
        ),
        curve(
          [
            M(ex + direction * 7, ey + 5),
            Q(ex + direction * 11, ey + 14, ex + direction * 7, ey + 22)
          ],
          alpha(p.furLight, 0.4),
          0.6
        )
      ]
    }
    if (sp.ears === 'pointed' || sp.id === 'pig') {
      const top = Math.max(2, ey - r * (sp.id === 'pig' ? 0.58 : 0.9))
      const peak = ex + (front ? side * 3 : 2)
      const folded = sp.id === 'pig'
      const out = [
        volume(
          path(
            [M(ex - 8, ey + 7), Q(ex - 8, top + 4, peak, top), Q(ex + 4, top + 1, ex + 8, ey + 7)],
            color,
            edge
          ),
          p.furLight,
          p.furDark
        ),
        volume(
          path(
            [M(ex - 4.9, ey + 3.5), L(peak, top + 4), Q(ex + 3, top + 4, ex + 4.6, ey + 4)],
            inner
          ),
          tint(inner, '#FFF8EC', 0.32),
          tint(inner, '#875441', 0.3)
        )
      ]
      if (sp.earTip)
        out.push(
          path(
            [
              M(peak, top),
              Q(peak - 3, top + 1, ex - 6, top + 7),
              L(peak, top + 3),
              L(ex + 5, top + 7)
            ],
            sp.earTip
          )
        )
      if (folded)
        out.push(
          volume(
            path(
              [M(peak, top), Q(ex + 9, top + 3, ex + 5, top + 12), Q(ex + 1, top + 8, peak, top)],
              p.furDark
            )
          )
        )
      return out
    }
    const radius = r * (sp.id === 'koala' ? 1 : 0.92)
    return [
      volume(ell(ex + (front ? side * 2 : -2), ey, radius, radius * 0.94, color)),
      volume(
        ell(
          ex + (front ? side * 2 : -2),
          ey + 1,
          radius * 0.65,
          radius * 0.62,
          sp.id === 'panda' ? '#514347' : sp.id === 'koala' ? p.cream : inner
        )
      ),
      ...(sp.id === 'koala'
        ? furDetail(ex + (front ? side * 2 : -2), ey, radius * 0.7, radius * 0.7, p.furLight, 8)
        : [])
    ]
  }
  if (!bird || sp.id === 'chick' || asleep > 0.01) {
    const shape = fluffy
      ? path(
          [
            M(x, y - ry),
            Q(x + rx * 0.85, y - ry, x + rx * 0.95, y - ry * 0.1),
            L(x + rx * 1.04, y + ry * 0.35),
            L(x + rx * 0.89, y + ry * 0.34),
            L(x + rx, y + ry * 0.57),
            L(x + rx * 0.82, y + ry * 0.55),
            Q(x + rx * 0.6, y + ry, x, y + ry),
            Q(x - rx * 0.62, y + ry, x - rx * 0.84, y + ry * 0.57),
            L(x - rx * 1.02, y + ry * 0.6),
            L(x - rx * 0.91, y + ry * 0.38),
            L(x - rx * 1.04, y + ry * 0.4),
            Q(x - rx * 0.99, y - ry, x, y - ry)
          ],
          p.fur
        )
      : ell(x, y, rx, ry, p.fur)
    head.push(volume(shape, p.furLight, p.furDark))
  }
  const eyeY = y + ry * (frog ? -0.4 : 0.04)
  const eyes = front
    ? [
        { x: x - rx * 0.4, side: -1, radius: rx * 0.225 },
        { x: x + rx * 0.4, side: 1, radius: rx * 0.225 }
      ]
    : [
        { x: x + rx * 0.64, side: 1, radius: rx * 0.135 },
        { x: x + rx * 0.04, side: -1, radius: rx * 0.24 }
      ]
  if (frog) {
    for (const eye of eyes)
      head.push(
        volume(ell(eye.x, eyeY, eye.radius + 3.5, eye.radius + 4.5, p.fur), p.furLight, p.furDark)
      )
  }
  if (sp.id === 'penguin') {
    if (front)
      head.push(
        volume(
          path(
            [
              M(x, y + 2),
              Q(x - 7, y - 20, x - 18, y - 9),
              Q(x - 26, y + 7, x - 12, y + 24),
              Q(x, y + 32, x + 12, y + 24),
              Q(x + 26, y + 7, x + 18, y - 9),
              Q(x + 7, y - 20, x, y + 2)
            ],
            p.cream
          ),
          '#FFFDF4',
          p.creamDark
        )
      )
    else
      head.push(
        volume(
          ell(x + rx * 0.2, y + ry * 0.25, rx * 0.72, ry * 0.8, p.cream),
          '#FFFDF5',
          p.creamDark
        )
      )
  }
  if (sp.id === 'panda')
    for (const eye of eyes)
      head.push(
        volume(
          ell(
            eye.x,
            eyeY + 0.6,
            eye.radius + 3,
            eye.radius * 1.4 + 3,
            sp.markColor!,
            undefined,
            eye.side * -0.2
          )
        )
      )
  if (sp.id === 'fox' || sp.id === 'redpanda') {
    head.push(
      volume(
        front
          ? path(
              [
                M(x - rx * 0.98, y + ry * 0.28),
                Q(x - rx * 0.3, y + ry * 0.1, x, y + ry * 0.53),
                Q(x + rx * 0.3, y + ry * 0.1, x + rx * 0.98, y + ry * 0.28),
                Q(x + rx * 0.8, y + ry * 1.05, x, y + ry),
                Q(x - rx * 0.8, y + ry * 1.05, x - rx * 0.98, y + ry * 0.28)
              ],
              p.cream
            )
          : path(
              [
                M(x - rx * 0.75, y + ry * 0.25),
                Q(x + rx * 0.15, y + ry * 0.1, x + rx * 0.45, y + ry * 0.45),
                L(x + rx * 1.02, y + ry * 0.5),
                Q(x + rx * 0.72, y + ry * 1.02, x, y + ry * 0.88),
                Q(x - rx * 0.45, y + ry * 0.8, x - rx * 0.75, y + ry * 0.25)
              ],
              p.cream
            ),
        '#FFFBEE',
        p.creamDark
      )
    )
    if (sp.id === 'redpanda')
      for (const eye of eyes)
        head.push(volume(ell(eye.x, eyeY - eye.radius * 1.5, eye.radius * 0.85, 2.5, p.cream)))
  }
  if (sp.id === 'cat' || sp.id === 'dog') {
    const bx = front ? x : x + rx * 0.57
    head.push(
      volume(
        path(
          [
            M(bx, y - ry * 0.87),
            Q(bx - 7, y - ry * 0.27, bx - 4, y + 4),
            Q(bx, y + 10, bx + 5, y + 3),
            Q(bx + 7, y - ry * 0.22, bx, y - ry * 0.87)
          ],
          p.cream
        ),
        '#FFFDF6',
        p.creamDark
      )
    )
  }
  if (sp.id === 'cat' || sp.id === 'tiger') {
    const stripe = sp.markColor ?? alpha(p.furDarkest, 0.45)
    for (const side of [-1, 1]) {
      const bx = x + side * rx * 0.27
      head.push(
        path(
          [
            M(bx - 1.5, y - ry * 0.86),
            Q(bx + 1, y - ry * 0.5, bx, y - ry * 0.36),
            Q(bx + 5, y - ry * 0.59, bx + 2.5, y - ry * 0.84)
          ],
          stripe
        )
      )
    }
    if (sp.id === 'tiger')
      head.push(path([M(x - 1.8, y - ry + 1), L(x, y - ry * 0.45), L(x + 2, y - ry + 1)], stripe))
  }
  if (!bird && !frog) {
    const mx = front ? x : x + rx * 0.58
    const my = y + ry * 0.58
    const mw = sp.id === 'koala' ? rx * 0.48 : front ? rx * 0.5 : rx * 0.55
    head.push(
      volume(
        path(
          [
            M(mx - mw, my),
            Q(mx - mw * 0.8, my - 8, mx, my - 5),
            Q(mx + mw * 0.85, my - 8, mx + mw, my),
            Q(mx + mw * 0.8, my + 8, mx, my + 7),
            Q(mx - mw * 0.8, my + 8, mx - mw, my)
          ],
          p.cream
        ),
        '#FFFDF5',
        p.creamDark
      )
    )
  }
  if (!frog && sp.id !== 'pig') head.push(...furDetail(x, y, rx * 0.78, ry * 0.87, p.furLight, 11))
  const cheerful = ['happy', 'excited', 'love'].includes(opts.expr)
  if (cheerful || sp.id === 'hamster') {
    for (const eye of eyes)
      head.push({
        ...ell(eye.x + eye.side * 3, eyeY + eye.radius * 1.5, 4.5, 2.8, '#DE9290'),
        gradient: {
          kind: 'radial',
          cx: 0.5,
          cy: 0.5,
          radius: 0.52,
          stops: [
            [0, 'rgba(222,134,137,0.24)'],
            [1, 'rgba(222,134,137,0)']
          ]
        }
      })
  }
  for (const eye of eyes)
    face.push(
      ...expressionEye(sp, opts.expr, eye.x, eyeY, eye.side, {
        radius: eye.radius,
        profile: !front,
        blink: opts.blink,
        closed: asleep > 0.3 || (opts.yawn ?? 0) > 0.2,
        gazeY: opts.lookUp ? -0.15 : 0
      })
    )
  const nx = front ? x : x + rx * 0.95
  const ny = y + ry * 0.56
  if (bird)
    face.push(...expressionBeak(sp, opts.expr, front ? x : x + rx * 0.95, y + ry * 0.57, front))
  else if (frog) {
    face.push(
      ell(front ? x - 4 : x + 12, y + 2, 0.65, 0.8, p.furDark),
      ell(front ? x + 4 : x + 15, y + 2, 0.65, 0.8, p.furDark)
    )
    face.push(
      ...expressionMouth(
        sp,
        opts.expr,
        front ? x : x + 6,
        y + ry * 0.55,
        front ? 10 : 6.5,
        opts.yawn
      )
    )
  } else {
    if (sp.id === 'pig') {
      face.push(
        volume(ell(front ? x : nx - 2, ny, front ? 8 : 5, 5.5, sp.nose), '#EFB7B0', '#B96F76'),
        ell(front ? x - 3.2 : nx - 3, ny, 1.1, 1.7, '#96545B'),
        ell(front ? x + 3.2 : nx, ny, 1.1, 1.7, '#96545B')
      )
    } else if (sp.id === 'koala') {
      face.push(
        volume(
          ell(front ? x : nx - 3, y + ry * 0.35, front ? 6 : 4.5, 8, sp.nose),
          '#736F71',
          '#2D292C'
        )
      )
      face.push(ell((front ? x : nx - 3) - 1.5, y + ry * 0.35 - 3, 1.4, 2, 'rgba(255,255,255,0.2)'))
    } else {
      const n = front ? nx : nx - 0.5
      face.push(
        volume(
          path(
            [
              M(n - 3.4, ny - 1),
              Q(n, ny - 3, n + 3.4, ny - 1),
              Q(n + 3.2, ny + 1.7, n, ny + 2.7),
              Q(n - 3.2, ny + 1.7, n - 3.4, ny - 1)
            ],
            sp.nose
          ),
          tint(sp.nose, '#FFFFFF', 0.2),
          tint(sp.nose, '#161215', 0.35)
        ),
        ell(n - 0.8, ny - 0.8, 1.25, 0.6, 'rgba(255,255,255,0.48)')
      )
      face.push(
        curve([M(n, ny + 2.3), Q(n, ny + 4, n - (front ? 0 : 2), ny + 4.4)], '#704E42', 0.65)
      )
    }
    const mouthX = front ? x : x + rx * 0.68
    const mouthY = ny + (sp.id === 'pig' ? 6 : sp.id === 'koala' ? 4 : 4.5)
    face.push(
      ...expressionMouth(
        sp,
        opts.expr,
        mouthX,
        mouthY,
        sp.id === 'koala' ? 3.6 : front ? 5.7 : 4.4,
        opts.yawn
      )
    )
    if (sp.whiskers) {
      const sides = front ? [-1, 1] : [-1]
      for (const side of sides)
        for (const dy of [-1, 1.6])
          face.push(
            curve(
              [
                M((front ? x : x + rx * 0.5) + side * 7, ny + 3),
                Q(
                  (front ? x : x + rx * 0.5) + side * 12,
                  ny + dy,
                  (front ? x : x + rx * 0.5) + side * 16,
                  ny + dy - 0.5
                )
              ],
              'rgba(100,76,59,0.3)',
              0.45
            )
          )
    }
  }
  if (opts.expr === 'angry' && asleep < 0.3)
    face.push(...angerMark(front ? x : x - rx * 0.35, y - ry * 0.57))
  const earNear = { id: 'earNear' as const, prims: ear(true), anchor, rotation: asleep * 0.12 }
  const result: CompanionModel = [
    { id: 'earFar', prims: ear(false), anchor, rotation: asleep * 0.12 }
  ]
  if (front) result.push(earNear)
  result.push({ id: 'head', prims: head, anchor, rotation: asleep * 0.12 })
  if (!front) result.push(earNear)
  result.push({ id: 'face', prims: face, anchor, rotation: asleep * 0.12 })
  return result
}

export function collar(sp: SpeciesDef, x: number, y: number, front: boolean): Prim[] {
  if (sp.id !== 'dog') return []
  const width = front ? 16 : 11
  return [
    softShadow(x, y + 2, width + 1, 3, 0.14),
    volume(
      path(
        [
          M(x - width, y - 2.5),
          Q(x, y + 2, x + width, y - 3),
          L(x + width, y + 1.5),
          Q(x, y + 7, x - width, y + 1.5)
        ],
        '#A23C2C'
      ),
      '#CB6A45',
      '#6B211F'
    ),
    volume(ell(x + (front ? 0 : 5), y + 6, 3.2, 3.6, '#D6A13D'), '#FFE39A', '#9B6123'),
    ell(x + (front ? -0.6 : 4.4), y + 5, 0.9, 1.2, '#FFEFC0')
  ]
}
