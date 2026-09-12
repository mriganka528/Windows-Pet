import { useEffect, useRef } from 'react'
import type { Facing } from './motion'
import type { Mood } from './mood'
import type { SpritePalette } from '../../../shared/settings'
import type { SpeciesDef } from './species'
import { buildModel, type Prim } from './spriteModel'
import { buildFrontModel } from './frontModel'
import { wantsFrontPose } from './presentation'
import { ANATOMY } from './gait'
import { primitiveBounds } from './surfaces'
import { furPattern } from './furTexture'
import { initialActivity, stepActivity, actionProgress } from './activity'
import { SWAT_DURATION } from './notificationPose'

export interface SpriteCanvasProps {
  size: number
  facing: Facing
  expression: Mood
  species: SpeciesDef
  palette: SpritePalette
  dragging: boolean
  idle: boolean
  energy?: number
  reducedMotion?: boolean
  moving?: boolean
  frontFacing?: boolean
  /** Cumulative movement in CSS pixels; dragging and resize never add distance. */
  distanceTravelled?: number
  sleeping?: boolean
  frozen?: boolean
  /** Picker thumbnails render once instead of running fifteen animation loops. */
  still?: boolean
  gesturing?: boolean
  swatNonce?: number
  swatting?: boolean
  swatTarget?: { x: number; y: number }
  onSwatContact?: (nonce: number) => void
  dancing?: boolean
  beatNonce?: number
  danceTempo?: number
  posing?: boolean
  hopNonce?: number
}

const TAU = Math.PI * 2
const smooth = (current: number, target: number, rate: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-rate * dt))

