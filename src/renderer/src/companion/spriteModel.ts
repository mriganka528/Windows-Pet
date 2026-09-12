import type { Mood } from './mood'
import type { SpeciesDef } from './species'
import { ANATOMY, footPose, jointBetween, type LegName } from './gait'
import { M, L, Q, ell, path, curve, type Prim } from './primitives'
import { volume, softShadow, furDetail, alpha, tint } from './surfaces'
import { buildHead, collar } from './headModel'
import { NOTIFICATION_PAW } from './notificationPose'
export { M, L, Q, ell, path, curve } from './primitives'
export type { Prim, Stroke, Seg } from './primitives'

export type PartId =
  | 'shadow'
  | 'tail'
  | 'tailFront'
  | LegName
  | 'body'
  | 'earFar'
  | 'earNear'
  | 'head'
  | 'face'
  | 'wing'
  | 'collar'
export interface Part {
  id: PartId
  prims: Prim[]
  anchor?: { x: number; y: number }
  rotation?: number
  opacity?: number
}
export type CompanionModel = Part[]
export interface ModelOptions {
  expr: Mood
  blink?: boolean
  sleep?: number
  phase?: number
  movement?: number
  strideScale?: number
  breath?: number
  paw?: number
  swat?: number
  swatTarget?: { x: number; y: number }
  yawn?: number
  stretch?: number
  dance?: number
  dancePhase?: number
  lookUp?: boolean
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Rounded limbs and padded paws, with a jointed path rather than rigid rods. */
export function limb(
  sp: SpeciesDef,
  hip: { x: number; y: number },
  foot: { x: number; y: number },
  width: number,
  color: string,
  pawColor: string,
  back = false
): Prim[] {
  const knee = jointBetween(
    hip,
    foot,
    Math.max(7, Math.hypot(foot.x - hip.x, foot.y - hip.y) * 0.54),
    back ? 0.5 : -0.25
  )
  const paw = sp.id === 'pig' ? sp.palette.furDarkest : pawColor
  return [
    softShadow(foot.x + 1.2, 93, width + 2, 1.5, 0.08),
    volume(
      path(
        [
          M(hip.x - width, hip.y - 4),
          Q(knee.x - width, knee.y, foot.x - width * 0.78, foot.y - 2),
          Q(foot.x, foot.y + 2, foot.x + width, foot.y - 1),
          Q(knee.x + width, knee.y, hip.x + width, hip.y - 4),
          Q(hip.x, hip.y - width * 1.8, hip.x - width, hip.y - 4)
        ],
        color
      )
    ),
    volume(ell(foot.x + 1.3, foot.y - 1.2, width + 1.5, 4.1, paw)),
    curve(
      [M(foot.x + 1.6, foot.y - 1.7), Q(foot.x + 1, foot.y + 0.4, foot.x + 1.7, foot.y + 1.4)],
      alpha(sp.palette.furDarkest, 0.28),
      0.45
    ),
    curve(
      [M(foot.x + 4.1, foot.y - 1.4), L(foot.x + 4.1, foot.y + 1.3)],
      alpha(sp.palette.furDarkest, 0.22),
      0.4
    )
  ]
}

export function buildModel(sp: SpeciesDef, opts: ModelOptions): CompanionModel {
  const a = ANATOMY[sp.id]
  const p = sp.palette
  const sleep = opts.sleep ?? 0
  const bird = sp.muzzle === 'beak'
  const panda = sp.id === 'panda'
  const frog = !!sp.eyesOnTop
  const move = (opts.movement ?? 0) * (1 - sleep)
  const phase = opts.phase ?? 0
  const cycle = phase % 1
  const air =
    a.gait === 'hop' && cycle > 0.42
      ? Math.sin(((cycle - 0.42) / 0.58) * Math.PI) * 5
      : Math.max(0, Math.sin(phase * Math.PI * 2)) * ((opts.strideScale ?? 1) > 1.4 ? 3 : 0.7)
  const lift = -air * move
  const stretch = (opts.stretch ?? 0) * (1 - sleep)
  const by = lerp(a.bodyY, 75, sleep) + (opts.breath ?? 0) + lift + stretch * 2
  const rx = lerp(a.bodyRX, 29, sleep)
  const ry = lerp(a.bodyRY, 18, sleep)
  const cx = lerp(bird || panda ? 49 : 44, 44, sleep)
  const headX = lerp(a.headX, 73, sleep)
  const headY = lerp(a.headY, 77, sleep) + lift + (opts.breath ?? 0) * 0.5 + stretch * 5
  const headRX = lerp(a.headRX, 19, sleep)
  const headRY = lerp(a.headRY, 15.5, sleep)
  const parts: CompanionModel = [{ id: 'shadow', prims: [softShadow(49, 94, 37, 4.3)] }]
  parts.push({ id: 'tail', prims: tail(sp, by, 0), anchor: { x: 24, y: by }, opacity: 1 - sleep })
  const leg = (id: LegName, near: boolean, front: boolean): Part => {
    const x = (front ? 63 : 31) + (near ? 2 : -4)
    const hip = { x, y: by + ry * 0.15 }
    const step = footPose(phase, id, a, move, opts.strideScale)
    const foot = { x: x + step.x + (front ? stretch * 4 : 0), y: 90 + step.y }
    if (front && near) {
      foot.x = lerp(foot.x, 72, opts.paw ?? 0)
      foot.y = lerp(foot.y, 75, opts.paw ?? 0)
      foot.x = lerp(foot.x, (opts.swatTarget ?? NOTIFICATION_PAW).x - 1.3, opts.swat ?? 0)
      foot.y = lerp(foot.y, (opts.swatTarget ?? NOTIFICATION_PAW).y + 1.2, opts.swat ?? 0)
    }
    foot.x = lerp(foot.x, front ? 70 : 38, sleep)
    foot.y = lerp(foot.y, 89, sleep)
    const dark = sp.id === 'redpanda' || sp.id === 'fox'
    const color = dark ? sp.markColor! : near ? p.fur : p.furDark
    const paw = dark ? color : (sp.pawColor ?? p.fur)
    const prims = limb(sp, hip, foot, a.legWidth * (near ? 1 : 0.84), color, paw, !front)
    if (!front && (sp.id === 'bunny' || frog))
      prims.splice(
        1,
        0,
        volume(ell(hip.x - 1, by + 3, 11, frog ? 10 : 15, near ? p.fur : p.furDark))
      )
    return { id, prims }
  }
  if (!bird && !panda) parts.push(leg('legFarBack', false, false), leg('legFarFront', false, true))
  if (bird) {
    for (const near of [false, true]) {
      const id = near ? 'legNearFront' : 'legFarFront'
      const step = footPose(phase, id, a, move)
      const x = lerp(near ? 57 : 41, near ? 66 : 45, sleep) + step.x * 0.45
      const y = 91 + step.y * 0.7
      parts.push({
        id,
        prims: [
          volume(ell(x, y, 7.5, 3.3, sp.accent!)),
          curve([M(x + 1, y - 1), L(x + 3, y + 1.7)], alpha('#985C20', 0.45), 0.5)
        ]
      })
    }
  }
  if (panda) {
    for (const near of [false, true]) {
      const step = footPose(phase, near ? 'legNearBack' : 'legFarBack', a, move)
      const x = lerp(near ? 58 : 39, near ? 61 : 38, sleep)
      parts.push({
        id: near ? 'legNearBack' : 'legFarBack',
        prims: limb(
          sp,
          { x, y: by + 11 },
          { x: x + step.x * 0.65, y: 90 + step.y },
          6.5,
          sp.markColor!,
          sp.markColor!
        )
      })
    }
    parts.push({
      id: 'legFarFront',
      prims: [volume(ell(cx - 13, by - 5, 7, 13, sp.markColor!, undefined, -0.2))]
    })
  }
  const body: Prim[] = []
  if (bird && sleep < 0.01) {
    if (sp.id === 'penguin')
      body.push(
        volume(
          path(
            [
              M(52, 11),
              Q(29, 9, 29, 33),
              Q(18, 51, 23, 75),
              Q(25, 93, 48, 93),
              Q(77, 94, 80, 68),
              Q(83, 32, 68, 15),
              Q(61, 10, 52, 11)
            ],
            p.fur
          ),
          p.furLight,
          p.furDarkest
        )
      )
    else body.push(volume(ell(cx, by, rx, ry, p.fur), p.furLight, p.furDark))
  } else {
    const color = panda ? tint(sp.markColor!, p.fur, sleep) : p.fur
    const shape =
      !bird && !frog && !panda && sleep < 0.01
        ? path(
            [
              M(cx - rx, by),
              Q(cx - rx, by - ry, cx + 1, by - ry),
              Q(cx + 15, by - ry, headX - 10, headY + 8),
              Q(headX + 1, headY + 11, headX - 4, by + ry * 0.5),
              Q(headX - 11, by + ry + 1, cx + 1, by + ry),
              Q(cx - rx, by + ry, cx - rx, by)
            ],
            color
          )
        : ell(cx, by, rx, ry, color)
    body.push(
      volume(
        shape,
        panda ? tint('#53525A', '#FFFFFF', sleep) : p.furLight,
        panda ? tint('#171820', p.furDark, sleep) : p.furDark
      )
    )
  }
  if (panda)
    body.push(volume(ell(cx + 2, by + 2, rx * 0.73, ry * 0.86, p.cream), '#FFFEF7', p.creamDark))
  else if (sp.belly !== 'none')
    body.push(
      volume(
        ell(
          cx + (bird ? 7 : 9) + sleep * 10,
          by + ry * 0.35,
          rx * (bird ? 0.67 : 0.58) * (1 - sleep * 0.68),
          ry * 0.68 * (1 - sleep * 0.3),
          sp.bellyColor ?? p.cream
        ),
        '#FFFDF3',
        p.creamDark
      )
    )
  if (sp.id === 'cat' || sp.id === 'tiger') {
    for (const [i, x] of [31, 41, 51].entries())
      body.push(
        path(
          [
            M(x - 2, by - ry + 1),
            Q(x + 4, by - 5, x + 1, by + 2 + i),
            Q(x + 9, by - 4, x + 3, by - ry + 1)
          ],
          sp.markColor ?? alpha(p.furDarkest, 0.38)
        )
      )
  }
  if (frog)
    for (const [x, y] of [
      [32, -6],
      [40, -9],
      [47, -4]
    ])
      body.push(volume(ell(x, by + y, 3, 1.8, p.furDark)))
  if (!frog && sp.id !== 'pig') body.push(...furDetail(cx, by, rx * 0.8, ry * 0.83, p.furLight, 10))
  parts.push({ id: 'body', prims: body })
  if (!bird && !panda) parts.push(leg('legNearBack', true, false), leg('legNearFront', true, true))
  if (panda) {
    const hand = {
      x: lerp(71 + Math.sin(phase * Math.PI * 2) * move * 4, 72, sleep),
      y: lerp(by + 7, 87, sleep)
    }
    hand.x = lerp(hand.x, 77, opts.paw ?? 0)
    hand.y = lerp(hand.y, by - 4, opts.paw ?? 0)
    hand.x = lerp(hand.x, (opts.swatTarget ?? NOTIFICATION_PAW).x - 1.3, opts.swat ?? 0)
    hand.y = lerp(hand.y, (opts.swatTarget ?? NOTIFICATION_PAW).y + 1.2, opts.swat ?? 0)
    parts.push({
      id: 'legNearFront',
      prims: limb(
        sp,
        { x: 62, y: lerp(by - 15, by + 4, sleep) },
        hand,
        6.5,
        sp.markColor!,
        sp.markColor!
      )
    })
  }
  if (sp.id === 'dog')
    parts.push({
      id: 'collar',
      prims: collar(sp, headX - 5, headY + headRY - 2 - sleep * 7, false),
      opacity: 1 - sleep * 0.75
    })
  if (sleep > 0) parts.push({ id: 'tailFront', prims: tail(sp, by, 1), opacity: sleep })
  parts.push({
    id: 'body',
    prims: [softShadow(headX - 5, headY + headRY - 0.5, headRX * 0.68, 3.5, 0.13)]
  })
  parts.push(
    ...buildHead(
      sp,
      { x: headX, y: headY, rx: headRX, ry: headRY, front: false, earSize: a.earSize },
      opts
    )
  )
  if (bird) {
    const wing = volume(
      sleep > 0.5
        ? ell(cx - 10, by + 4, 12, 8, p.furDark, undefined, -0.2)
        : path(
            [
              M(35, by - 17),
              Q(23, by - 8, 29, by + 16),
              Q(39, by + 26, 42, by + 9),
              Q(42, by - 7, 35, by - 17)
            ],
            p.furDark
          ),
      p.fur,
      p.furDarkest
    )
    parts.push({
      id: 'wing',
      prims: [
        wing,
        curve([M(30, by + 7), Q(32, by + 15, 35, by + 18)], alpha(p.furLight, 0.2), 0.6)
      ],
      anchor: { x: 35, y: by - 14 },
      rotation: sleep * -0.15
    })
  }
  return parts
}

/** Species-appropriate tails have their own volume and visible root attachment. */
export function tail(sp: SpeciesDef, y: number, sleep: number, front = false): Prim[] {
  const p = sp.palette
  const rootX = front ? 34 : 24
  if (sp.tail === 'none') return []
  if (sp.tail === 'stub')
    return [
      volume(
        ell(
          front ? 29 : 18,
          y + 2,
          sp.id === 'bunny' ? 6.5 : sp.id === 'hamster' ? 2.5 : 4.5,
          sp.id === 'bunny' ? 6 : 3.5,
          sp.tailAccent ?? p.fur
        )
      )
    ]
  if (sp.tail === 'feather')
    return [volume(path([M(35, 80), Q(25, 81, 21, 89), Q(29, 91, 40, 87)], p.furDark))]
  if (sp.id === 'pig')
    return [
      curve(
        [
          M(rootX, y),
          Q(rootX - 12, y - 4, rootX - 10, y - 12),
          Q(rootX - 3, y - 17, rootX - 2, y - 10),
          Q(rootX - 6, y - 5, rootX - 10, y - 9)
        ],
        p.furDark,
        2.6
      ),
      curve([M(rootX, y - 0.4), Q(rootX - 11, y - 5, rootX - 9, y - 12)], p.furLight, 1)
    ]
  if (sleep > 0.5) {
    const bushy = sp.tail === 'bushy' || sp.tail === 'ring'
    const prims = [
      volume(
        path(
          [
            M(20, 69),
            Q(9, 91, 32, 94),
            Q(53, 98, 68, 88),
            Q(56, 94 - (bushy ? 11 : 5), 38, 87),
            Q(23, 87, 25, 74)
          ],
          p.fur
        ),
        p.furLight,
        p.furDark
      )
    ]
    if (sp.tailAccent)
      prims.push(
        volume(
          path([M(55, 85), Q(60, 86, 68, 88), Q(61, 94, 51, 94), Q(56, 90, 55, 85)], sp.tailAccent)
        )
      )
    return prims
  }
  if (sp.tail === 'bushy' || sp.tail === 'ring') {
    const tipY = Math.max(8, y - 44)
    const prims: Prim[] = [
      volume(
        path(
          [
            M(rootX + 4, y + 3),
            Q(3, y - 1, 6, y - 24),
            Q(8, tipY + 6, 14, tipY),
            L(15, tipY + 6),
            L(18, tipY + 3),
            Q(29, tipY + 15, 21, y - 18),
            Q(16, y - 1, rootX + 4, y + 3)
          ],
          p.fur
        ),
        p.furLight,
        p.furDark
      )
    ]
    if (sp.tailAccent)
      prims.push(
        volume(
          path(
            [
              M(6.5, tipY + 21),
              Q(7, tipY + 9, 14, tipY),
              L(15, tipY + 6),
              L(18, tipY + 3),
              Q(23, tipY + 9, 22, tipY + 18),
              L(18, tipY + 16),
              L(14, tipY + 21),
              L(11, tipY + 18)
            ],
            sp.tailAccent
          )
        )
      )
    if (sp.tail === 'ring')
      for (const offset of [27, 35, 43])
        prims.push(
          curve(
            [M(8, tipY + offset - 1), Q(12, tipY + offset + 2, 19, tipY + offset - 1)],
            sp.tailAccent!,
            3.5
          )
        )
    prims.push(...furDetail(14, tipY + 24, 7, 14, p.furLight, 7))
    return prims
  }
  const rise = sp.id === 'mouse' ? 30 : 34
  const color = sp.id === 'mouse' ? '#CFAFAB' : p.fur
  const width = sp.id === 'mouse' ? 2.3 : 5
  const d = [M(rootX, y - 1), Q(5, y - 7, 10, y - rise), Q(14, y - rise - 8, 15, y - rise - 12)]
  const out: Prim[] = [
    curve(d, tint(color, '#362B28', 0.25), width + 1.2),
    curve(d, color, width),
    curve([M(rootX - 1, y - 2), Q(7, y - 9, 11, y - rise)], tint(color, '#FFF8E7', 0.35), 1.3)
  ]
  if (sp.tailAccent)
    out.push(
      curve(
        [M(10.5, y - rise - 1), Q(14, y - rise - 8, 15, y - rise - 12)],
        sp.tailAccent,
        width + 0.2
      )
    )
  if (sp.id === 'tiger')
    for (const offset of [12, 21, 30])
      out.push(curve([M(8, y - offset), L(12.7, y - offset + 0.8)], sp.markColor!, 2))
  return out
}
