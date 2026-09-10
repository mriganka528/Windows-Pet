import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import {
  spawnHearts,
  spawnAnger,
  spawnSleep,
  spawnNotes,
  spawnSparkles,
  stepParticles,
  particleAlpha,
  particleScale,
  type Particle
} from './effects'

// ---------------------------------------------------------------------------
// Full-stage particle overlay for reaction emotes (hearts / anger / sleep /
// musical notes / photogenic sparkles).
// ---------------------------------------------------------------------------
// Separate from SpriteCanvas because emotes float BEYOND the sprite's 80px box
// (hearts rise well above the pup's head), and keeping them on their own
// viewport-sized layer means the sprite's hitbox math stays untouched.
//
// The parent triggers emotes imperatively via a ref — e.g. on a pet, a
// notification, or a detected beat — passing the sprite's current on-screen
// position. The layer runs its own rAF ONLY while particles are alive, so it
// costs nothing at rest.

export interface EffectsHandle {
  clear(kind: Particle['kind']): void
  hearts(x: number, y: number): void
  anger(x: number, y: number): void
  sleep(x: number, y: number): void
  /** Puff of musical notes (the dance doodles); count defaults to a small burst. */
  notes(x: number, y: number, count?: number): void
  /** Twinkling sparkles around the head while posing for the camera. */
  sparkles(x: number, y: number, count?: number): void
}

export const EffectsCanvas = forwardRef<EffectsHandle>(function EffectsCanvas(_props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const rafRef = useRef<number>(0)
  const runningRef = useRef(false)
  const lastRef = useRef<number>(0)
  // Set by the effect (which owns the canvas + loop); called by the handle.
  const startLoopRef = useRef<null | (() => void)>(null)

  function ensureRunning(): void {
    startLoopRef.current?.()
  }

  useImperativeHandle(
    ref,
    () => ({
      clear(kind) {
        particlesRef.current = particlesRef.current.filter((p) => p.kind !== kind)
        ensureRunning()
      },
      hearts(x, y) {
        particlesRef.current.push(...spawnHearts(x, y, 5))
        ensureRunning()
      },
      anger(x, y) {
        particlesRef.current.push(...spawnAnger(x, y, 4))
        ensureRunning()
      },
      sleep(x, y) {
        particlesRef.current.push(...spawnSleep(x, y))
        ensureRunning()
      },
      notes(x, y, count = 3) {
        particlesRef.current.push(...spawnNotes(x, y, count))
        ensureRunning()
      },
      sparkles(x, y, count = 4) {
        particlesRef.current.push(...spawnSparkles(x, y, count))
        ensureRunning()
      }
    }),
    []
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const cnv: HTMLCanvasElement = canvas
    const c: CanvasRenderingContext2D = ctx

    function frame(now: number): void {
      const dt = Math.min(0.05, (now - lastRef.current) / 1000)
      lastRef.current = now

      const dpr = window.devicePixelRatio || 1
      const w = window.innerWidth
      const h = window.innerHeight
      if (cnv.width !== Math.round(w * dpr) || cnv.height !== Math.round(h * dpr)) {
        cnv.width = Math.round(w * dpr)
        cnv.height = Math.round(h * dpr)
      }

      particlesRef.current = stepParticles(particlesRef.current, dt)

      c.save()
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      c.clearRect(0, 0, w, h)
      for (const p of particlesRef.current) drawParticle(c, p)
      c.restore()

      if (particlesRef.current.length === 0) {
        runningRef.current = false // idle: stop burning frames
        return
      }
      rafRef.current = requestAnimationFrame(frame)
    }

    // Expose the loop starter to the imperative handle via a stable closure.
    startLoopRef.current = () => {
      if (runningRef.current) return
      runningRef.current = true
      lastRef.current = performance.now()
      rafRef.current = requestAnimationFrame(frame)
    }

    return () => {
      runningRef.current = false
      cancelAnimationFrame(rafRef.current)
      startLoopRef.current = null
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none'
      }}
    />
  )
})

// ---------------------------------------------------------------------------
// Particle drawing
// ---------------------------------------------------------------------------

function drawParticle(c: CanvasRenderingContext2D, p: Particle): void {
  const a = particleAlpha(p)
  if (a <= 0) return
  const scale = particleScale(p)
  c.save()
  c.globalAlpha = a
  c.translate(p.x, p.y)
  c.rotate(p.rot)
  c.scale(scale, scale)
  if (p.kind === 'heart') drawHeart(c, p.size)
  else if (p.kind === 'anger') drawAnger(c, p.size)
  else if (p.kind === 'note') drawNote(c, p.size, p.id)
  else if (p.kind === 'sparkle') drawSparkle(c, p.size, p.age, p.swayPhase)
  else drawSleep(c, p.size)
  c.restore()
}

