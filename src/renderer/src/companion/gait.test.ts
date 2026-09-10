import { describe, expect, it } from 'vitest'
import { ANATOMY, footPose, jointBetween } from './gait'
import { easedStep, DEFAULT_WANDER, sleepTarget, clampToBounds } from './motion'

describe('natural locomotion', () => {
  it('keeps a planted paw stationary as the body travels forward', () => {
    const a = ANATOMY.cat
    const first = footPose(0.04, 'legNearBack', a, 1)
    const next = footPose(0.24, 'legNearBack', a, 1)
    expect(first.y).toBe(0)
    expect(next.y).toBe(0)
    expect(next.x + a.stride * 0.2).toBeCloseTo(first.x)
  })
  it('lifts a swinging paw and settles all paws when stopped', () => {
    expect(footPose(0.82, 'legNearBack', ANATOMY.cat, 1).y).toBeLessThan(0)
    const stopped = footPose(0.82, 'legNearBack', ANATOMY.cat, 0)
    expect(Math.abs(stopped.x) + Math.abs(stopped.y)).toBe(0)
  })
  it('keeps a planted running paw fixed as the longer stride advances', () => {
    const a = ANATOMY.cat
    const first = footPose(0.02, 'legNearFront', a, 1, 2.5)
    const next = footPose(0.08, 'legNearFront', a, 1, 2.5)
    expect(first.y).toBe(0)
    expect(next.y).toBe(0)
    expect(next.x + a.stride * 2.5 * 0.06).toBeCloseTo(first.x)
  })
  it('uses paired hind-leg hops for rabbits and frogs', () => {
    for (const a of [ANATOMY.bunny, ANATOMY.frog]) {
      expect(footPose(0.7, 'legNearBack', a, 1)).toEqual(footPose(0.7, 'legFarBack', a, 1))
    }
  })
  it('keeps joint coordinates finite when a limb is folded or overextended', () => {
    for (const foot of [
      { x: 0, y: 0 },
      { x: 100, y: 100 }
    ]) {
      const joint = jointBetween({ x: 0, y: 0 }, foot, 10, 1)
      expect(Number.isFinite(joint.x) && Number.isFinite(joint.y)).toBe(true)
    }
  })
  it('accelerates, brakes, and arrives without overshooting', () => {
    let position = { x: 0, y: 0 }
    let speed = 0
    const speeds: number[] = []
    for (let i = 0; i < 600; i++) {
      const result = easedStep(position, { x: 140, y: 0 }, DEFAULT_WANDER, 1 / 60, 'right', speed)
      position = result.pos
      speed = result.speed
      speeds.push(speed)
      expect(position.x).toBeLessThanOrEqual(140)
      if (result.arrived) break
    }
    expect(position).toEqual({ x: 140, y: 0 })
    expect(speeds[0]).toBeLessThan(Math.max(...speeds))
    expect(speeds.at(-2)).toBeLessThan(Math.max(...speeds))
    expect(speed).toBe(0)
  })
  it('does not move on an invalid time step', () => {
    for (const dt of [0, -1, NaN, Infinity]) {
      expect(
        easedStep({ x: 0, y: 0 }, { x: 10, y: 0 }, DEFAULT_WANDER, dt, 'right', 0).pos
      ).toEqual({ x: 0, y: 0 })
    }
  })
  it('keeps a bed on-screen even on a display smaller than the pet', () => {
    expect(sleepTarget({ width: 40, height: 40 }, DEFAULT_WANDER)).toEqual({ x: 0, y: 0 })
  })
  it('keeps walking and dragging clear of taskbars on every edge', () => {
    const bounds = { width: 1000, height: 600, workArea: { x: 45, y: 30, width: 910, height: 530 } }
    expect(clampToBounds({ x: -50, y: -50 }, bounds, DEFAULT_WANDER)).toEqual({ x: 45, y: 30 })
    expect(clampToBounds({ x: 1000, y: 600 }, bounds, DEFAULT_WANDER)).toEqual({ x: 875, y: 480 })
  })
})
