import { describe, it, expect } from 'vitest'
import { wanderConfigFor, baseMoodFor, energyFor, paletteFor } from './appearance'
import { speciesFor } from './species'
import {
  DEFAULT_SETTINGS,
  SIZE_PX,
  COLOR_THEMES,
  type NudgeSettings,
  type MoodDefault,
  type Size,
  type CharacterId,
  type ColorThemeId
} from '../../../shared/settings'

function withAppearance(size: Size, moodDefault: MoodDefault, reducedMotion = false): NudgeSettings {
  return {
    ...DEFAULT_SETTINGS,
    appearance: { ...DEFAULT_SETTINGS.appearance, size, moodDefault },
    general: { ...DEFAULT_SETTINGS.general, reducedMotion }
  }
}

function withCoat(character: CharacterId, colorTheme: ColorThemeId): NudgeSettings {
  return {
    ...DEFAULT_SETTINGS,
    appearance: { ...DEFAULT_SETTINGS.appearance, character, colorTheme }
  }
}

describe('wanderConfigFor', () => {
  it('maps the size setting to the sprite footprint', () => {
    expect(wanderConfigFor(withAppearance('small', 'happy')).spriteSize).toBe(SIZE_PX.small)
    expect(wanderConfigFor(withAppearance('medium', 'happy')).spriteSize).toBe(SIZE_PX.medium)
    expect(wanderConfigFor(withAppearance('large', 'happy')).spriteSize).toBe(SIZE_PX.large)
  })

  it('scales energy with the default mood: alert > happy > chill', () => {
    const alert = wanderConfigFor(withAppearance('medium', 'alert')).speed
    const happy = wanderConfigFor(withAppearance('medium', 'happy')).speed
    const chill = wanderConfigFor(withAppearance('medium', 'chill')).speed
    expect(alert).toBeGreaterThan(happy)
    expect(happy).toBeGreaterThan(chill)
  })

  it('a chill companion rests more and roams less than an alert one', () => {
    const chill = wanderConfigFor(withAppearance('medium', 'chill'))
    const alert = wanderConfigFor(withAppearance('medium', 'alert'))
    expect(chill.restBias).toBeGreaterThan(alert.restBias)
    expect(alert.roamChance).toBeGreaterThan(chill.roamChance)
  })

  it('reduced motion slows the companion and calms its roaming', () => {
    const normal = wanderConfigFor(withAppearance('medium', 'happy', false))
    const reduced = wanderConfigFor(withAppearance('medium', 'happy', true))
    expect(reduced.speed).toBeLessThan(normal.speed)
    expect(reduced.roamChance).toBeLessThan(normal.roamChance)
    expect(reduced.restBias).toBeGreaterThanOrEqual(normal.restBias)
  })

  it('never produces a zero or negative speed', () => {
    for (const mood of ['happy', 'chill', 'alert', 'excited', 'curious', 'grumpy', 'sleepy'] as const) {
      for (const rm of [false, true]) {
        expect(wanderConfigFor(withAppearance('small', mood, rm)).speed).toBeGreaterThan(0)
      }
    }
  })

  it('gives the new presets distinct locomotion profiles (excited zippiest, sleepy calmest)', () => {
    const excited = wanderConfigFor(withAppearance('medium', 'excited'))
    const sleepy = wanderConfigFor(withAppearance('medium', 'sleepy'))
    const happy = wanderConfigFor(withAppearance('medium', 'happy'))
    // Excited is the liveliest: fastest, roams most, rests least.
    expect(excited.speed).toBeGreaterThan(happy.speed)
    expect(excited.roamChance).toBeGreaterThanOrEqual(happy.roamChance)
    expect(excited.restBias).toBeLessThan(happy.restBias)
    // Sleepy is the calmest: slowest, roams least, rests most.
    expect(sleepy.speed).toBeLessThan(happy.speed)
    expect(sleepy.roamChance).toBeLessThan(happy.roamChance)
    expect(sleepy.restBias).toBeGreaterThan(happy.restBias)
  })
})

describe('baseMoodFor', () => {
  it('maps each preset to its own distinct resting face (1:1)', () => {
    // The whole point of the expanded roster: no two presets share a face, so
    // Happy and Alert (previously both "neutral") now read differently.
    expect(baseMoodFor('happy')).toBe('happy')
    expect(baseMoodFor('chill')).toBe('chill')
    expect(baseMoodFor('alert')).toBe('alert')
    expect(baseMoodFor('excited')).toBe('excited')
    expect(baseMoodFor('curious')).toBe('curious')
    expect(baseMoodFor('grumpy')).toBe('grumpy')
    expect(baseMoodFor('sleepy')).toBe('sleepy')
  })
})

describe('energyFor', () => {
  it('orders liveliness alert > happy > chill', () => {
    expect(energyFor('alert', false)).toBeGreaterThan(energyFor('happy', false))
    expect(energyFor('happy', false)).toBeGreaterThan(energyFor('chill', false))
  })

  it('excited is the liveliest and sleepy the calmest', () => {
    expect(energyFor('excited', false)).toBeGreaterThan(energyFor('happy', false))
    expect(energyFor('sleepy', false)).toBeLessThan(energyFor('chill', false))
  })

  it('is always positive so animation never freezes', () => {
    for (const mood of ['happy', 'chill', 'alert', 'excited', 'curious', 'grumpy', 'sleepy'] as const) {
      for (const rm of [false, true]) {
        expect(energyFor(mood, rm)).toBeGreaterThan(0)
      }
    }
  })

  it('reduced motion clamps energy low (<= 0.5), even for an alert mood', () => {
    expect(energyFor('alert', true)).toBeLessThanOrEqual(0.5)
    expect(energyFor('alert', true)).toBeLessThan(energyFor('alert', false))
    expect(energyFor('chill', true)).toBeLessThanOrEqual(0.5)
  })
})

describe('paletteFor', () => {
  it("the 'natural' coat paints each animal in its own colors", () => {
    // DEFAULT_SETTINGS ships the 'natural' coat, so the resolved palette must be
    // exactly the species' own — not a shared recolor theme.
    const cat = speciesFor('cat')
    expect(paletteFor(withCoat('cat', 'natural'), cat)).toEqual(cat.palette)
    const frog = speciesFor('frog')
    expect(paletteFor(withCoat('frog', 'natural'), frog)).toEqual(frog.palette)
  })

  it('a recolor coat overrides the species colors with the shared theme', () => {
    // 'mint' is a COLOR_THEMES entry; it should win regardless of which animal
    // is chosen (the coat recolors the body; morphology stays with the species).
    const cat = speciesFor('cat')
    const frog = speciesFor('frog')
    expect(paletteFor(withCoat('cat', 'mint'), cat)).toEqual(COLOR_THEMES.mint)
    expect(paletteFor(withCoat('frog', 'mint'), frog)).toEqual(COLOR_THEMES.mint)
  })

  it('natural coats differ between species (fur is not shared)', () => {
    const cat = speciesFor('cat')
    const frog = speciesFor('frog')
    expect(paletteFor(withCoat('cat', 'natural'), cat).fur).not.toBe(
      paletteFor(withCoat('frog', 'natural'), frog).fur
    )
  })
})