function drawHeart(c: CanvasRenderingContext2D, size: number): void {
  const r = size / 2
  c.beginPath()
  c.moveTo(0, r * 0.75)
  c.bezierCurveTo(-r * 1.15, -r * 0.25, -r * 0.55, -r * 0.95, 0, -r * 0.25)
  c.bezierCurveTo(r * 0.55, -r * 0.95, r * 1.15, -r * 0.25, 0, r * 0.75)
  c.closePath()
  const g = c.createLinearGradient(0, -r, 0, r)
  g.addColorStop(0, '#FF8FA8')
  g.addColorStop(1, '#F0567E')
  c.fillStyle = g
  c.fill()
  // little glossy dot
  c.beginPath()
  c.arc(-r * 0.35, -r * 0.35, r * 0.18, 0, Math.PI * 2)
  c.fillStyle = 'rgba(255,255,255,0.75)'
  c.fill()
}

function drawAnger(c: CanvasRenderingContext2D, size: number): void {
  // Red "popping vein" burst.
  const arm = size * 0.5
  c.strokeStyle = '#E4483A'
  c.lineWidth = Math.max(1.4, size * 0.14)
  c.lineCap = 'round'
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 4
    c.beginPath()
    c.moveTo(Math.cos(ang) * arm * 0.35, Math.sin(ang) * arm * 0.35)
    c.lineTo(Math.cos(ang) * arm, Math.sin(ang) * arm)
    c.stroke()
  }
}

function drawSleep(c: CanvasRenderingContext2D, size: number): void {
  c.font = `700 ${size}px system-ui, sans-serif`
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillStyle = '#7FA8D0'
  c.fillText('z', 0, 0)
}

// The three note glyphs, chosen by particle id so a burst is a cheerful mix
// (eighth / beamed-eighths / beamed-sixteenths) rather than all identical.
const NOTE_GLYPHS = ['♪', '♫', '♬'] // ♪ ♫ ♬

function drawNote(c: CanvasRenderingContext2D, size: number, id: number): void {
  const glyph = NOTE_GLYPHS[((id % NOTE_GLYPHS.length) + NOTE_GLYPHS.length) % NOTE_GLYPHS.length]
  c.font = `700 ${size}px system-ui, "Segoe UI Symbol", sans-serif`
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  // Playful violet→blue gradient so the doodles pop against any window.
  const g = c.createLinearGradient(0, -size / 2, 0, size / 2)
  g.addColorStop(0, '#B98BFF')
  g.addColorStop(1, '#6C8CFF')
  // Soft glow to read on busy backgrounds, then the gradient glyph.
  c.shadowColor = 'rgba(120,110,255,0.45)'
  c.shadowBlur = Math.max(2, size * 0.25)
  c.fillStyle = g
  c.fillText(glyph, 0, 0)
}

// A four-point "glint" star for the photogenic pose. The arm length pulses with
// age (`twinkle`) so a scatter of them shimmers like a camera flash, and a warm
// white→gold radial fill keeps them reading as sparkles on any background.
function drawSparkle(c: CanvasRenderingContext2D, size: number, age: number, phase: number): void {
  const twinkle = 0.72 + 0.28 * Math.sin(age * 14 + phase)
  const r = (size / 2) * twinkle
  const waist = r * 0.16 // arm thickness at the centre (smaller = thinner glints)
  c.beginPath()
  c.moveTo(0, -r)
  c.quadraticCurveTo(waist, -waist, r, 0)
  c.quadraticCurveTo(waist, waist, 0, r)
  c.quadraticCurveTo(-waist, waist, -r, 0)
  c.quadraticCurveTo(-waist, -waist, 0, -r)
  c.closePath()
  const g = c.createRadialGradient(0, 0, 0, 0, 0, Math.max(0.01, r))
  g.addColorStop(0, '#FFFFFF')
  g.addColorStop(0.5, '#FFE9A8')
  g.addColorStop(1, '#FFC44D')
  c.shadowColor = 'rgba(255,214,102,0.6)'
  c.shadowBlur = Math.max(2, size * 0.4)
  c.fillStyle = g
  c.fill()
  // bright centre pip
  c.shadowBlur = 0
  c.beginPath()
  c.arc(0, 0, Math.max(0.8, r * 0.14), 0, Math.PI * 2)
  c.fillStyle = 'rgba(255,255,255,0.95)'
  c.fill()
}
