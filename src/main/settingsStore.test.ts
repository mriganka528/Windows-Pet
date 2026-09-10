import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, mergeSettings } from '../shared/settings'

const memory = vi.hoisted(() => ({ data: {} as Record<string, unknown> }))
vi.mock('electron-store', () => ({
  default: class {
    constructor(options: { defaults: Record<string, unknown> }) {
      memory.data = { ...options.defaults, ...memory.data }
    }
    get(key: string) {
      return memory.data[key]
    }
    set(key: string, value: unknown) {
      memory.data[key] = value
    }
  }
}))
import { initSettings, updateSettings } from './settingsStore'

describe('capture-free audio default migration', () => {
  beforeEach(() => {
    memory.data = {}
  })
  it('starts a new installation with dancing enabled', () => {
    expect(initSettings().general.reactToAudio).toBe(true)
  })
  it('enables dancing once on upgrade and preserves all other preferences', () => {
    const previous = mergeSettings(DEFAULT_SETTINGS, {
      appearance: { character: 'fox', colorTheme: 'mint' },
      general: { reactToAudio: false },
      runtime: { paused: true },
      behavior: { wanderSpeed: 125, sleepPosition: 'bottom-right' }
    })
    memory.data = { settings: previous, migrations: { audioOptIn: true } }
    const upgraded = initSettings()
    expect(upgraded).toEqual(mergeSettings(previous, { general: { reactToAudio: true } }))
    expect(memory.data.migrations).toMatchObject({ audioMeterDefault: true })
  })
  it('honors a later explicit Off after the migration', () => {
    initSettings()
    updateSettings({ general: { reactToAudio: false } })
    expect(initSettings().general.reactToAudio).toBe(false)
  })
})
