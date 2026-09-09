import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SETTINGS,
  SIZE_PX,
  COLOR_THEMES,
  THEME_ORDER,
  CHARACTER_ORDER,
  CHARACTER_LABELS,
  isNaturalCoat,
  mergeSettings,
  type NudgeSettings
} from './settings'

describe('settings defaults', () => {
  it('has a safe default: nudge mode, not paused, medium natural cat', () => {
    expect(DEFAULT_SETTINGS.behavior.mode).toBe('nudge')
    expect(DEFAULT_SETTINGS.runtime.paused).toBe(false)
    expect(DEFAULT_SETTINGS.appearance).toMatchObject({
      character: 'cat',
      size: 'medium',
      colorTheme: 'natural',
      moodDefault: 'happy'
    })
  })

  it('maps the three sizes to ascending pixel footprints', () => {
    expect(SIZE_PX.small).toBeLessThan(SIZE_PX.medium)
    expect(SIZE_PX.medium).toBeLessThan(SIZE_PX.large)
  })

  it('does NOT dance by default — opt-in, so launching never trips Windows DND', () => {
    // Capturing loopback audio for the dance needs a screen-capture session, which
    // Windows treats as screen-sharing and uses to auto-enable Do Not Disturb. So
    // the feature ships OFF and the user opts in from Settings.
    expect(DEFAULT_SETTINGS.general.reactToAudio).toBe(false)
  })

  it('defines a palette for every recolor coat (natural has none by design)', () => {
    // 'natural' leads the order but is resolved from the species, not COLOR_THEMES.
    expect(isNaturalCoat(THEME_ORDER[0])).toBe(true)
    for (const id of THEME_ORDER) {
      if (isNaturalCoat(id)) continue
      const p = COLOR_THEMES[id]
      expect(p.fur).toMatch(/^#|rgba/)
      expect(p.outline).toBeDefined()
    }
  })

  it('gives every roster character a non-empty label', () => {
    expect(CHARACTER_ORDER[0]).toBe('cat') // default + design reference leads
    for (const id of CHARACTER_ORDER) {
      expect(CHARACTER_LABELS[id]).toBeTruthy()
    }
    // Order and label map cover exactly the same ids (can't drift).
    expect(new Set(CHARACTER_ORDER).size).toBe(CHARACTER_ORDER.length)
    expect(CHARACTER_ORDER.length).toBe(Object.keys(CHARACTER_LABELS).length)
  })
})

describe('mergeSettings', () => {
  it('overrides only the fields in the patch, leaving other sections intact', () => {
    const next = mergeSettings(DEFAULT_SETTINGS, { appearance: { size: 'large' } })
    expect(next.appearance.size).toBe('large')
    // Other appearance fields preserved.
    expect(next.appearance.colorTheme).toBe(DEFAULT_SETTINGS.appearance.colorTheme)
    // Other sections untouched.
    expect(next.general).toEqual(DEFAULT_SETTINGS.general)
    expect(next.behavior).toEqual(DEFAULT_SETTINGS.behavior)
  })

  it('does not mutate the base object', () => {
    const base: NudgeSettings = structuredClone(DEFAULT_SETTINGS)
    mergeSettings(base, { runtime: { paused: true } })
    expect(base.runtime.paused).toBe(false)
  })

  it('an empty patch is an identity (value-equal) merge', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, {})).toEqual(DEFAULT_SETTINGS)
  })

  it('fills missing keys when hydrating a partial (stale-store) object onto defaults', () => {
    const stale = { appearance: { colorTheme: 'mint' as const } }
    const hydrated = mergeSettings(DEFAULT_SETTINGS, stale)
    expect(hydrated.appearance.colorTheme).toBe('mint')
    expect(hydrated.general.reducedMotion).toBe(false) // filled from defaults
  })
})
