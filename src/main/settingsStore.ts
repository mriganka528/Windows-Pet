// ---------------------------------------------------------------------------
// Settings persistence (main process).
// ---------------------------------------------------------------------------
// Thin wrapper over electron-store that keeps an in-memory copy of the current
// settings and writes changes to disk. The merge logic itself lives in the pure
// shared module (mergeSettings) so it's unit-tested without Electron.
//
// [electron-store version] We pin electron-store to the v8 line (see
// package.json). v9+ is ESM-only ("type":"module"), and our main bundle is
// CommonJS (Electron sandbox + externalized deps => require()), so requiring an
// ESM-only build throws ERR_REQUIRE_ESM at startup. v8 is the last CJS release
// and exposes the same tiny API we use here, so it's the reliable choice.
//
// [schema shape] We store the whole settings object under a single "settings"
// key. Using an anonymous object type for the store generic (rather than the
// NudgeSettings interface directly) sidesteps TS's "interfaces lack an implicit
// index signature" constraint on electron-store's `Store<T>` type param.

import Store from 'electron-store'
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type NudgeSettings,
  type SettingsPatch
} from '../shared/settings'

type StoreSchema = {
  settings: NudgeSettings
  // One-time migration flags, keyed by name. A flag is absent on any store written
  // before that migration shipped — which is exactly how we detect "not yet run".
  migrations?: Record<string, boolean>
}

let store: Store<StoreSchema> | null = null
let current: NudgeSettings = DEFAULT_SETTINGS

/**
 * Load settings from disk (creating the file with defaults on first run) and
 * return the resolved settings. Persisted data is merged onto DEFAULT_SETTINGS
 * so a store written by an older version transparently gains any new keys.
 */
export function initSettings(): NudgeSettings {
  store = new Store<StoreSchema>({
    name: 'nudge-settings',
    defaults: { settings: DEFAULT_SETTINGS }
  })
  current = mergeSettings(DEFAULT_SETTINGS, store.get('settings'))

  // One-time migration ("audioOptIn"). "Dance to music" used to default ON, which
  // meant launching Nudge immediately opened a loopback screen-capture session —
  // and Windows treats any live screen capture as screen-sharing, silently turning
  // ON Do Not Disturb / Focus. The feature is now opt-in (DEFAULT_SETTINGS has
  // reactToAudio: false). Flip any PREVIOUSLY-persisted `true` to `false` exactly
  // once so existing installs also stop auto-enabling DND at launch. The store
  // flag guards it, so if the user deliberately re-enables the toggle afterwards
  // we never stomp their choice on the next start.
  const migrations = store.get('migrations') ?? {}
  if (!migrations.audioOptIn) {
    if (current.general.reactToAudio) {
      current = mergeSettings(current, { general: { reactToAudio: false } })
    }
    store.set('migrations', { ...migrations, audioOptIn: true })
  }

  // Write back the normalized (fully-populated) object.
  store.set('settings', current)
  return current
}

/** The current in-memory settings (always fully populated). */
export function getSettings(): NudgeSettings {
  return current
}

/**
 * Apply a partial patch, persist it, and return the new full settings. The
 * caller is responsible for broadcasting the change and running side effects
 * (login item, window resize, etc.) — this module only owns storage.
 */
export function updateSettings(patch: SettingsPatch): NudgeSettings {
  current = mergeSettings(current, patch)
  store?.set('settings', current)
  return current
}

/** Reset everything to defaults (used by the Settings "reset" button). */
export function resetSettings(): NudgeSettings {
  // mergeSettings with an empty patch yields fresh nested objects (no shared
  // references back into DEFAULT_SETTINGS).
  current = mergeSettings(DEFAULT_SETTINGS, {})
  store?.set('settings', current)
  return current
}
