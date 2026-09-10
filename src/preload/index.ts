import { contextBridge, ipcRenderer } from 'electron'
import type { NudgeSettings, SettingsPatch } from '../shared/settings'
import type { AudioLevel } from '../shared/audio'

// ---------------------------------------------------------------------------
// Preload — the ONLY bridge between the sandboxed renderer and the main process.
// ---------------------------------------------------------------------------
// With contextIsolation on and sandbox on, the renderer has no direct access to
// Node or Electron. We expose a minimal, explicit API on `window.nudge`.
// Keeping the surface tiny is a security posture: the renderer can ask to
// toggle click-through, and nothing else.

// A companion event pushed FROM main TO the renderer. `alert` is what a real
// notification will raise (Phase 5); `pet`/`calm` exist so the mood system can
// be driven/tested from the tray or dev shortcuts without touching detection.
export interface CompanionEvent {
  kind: 'alert' | 'pet' | 'calm'
}

// A notification the watcher detected, AFTER main has converted its geometry from
// physical screen pixels into overlay-window-local CSS px (see shared/coords). The
// renderer feeds this straight to the state machine — no content, only geometry +
// metadata (ARCHITECTURE.md §7).
export interface NotificationAppearedPayload {
  /** Stable id assigned by the watcher; matches the later "closed" event. */
  id: string
  /** Toast rectangle in overlay-local CSS px. */
  rect: { x: number; y: number; width: number; height: number }
  /** True if the toast exposes actions (reply/buttons). */
  interactive: boolean
}

export interface NotificationClosedPayload {
  id: string
}

// A webcam in-use transition (Feature 3). Detection lives entirely in main (it
// reads the OS consent store — no camera access, no frames); only this boolean
// crosses the bridge, and only on edges (on → true, off → false).
export interface WebcamChangedPayload {
  inUse: boolean
}

export interface OverlayGeometry {
  width: number
  height: number
  workArea: { x: number; y: number; width: number; height: number }
}

const api = {
  setAudioMonitoring(enabled: boolean): void {
    ipcRenderer.send('audio:set-monitoring', enabled)
  },
  onAudioLevel(callback: (sample: AudioLevel) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, sample: AudioLevel): void =>
      callback(sample)
    ipcRenderer.on('audio:level', listener)
    return () => ipcRenderer.removeListener('audio:level', listener)
  },
  getGeometry(): Promise<OverlayGeometry> {
    return ipcRenderer.invoke('overlay:get-geometry')
  },
  onGeometryChanged(callback: (geometry: OverlayGeometry) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, geometry: OverlayGeometry): void =>
      callback(geometry)
    ipcRenderer.on('overlay:geometry-changed', listener)
    return () => ipcRenderer.removeListener('overlay:geometry-changed', listener)
  },
  /**
   * Tell the overlay whether to ignore mouse events (click-through).
   * @param ignore true  = pass clicks through to apps below (cursor off sprite)
   *               false = capture the mouse so the sprite is interactive
   */
  setMouseIgnore(ignore: boolean): void {
    ipcRenderer.send('overlay:set-mouse-ignore', ignore)
  },

  /**
   * Subscribe to companion events from the main process (e.g. a notification
   * making the pup angry). Returns an unsubscribe function.
   */
  onCompanionEvent(callback: (event: CompanionEvent) => void): () => void {
    const listener = (_e: Electron.IpcRendererEvent, event: CompanionEvent): void => callback(event)
    ipcRenderer.on('companion:event', listener)
    return () => ipcRenderer.removeListener('companion:event', listener)
  },

  /**
   * Subscribe to "a toast appeared" events (Phase 5). The rect is already in
   * overlay-local CSS px. Returns an unsubscribe function.
   */
  onNotificationAppeared(callback: (payload: NotificationAppearedPayload) => void): () => void {
    const listener = (_e: Electron.IpcRendererEvent, payload: NotificationAppearedPayload): void =>
      callback(payload)
    ipcRenderer.on('notification:appeared', listener)
    return () => ipcRenderer.removeListener('notification:appeared', listener)
  },

  /**
   * Subscribe to "a toast closed" events (Phase 5). Returns an unsubscribe function.
   */
  onNotificationClosed(callback: (payload: NotificationClosedPayload) => void): () => void {
    const listener = (_e: Electron.IpcRendererEvent, payload: NotificationClosedPayload): void =>
      callback(payload)
    ipcRenderer.on('notification:closed', listener)
    return () => ipcRenderer.removeListener('notification:closed', listener)
  },

  /**
   * Ask main to dismiss a toast the companion just pawed (Phase 6, auto-close
   * mode). Fire-and-forget: `id` is the watcher-minted identifier from a prior
   * `onNotificationAppeared` — no notification text ever crosses this bridge.
   * Main is the trust boundary and will ignore this unless the user is actually
   * in auto-close mode and not paused, so a renderer bug can't dismiss a toast
   * the user didn't opt into.
   */
  closeNotification(id: string): void {
    ipcRenderer.send('notification:close', id)
  },

  /**
   * Subscribe to webcam in-use transitions (Feature 3). Fires true when the
   * camera goes live and false when it's released (edges only, never per poll),
   * so the overlay can send its pose/resume events. Only a boolean crosses — no
   * camera imagery or app identity. Returns an unsubscribe function.
   */
  onWebcamChanged(callback: (payload: WebcamChangedPayload) => void): () => void {
    const listener = (_e: Electron.IpcRendererEvent, payload: WebcamChangedPayload): void =>
      callback(payload)
    ipcRenderer.on('webcam:changed', listener)
    return () => ipcRenderer.removeListener('webcam:changed', listener)
  },

  // --- Settings (persisted preferences) -----------------------------------
  /** Fetch the current settings (resolved against defaults). */
  getSettings(): Promise<NudgeSettings> {
    return ipcRenderer.invoke('settings:get')
  },

  /**
   * Apply a partial change. Main merges + persists it, runs side effects, and
   * broadcasts the result; the resolved full settings are also returned here.
   */
  setSettings(patch: SettingsPatch): Promise<NudgeSettings> {
    return ipcRenderer.invoke('settings:set', patch)
  },

  /** Restore every setting to its default. */
  resetSettings(): Promise<NudgeSettings> {
    return ipcRenderer.invoke('settings:reset')
  },

  /**
   * Subscribe to settings changes (from any window or the tray). Fires with the
   * full settings object. Returns an unsubscribe function.
   */
  onSettingsChanged(callback: (settings: NudgeSettings) => void): () => void {
    const listener = (_e: Electron.IpcRendererEvent, settings: NudgeSettings): void =>
      callback(settings)
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  }
}

contextBridge.exposeInMainWorld('nudge', api)

// Export the API type so the renderer can type `window.nudge` (see index.d.ts).
export type NudgeApi = typeof api