export function SpriteCanvas(props: SpriteCanvasProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const stillSpecies = props.still ? props.species.id : undefined
  const stillPalette = props.still ? props.palette : undefined
  const stillFront = props.still ? wantsFrontPose(props) : undefined
  const stillExpression = props.still ? props.expression : undefined

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const fiberPattern = furPattern(ctx)
    let raf = 0
    let last = 0
    let now = 0
    let phase = 0
    let strideScale = 1
    let lastDistance = propsRef.current.distanceTravelled ?? 0
    let movement = 0
    let sleep = propsRef.current.sleeping ? 1 : 0
    let dance = 0
    let danceClock = 0
    let paw = 0
    let facing: Facing = propsRef.current.facing
    let front = wantsFrontPose(propsRef.current)
    let turnWidth = 1
    let activity = initialActivity()
    let blinkAt = 2 + Math.random() * 2
    let blinkUntil = 0
    let swatAt = -10
    let hopAt = -10
    let beatAt = -10
    let lastSwat = propsRef.current.swatNonce ?? 0
    let contactSentFor = lastSwat
    let lastHop = propsRef.current.hopNonce ?? 0
    let lastBeat = propsRef.current.beatNonce ?? 0
    let lastExpression = propsRef.current.expression

    const draw = (ts: number): void => {
      const p = propsRef.current
      const interval = p.moving ? 0 : p.sleeping ? 1000 / 20 : 1000 / 30
      if (last && ts - last < interval) {
        raf = requestAnimationFrame(draw)
        return
      }
      const dt = p.frozen || p.still ? 0 : last ? Math.min(0.05, (ts - last) / 1000) : 1 / 60
      last = ts
      now += dt
      const anatomy = ANATOMY[p.species.id]
      const motion = p.reducedMotion ? 0.2 : 1
      const energy = p.energy ?? 1
      const distance = p.distanceTravelled ?? 0
      const delta = Math.max(0, distance - lastDistance)
      lastDistance = distance
      // The leg clock comes only from actual travel, so slow pets take slow
      // steps and paused pets never run on the spot. No reset on direction changes.
      const stridePixels = (p.size * anatomy.stride) / 100
      const velocity = dt > 0 ? delta / dt : 0
      strideScale = smooth(
        strideScale,
        Math.max(1, Math.min(3.5, velocity / (stridePixels * 4))),
        10,
        dt
      )
      if (p.moving && !p.frozen) phase += delta / (stridePixels * strideScale)
      movement = smooth(movement, p.moving ? 1 : 0, 12, dt)
      sleep = smooth(sleep, p.sleeping ? 1 : 0, 6, dt)
      dance = smooth(dance, p.dancing && !p.sleeping ? 1 : 0, 6, dt)
      danceClock += dt * 5.5 * Math.max(0.4, Math.min(2.2, p.danceTempo ?? 1))
      paw = smooth(paw, p.gesturing || p.posing ? 1 : 0, 9, dt)

      const requestedFront = wantsFrontPose(p) && sleep < 0.1
      if (requestedFront !== front) {
        front = requestedFront
        turnWidth = p.reducedMotion || p.frozen ? 1 : 0.76
      }
      // Turn briefly through a narrower silhouette, then open into the new pose.
      if (!front && facing !== p.facing) {
        turnWidth = smooth(turnWidth, 0.65, 16, dt)
        if (turnWidth < 0.72 || p.still) facing = p.facing
      } else turnWidth = smooth(turnWidth, 1, 14, dt)

      if (now > blinkAt) {
        blinkUntil = now + 0.14
        blinkAt = now + 2.8 + Math.random() * 3.4
      }
      if (p.swatNonce !== undefined && p.swatNonce !== lastSwat) {
        lastSwat = p.swatNonce
        swatAt = now
      }
      if (p.hopNonce !== undefined && p.hopNonce !== lastHop) {
        lastHop = p.hopNonce
        hopAt = now
      }
      if (p.beatNonce !== undefined && p.beatNonce !== lastBeat) {
        lastBeat = p.beatNonce
        beatAt = now
      }
      if (p.expression !== lastExpression) {
        if (p.expression === 'love') hopAt = now
        lastExpression = p.expression
      }
      const oneShot = (start: number, duration: number): number => {
        const age = now - start
        return age >= 0 && age < duration ? Math.sin((age / duration) * Math.PI) : 0
      }
      if (!p.swatting) swatAt = -10
      const atContact =
        !!p.swatting && contactSentFor !== lastSwat && now - swatAt >= SWAT_DURATION / 2
      // Paint an exact contact frame before emitting dismissal. A separate wall
      // clock timer can fire before the animation reaches the button on a busy PC.
      const swat = p.swatting ? (atContact ? 1 : oneShot(swatAt, SWAT_DURATION)) * (1 - sleep) : 0
      const exactSwat = !!p.swatting && swat > 0
      const greeting = oneShot(hopAt, 0.6) * (1 - sleep) * motion
      const beat = oneShot(beatAt, 0.24) * dance * motion
      activity = stepActivity(activity, dt, {
        resting: p.idle && !p.sleeping && !p.dragging && !p.frozen && !p.still,
        energy,
        reducedMotion: !!p.reducedMotion
      })
      const progress = actionProgress(activity)
      const envelope = Math.sin(progress * Math.PI)
      const action = activity.action
      const breath = Math.sin(now * (p.sleeping ? 1.55 : 2)) * (p.sleeping ? 0.5 : 0.3) * motion
      canvas.dataset.orientation = front ? 'front' : 'profile'
      const faceExpression = p.sleeping
        ? 'sleepy'
        : p.posing
          ? 'excited'
          : p.dancing
            ? 'happy'
            : p.expression
      canvas.dataset.expression = faceExpression
      const model = (front ? buildFrontModel : buildModel)(
        { ...p.species, palette: p.palette },
        {
          expr: faceExpression,
          blink: now < blinkUntil,
          sleep,
          phase,
          movement,
          strideScale,
          breath,
          paw,
          swat,
          swatTarget: p.swatTarget,
          dance: dance * motion,
          dancePhase: danceClock,
          stretch: action === 'stretch' ? envelope * motion : 0,
          yawn: action === 'yawn' ? envelope : 0,
          lookUp: p.posing
        }
      )
      const furColors = new Set([
        p.palette.fur,
        p.palette.furLight,
        p.palette.furDark,
        p.palette.cream,
        p.palette.creamDark,
        p.species.markColor
      ])
      const dpr = window.devicePixelRatio || 1
      const pixels = Math.round(p.size * dpr)
      if (canvas.width !== pixels || canvas.height !== pixels) {
        canvas.width = pixels
        canvas.height = pixels
      }
      ctx.setTransform(pixels / 100, 0, 0, pixels / 100, 0, 0)
      ctx.clearRect(0, 0, 100, 100)
      ctx.save()
      if (!front && facing === 'left') {
        ctx.translate(100, 0)
        ctx.scale(-1, 1)
      }
      const bob = dance * Math.sin(danceClock) * 2.5 * motion - greeting * 1.8
      const rock =
        anatomy.gait === 'waddle' || anatomy.gait === 'biped'
          ? Math.sin(phase * TAU) * 0.035 * movement
          : 0
      const tilt =
        rock +
        dance * Math.sin(danceClock * 0.5) * 0.06 * motion +
        (action === 'shake' ? Math.sin(progress * TAU * 3) * envelope * 0.025 * motion : 0)
      for (const part of model) {
        if (part.opacity === 0) continue
        ctx.save()
        ctx.globalAlpha *= part.opacity ?? 1
        if (part.id !== 'shadow') {
          ctx.translate(50, 91)
          ctx.scale(exactSwat ? 1 : turnWidth, exactSwat ? 1 : 1 + beat * 0.025)
          ctx.rotate(exactSwat ? 0 : tilt)
          ctx.translate(-50, -91 + (exactSwat ? 0 : bob))
          if (faceExpression === 'angry' && !exactSwat)
            ctx.translate(Math.sin(now * 18) * 0.45 * motion, 0)
          if (p.dragging) ctx.translate(0, -2)
          if (part.anchor) {
            let rotation = 0
            if (part.id === 'tail') {
              const wag = p.species.id === 'dog' ? 0.13 : 0.035
              rotation =
                Math.sin(now * (p.species.id === 'dog' ? 5 : 1.6)) * wag * (1 - sleep) * motion
              if (faceExpression === 'angry') rotation = Math.sin(now * 7) * 0.13 * motion
              if (action === 'tailFlick')
                rotation += Math.sin(progress * TAU) * envelope * 0.14 * motion
            } else if (['head', 'face', 'earNear', 'earFar'].includes(part.id)) {
              const attitude: Partial<Record<Mood, number>> = {
                happy: -0.025,
                excited: -0.04,
                curious: -0.13,
                alert: -0.07,
                chill: 0.04,
                sleepy: 0.09,
                grumpy: 0.07,
                angry: 0.075
              }
              rotation = (attitude[faceExpression] ?? 0) * (1 - sleep) * motion
              if (faceExpression === 'excited' && !p.moving)
                ctx.translate(0, -Math.abs(Math.sin(now * 4.5)) * 0.7 * motion)
              if (faceExpression === 'sleepy')
                rotation += Math.sin(now * 1.3) * 0.025 * motion * (1 - sleep)
              if (part.id === 'earNear' || part.id === 'earFar') {
                const ear =
                  faceExpression === 'angry'
                    ? 0.1
                    : faceExpression === 'sleepy' || faceExpression === 'chill'
                      ? 0.06
                      : 0
                rotation += ear * (part.id === 'earNear' ? 1 : -1) * motion * (1 - sleep)
              }
              if (action === 'lookAround') rotation += Math.sin(progress * TAU) * 0.045 * motion
              if (part.id === 'earNear' && action === 'earTwitch')
                rotation += Math.sin(progress * TAU * 2) * envelope * 0.06 * motion
              rotation += dance * Math.sin(danceClock) * 0.055 * motion
              if (p.posing) rotation += Math.sin(now * 2) * 0.04 * motion - 0.05
            } else if (part.id === 'wing')
              rotation =
                Math.sin(phase * TAU) * 0.06 * movement +
                dance * Math.sin(danceClock) * 0.13 * motion
            rotation += part.rotation ?? 0
            if (exactSwat && part.id === 'wing') rotation = 0
            ctx.translate(part.anchor.x, part.anchor.y)
            ctx.rotate(rotation)
            ctx.translate(-part.anchor.x, -part.anchor.y)
          }
        }
        paint(
          ctx,
          part.prims,
          p.species.eyesOnTop || p.species.id === 'pig' ? null : fiberPattern,
          furColors
        )
        ctx.restore()
      }
      ctx.restore()
      if (atContact) {
        contactSentFor = lastSwat
        p.onSwatContact?.(lastSwat)
      }
      if (!p.still) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [props.still, stillSpecies, stillPalette, stillFront, stillExpression])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ width: props.size, height: props.size, display: 'block', pointerEvents: 'none' }}
    />
  )
}

