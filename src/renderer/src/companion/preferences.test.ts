import { describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  SLEEP_POSITIONS,
  type SettingsPatch
} from '../../../shared/settings'
import { wanderConfigFor } from './appearance'
import { DEFAULT_WANDER, sleepTarget } from './motion'
import { companionMachine } from './machine'

describe('sleep position and wandering speed preferences', () => {
  it('hydrates old settings with the top-left bed and normal speed', () => {
    const settings = mergeSettings(DEFAULT_SETTINGS, { behavior: { mode: 'autoClose' } })
    expect(settings.behavior).toEqual({
      mode: 'autoClose',
      sleepPosition: 'top-left',
      wanderSpeed: 100
    })
    const saved = mergeSettings(settings, {
      behavior: { sleepPosition: 'bottom-right', wanderSpeed: 175 }
    })
    expect(mergeSettings(DEFAULT_SETTINGS, JSON.parse(JSON.stringify(saved))).behavior).toEqual(
      saved.behavior
    )
  })
  it('bounds invalid speeds and falls back from an unknown corner', () => {
    expect(
      mergeSettings(DEFAULT_SETTINGS, { behavior: { wanderSpeed: -50 } }).behavior.wanderSpeed
    ).toBe(25)
    expect(
      mergeSettings(DEFAULT_SETTINGS, { behavior: { wanderSpeed: 999 } }).behavior.wanderSpeed
    ).toBe(200)
    expect(
      mergeSettings(DEFAULT_SETTINGS, { behavior: { wanderSpeed: NaN } }).behavior.wanderSpeed
    ).toBe(100)
    const invalid: SettingsPatch = JSON.parse('{"behavior":{"sleepPosition":"outside"}}')
    expect(mergeSettings(DEFAULT_SETTINGS, invalid).behavior.sleepPosition).toBe('top-left')
  })
  it('places every bed inside the work area, including a side taskbar', () => {
    const bounds = { width: 1000, height: 650, workArea: { x: 40, y: 30, width: 960, height: 580 } }
    const expected = [
      { x: 52, y: 42 },
      { x: 908, y: 42 },
      { x: 52, y: 518 },
      { x: 908, y: 518 }
    ]
    SLEEP_POSITIONS.forEach((sleepPosition, i) =>
      expect(sleepTarget(bounds, { ...DEFAULT_WANDER, sleepPosition })).toEqual(expected[i])
    )
  })
  it('moves an already sleeping pet to a new bed without waking it', () => {
    const actor = createActor(companionMachine, {
      input: { bounds: { width: 800, height: 600 }, position: { x: 12, y: 12 } }
    }).start()
    actor.send({ type: 'SLEEP' })
    actor.send({ type: 'TICK', dt: 0.1 })
    expect(actor.getSnapshot().value).toBe('sleeping')
    actor.send({ type: 'SET_CONFIG', config: { ...DEFAULT_WANDER, wanderSpeedMultiplier: 0.25 } })
    expect(actor.getSnapshot().value).toBe('sleeping')
    actor.send({ type: 'SET_CONFIG', config: { ...DEFAULT_WANDER, sleepPosition: 'bottom-right' } })
    for (let i = 0; i < 200 && actor.getSnapshot().value !== 'sleeping'; i++)
      actor.send({ type: 'TICK', dt: 0.05 })
    expect(actor.getSnapshot().value).toBe('sleeping')
    expect(actor.getSnapshot().context.position).toEqual({ x: 708, y: 508 })
    expect(actor.getSnapshot().context.facing).toBe('left')
    actor.stop()
  })
  it('changes normal travel speed while leaving notification and sleep trips unchanged', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.2)
    try {
      const run = (percent: number, mode: 'wander' | 'notification' | 'sleep'): number => {
        const config = wanderConfigFor(
          mergeSettings(DEFAULT_SETTINGS, { behavior: { wanderSpeed: percent } })
        )
        const actor = createActor(companionMachine, {
          input: { bounds: { width: 1400, height: 900 }, position: { x: 700, y: 500 }, config }
        }).start()
        if (mode === 'notification')
          actor.send({
            type: 'NOTIFICATION_APPEARED',
            id: 'n',
            rect: { x: 100, y: 100, width: 200, height: 100 },
            interactive: false
          })
        else if (mode === 'sleep') actor.send({ type: 'SLEEP' })
        for (
          let i = 0;
          i < 100 &&
          !['wander', 'travel', 'sleepTravel'].includes(String(actor.getSnapshot().value));
          i++
        )
          actor.send({ type: 'TICK', dt: 0.05 })
        for (let i = 0; i < 12; i++) actor.send({ type: 'TICK', dt: 0.05 })
        const distance = actor.getSnapshot().context.distanceTravelled
        actor.stop()
        return distance
      }
      expect(run(200, 'wander')).toBeGreaterThan(run(25, 'wander') * 4)
      expect(run(200, 'notification')).toBeCloseTo(run(25, 'notification'))
      expect(run(200, 'sleep')).toBeCloseTo(run(25, 'sleep'))
    } finally {
      random.mockRestore()
    }
  })
})
