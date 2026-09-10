import type { SpeciesDef } from './species'
import { ANATOMY } from './gait'
import { buildHead, collar } from './headModel'
import { limb, tail, type CompanionModel, type ModelOptions } from './spriteModel'
import { M, L, Q, ell, path, curve, type Prim } from './primitives'
import { volume, softShadow, furDetail, alpha } from './surfaces'

export function frontHeadY(sp: SpeciesDef): number {
  return ANATOMY[sp.id].frontHeadY
}

/** A seated, padded silhouette for smiles, paw gestures, dance and webcam poses. */
export function buildFrontModel(sp: SpeciesDef, opts: ModelOptions): CompanionModel {
  const a = ANATOMY[sp.id]
  const p = sp.palette
  const bird = sp.muzzle === 'beak'
  const frog = !!sp.eyesOnTop
  const panda = sp.id === 'panda'
  const round = ['panda', 'bear', 'koala', 'hamster'].includes(sp.id)
  const by = frog ? 76 : bird ? (sp.id === 'penguin' ? 58 : 66) : 70
  const rx = frog ? 25 : bird ? 27 : round ? 24 : 21
  const ry = frog ? 16 : bird ? (sp.id === 'penguin' ? 35 : 26) : round ? 23 : 22
  const hy = a.frontHeadY + (opts.breath ?? 0) * 0.5
  const parts: CompanionModel = [
    { id: 'shadow', prims: [softShadow(50, 94, 34, 4)] },
    { id: 'tail', prims: tail(sp, by, 0, true), anchor: { x: 34, y: by } }
  ]
  const dark = panda || sp.id === 'redpanda' || sp.id === 'fox'
  const legColor = dark ? sp.markColor! : p.fur
  if (!bird)
    for (const side of [-1, 1]) {
      parts.push({
        id: side < 0 ? 'legFarBack' : 'legFarFront',
        prims: [
          volume(
            ell(
              50 + side * (rx - 5),
              80,
              frog ? 12 : 10,
              frog ? 10 : 13,
              panda ? legColor : p.furDark
            )
          ),
          volume(ell(50 + side * (rx - 3), 89, 7.5, 4.5, panda ? legColor : p.fur))
        ]
      })
    }
  const silhouette =
    sp.id === 'penguin'
      ? path(
          [
            M(50, 8),
            Q(27, 6, 24, 32),
            Q(18, 50, 20, 75),
            Q(25, 96, 50, 94),
            Q(78, 96, 81, 75),
            Q(84, 46, 75, 27),
            Q(71, 7, 50, 8)
          ],
          p.fur
        )
      : ell(50, by + (opts.breath ?? 0), rx, ry, panda ? sp.markColor! : p.fur)
  const body: Prim[] = [
    volume(silhouette, panda ? '#53535D' : p.furLight, panda ? '#181922' : p.furDark)
  ]
  if (sp.belly !== 'none')
    body.push(
      volume(
        ell(50, by + (bird ? 6 : 2), rx * 0.7, ry * 0.81, sp.bellyColor ?? p.cream),
        '#FFFEF4',
        p.creamDark
      )
    )
  if (sp.id === 'fox' || sp.id === 'cat' || sp.id === 'dog')
    body.push(
      volume(
        path(
          [
            M(37, 52),
            Q(50, 48, 63, 52),
            Q(62, 64, 56, 67),
            L(54, 64),
            L(50, 70),
            L(47, 65),
            L(44, 68),
            Q(37, 62, 37, 52)
          ],
          p.cream
        ),
        '#FFFEF4',
        p.creamDark
      )
    )
  if (sp.id === 'tiger' || sp.id === 'cat')
    for (const side of [-1, 1])
      body.push(
        path(
          [
            M(50 + side * rx, 67),
            Q(50 + side * (rx - 4), 69, 50 + side * (rx - 7), 73),
            Q(50 + side * (rx - 2), 72, 50 + side * rx, 70)
          ],
          sp.markColor ?? alpha(p.furDarkest, 0.3)
        )
      )
  if (!frog && sp.id !== 'pig') body.push(...furDetail(50, by, rx * 0.8, ry * 0.82, p.furLight, 8))
  body.push(softShadow(50, hy + a.frontHeadRY + 0.5, a.frontHeadRX * 0.68, 3.5, 0.16))
  parts.push({ id: 'body', prims: body })
  for (const side of [-1, 1]) {
    const walk =
      Math.sin((opts.phase ?? 0) * Math.PI * 2 + (side < 0 ? 0 : Math.PI)) * (opts.movement ?? 0)
    const dance =
      Math.max(0, Math.sin((opts.dancePhase ?? 0) + (side < 0 ? 0 : Math.PI))) * (opts.dance ?? 0)
    const foot = {
      x: 50 + side * (bird ? 10 : panda ? 10 : 8.5),
      y: 90 - Math.max(0, walk) * 3 - dance * 4
    }
    if (bird) {
      parts.push({
        id: side < 0 ? 'legNearBack' : 'legNearFront',
        prims: [
          volume(ell(foot.x, foot.y + 1, 7.5, 3.4, sp.accent!), '#FFD071', '#BC761E'),
          curve([M(foot.x, foot.y), L(foot.x + 1, foot.y + 3)], alpha('#9F672B', 0.34), 0.45)
        ]
      })
      const wx = 50 + side * 25
      parts.push({
        id: 'wing',
        prims: [
          volume(
            path(
              [
                M(wx, by - 19),
                Q(wx + side * 9, by - 8, wx + side * 8, by + 10),
                Q(wx + side * 4, by + 21, wx - side * 2, by + 12),
                Q(wx - side * 4, by - 5, wx, by - 19)
              ],
              p.furDark
            ),
            p.fur,
            p.furDarkest
          )
        ],
        anchor: { x: wx, y: by - 16 },
        rotation: side * ((opts.paw ?? 0) * 0.16 + dance * 0.12)
      })
    } else if (panda) {
      parts.push({
        id: side < 0 ? 'legNearBack' : 'legFarBack',
        prims: [volume(ell(foot.x, foot.y, 8, 5, sp.markColor!))]
      })
      const hand = { x: 50 + side * 21, y: 77 - dance * 3 }
      if (side > 0) {
        hand.x += (opts.paw ?? 0) * 4
        hand.y -= (opts.paw ?? 0) * 12
        hand.x += (82 - hand.x) * (opts.swat ?? 0)
        hand.y += (80 - hand.y) * (opts.swat ?? 0)
      }
      parts.push({
        id: side < 0 ? 'legFarFront' : 'legNearFront',
        prims: limb(sp, { x: 50 + side * 19, y: 56 }, hand, 6.5, sp.markColor!, sp.markColor!)
      })
    } else {
      if (side > 0) {
        foot.x += (opts.paw ?? 0) * 7
        foot.y -= (opts.paw ?? 0) * 14
        foot.x += (82 - foot.x) * (opts.swat ?? 0)
        foot.y += (80 - foot.y) * (opts.swat ?? 0)
      }
      parts.push({
        id: side < 0 ? 'legNearBack' : 'legNearFront',
        prims: limb(
          sp,
          { x: 50 + side * 10, y: frog ? 72 : 67 },
          foot,
          frog ? 5 : 5.2,
          legColor,
          sp.pawColor ?? legColor
        )
      })
    }
  }
  if (sp.id === 'dog')
    parts.push({ id: 'collar', prims: collar(sp, 50, hy + a.frontHeadRY - 1, true) })
  parts.push(
    ...buildHead(
      sp,
      { x: 50, y: hy, rx: a.frontHeadRX, ry: a.frontHeadRY, front: true, earSize: a.earSize },
      opts
    )
  )
  return parts
}
