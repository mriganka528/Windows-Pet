import { describe, expect, it } from 'vitest'
import { createActor } from 'xstate'
import { companionMachine } from './machine'
import { DEFAULT_WANDER, pickWanderTarget } from './motion'
import { facesFront } from './presentation'

describe('varied roaming and faster trips', () => {
  it('explores both axes without leaving the usable desktop', () => {
    const bounds = { width: 1000, height: 700, workArea: { x: 40, y: 20, width: 920, height: 630 } }
    let seed = 12345
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    const targets = Array.from({ length: 60 }, () =>
      pickWanderTarget(bounds, DEFAULT_WANDER, random, { x: 450, y: 400 })
    )
    for (const target of targets) {
      expect(target.x).toBeGreaterThanOrEqual(40)
      expect(target.x).toBeLessThanOrEqual(880)
      expect(target.y).toBeGreaterThanOrEqual(20)
      expect(target.y).toBeLessThanOrEqual(570)
      expect(Math.hypot(target.x - 450, target.y - 400)).toBeGreaterThanOrEqual(56)
    }
    expect(new Set(targets.map((p) => Math.round(p.y / 50))).size).toBeGreaterThan(6)
    expect(targets.some((p) => p.x < 450 && p.y < 400)).toBe(true)
    expect(targets.some((p) => p.x > 450 && p.y > 400)).toBe(true)
  })

  it('occasionally faces the viewer during normal movement, then turns back', () => {
    const actor = createActor(companionMachine, {
      input: { bounds: { width: 1400, height: 900 } }
    }).start()
    let frontFrames = 0
    let profileFrames = 0
    for (let i = 0; i < 600; i++) {
      actor.send({ type: 'TICK', dt: 0.1 })
      const state = actor.getSnapshot()
      if (state.matches('wander')) {
        if (facesFront('wander', state.context)) frontFrames++
        else profileFrames++
      }
    }
    expect(frontFrames).toBeGreaterThan(0)
    expect(profileFrames).toBeGreaterThan(frontFrames)
    actor.stop()
  })

  it('reaches bed promptly without teleporting or skipping sleep', () => {
    const actor = createActor(companionMachine, {
      input: {
        bounds: { width: 1000, height: 600 },
        config: { ...DEFAULT_WANDER, speed: 64 },
        position: { x: 500, y: 100 }
      }
    }).start()
    actor.send({ type: 'SLEEP' })
    expect(actor.getSnapshot().context.position).toEqual({ x: 500, y: 100 })
    for (let i = 0; i < 65; i++) actor.send({ type: 'TICK', dt: 0.05 })
    expect(actor.getSnapshot().value).toBe('sleeping')
    actor.stop()
  })
})