function paint(
  ctx: CanvasRenderingContext2D,
  primitives: Prim[],
  fibers: CanvasPattern | null,
  furColors: Set<string | undefined>
): void {
  for (const primitive of primitives) {
    ctx.beginPath()
    if (primitive.k === 'ellipse') {
      ctx.ellipse(
        primitive.cx,
        primitive.cy,
        primitive.rx,
        primitive.ry,
        primitive.rot ?? 0,
        0,
        TAU
      )
    } else {
      for (const segment of primitive.d) {
        if (segment.t === 'M') ctx.moveTo(segment.x, segment.y)
        else if (segment.t === 'L') ctx.lineTo(segment.x, segment.y)
        else ctx.quadraticCurveTo(segment.cx, segment.cy, segment.x, segment.y)
      }
      if (primitive.closed) ctx.closePath()
    }
    if (primitive.fill) {
      if (primitive.gradient) {
        const bounds = primitiveBounds(primitive)
        ctx.save()
        ctx.clip()
        ctx.translate(bounds.x, bounds.y)
        ctx.scale(Math.max(0.01, bounds.width), Math.max(0.01, bounds.height))
        const g = primitive.gradient
        const shade =
          g.kind === 'linear'
            ? ctx.createLinearGradient(0, 0, 0, 1)
            : ctx.createRadialGradient(g.cx ?? 0.3, g.cy ?? 0.22, 0, 0.5, 0.5, g.radius ?? 0.85)
        for (const [stop, color] of g.stops) shade.addColorStop(stop, color)
        ctx.fillStyle = shade
        ctx.fillRect(-1, -1, 3, 3)
        ctx.restore()
        if (fibers && furColors.has(primitive.fill)) {
          ctx.save()
          ctx.clip()
          ctx.globalAlpha *= 0.14
          ctx.fillStyle = fibers
          ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
          ctx.restore()
        }
      } else {
        ctx.fillStyle = primitive.fill
        ctx.fill()
      }
    }
    if (primitive.stroke) {
      ctx.strokeStyle = primitive.stroke.color
      ctx.lineWidth = primitive.stroke.width
      ctx.lineCap = primitive.stroke.cap ?? 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()
    }
  }
}
