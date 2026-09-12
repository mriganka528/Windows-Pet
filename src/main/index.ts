import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray
} from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { getSettings, initSettings, resetSettings, updateSettings } from './settingsStore'
import { TRAY_ICON_DATA_URL } from './trayIcon'
import {
  NotificationWatcher,
  type WatcherAppeared,
  type WatcherClosed
} from './notificationWatcher'
import { WebcamWatcher } from './webcamWatcher'
import { SystemAudioMonitor } from './systemAudio'
import { NotificationForeground } from './notificationForeground'
import { screenPointToLocalPoint, screenRectToLocalRect } from '../shared/coords'
import { MOOD_ORDER, MOOD_LABELS } from '../shared/settings'
import type { NudgeSettings, SettingsPatch, MoodDefault } from '../shared/settings'

// ---------------------------------------------------------------------------
// Nudge — main process
// ---------------------------------------------------------------------------
// Phase 0: a transparent, frameless, always-on-top, click-through overlay that
// hosts the companion. Phase 2 adds the app "shell": a system-tray presence, a
// Settings window, and persisted preferences (electron-store). The app now
// lives in the tray and keeps running with no visible windows, which is why the
// old "quit when all windows close" behavior is deliberately gone.
//
// Windows-specific gotchas are called out inline with [WIN] tags.

let overlayWindow: BrowserWindow | null = null
const notificationForeground = new NotificationForeground(() => overlayWindow)
let settingsWindow: BrowserWindow | null = null
let tray: Tray | null = null
// Set true only when the user really means to exit (tray → Quit), so closing
// the Settings window just closes that window rather than the whole app.
let isQuitting = false

// The Phase 5 native-notification supervisor (spawns + talks to the C# watcher).
// Null until app-ready. If the watcher can't run, this stays alive but simply
// never reports toasts — the companion falls back to wander-only.
let notificationWatcher: NotificationWatcher | null = null
// Tri-state so the tray doesn't flash a scary "unavailable" line during the
// brief window between launch and the first pipe connection. Only 'unavailable'
// (exe missing / gave up after repeated crashes) surfaces a warning.
let notificationStatus: 'starting' | 'available' | 'unavailable' = 'starting'
// Feature 3: polls the OS webcam consent store and reports in-use edges so the
// overlay can do its "scurry under the camera + pose" bit. Null while the
// reactToWebcam setting is off or Nudge is paused (see syncWebcamWatcher). It
// reads only a boolean out of the registry — never any camera frames.
let webcamWatcher: WebcamWatcher | null = null
let audioMonitor: SystemAudioMonitor | null = null
let audioRequested = false

// [WIN/electron-vite] In dev, electron-vite serves the renderer from a dev
// server and exposes its URL via the ELECTRON_RENDERER_URL env var. In a
// production build that var is absent and we load the built HTML file from
// disk. (Note: MAIN_WINDOW_VITE_DEV_SERVER_URL is an electron-FORGE convention
// and does NOT exist here — referencing it would throw at runtime.)
const RENDERER_DEV_URL = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']

function overlayGeometry(): {
  width: number
  height: number
  workArea: { x: number; y: number; width: number; height: number }
} {
  const display = screen.getPrimaryDisplay()
  const origin = overlayWindow?.getBounds() ?? display.bounds
  return {
    width: origin.width,
    height: origin.height,
    workArea: {
      ...display.workArea,
      x: display.workArea.x - origin.x,
      y: display.workArea.y - origin.y
    }
  }
}

function syncOverlayDisplay(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  overlayWindow.setBounds(screen.getPrimaryDisplay().bounds)
  overlayWindow.webContents.send('overlay:geometry-changed', overlayGeometry())
}

ipcMain.handle('overlay:get-geometry', () => overlayGeometry())

function createOverlayWindow(): void {
  // Size the overlay to the primary display's full work-area-inclusive bounds.
  // [WIN] Use `bounds` (not `workArea`) so the overlay also covers the taskbar
  // strip — the companion walks along the taskbar edge per the UI/UX doc.
  const primary = screen.getPrimaryDisplay()
  const { x, y, width, height } = primary.bounds

  overlayWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    // --- Transparency / frameless ---
    transparent: true,
    frame: false,
    // [WIN] `transparent: true` requires `backgroundColor` to be fully
    // transparent OR omitted. Do NOT set a solid backgroundColor or the whole
    // window paints opaque and you lose see-through. Also, on Windows the
    // transparent window cannot be resized once created without visual
    // artifacts — we simply never resize it.
    hasShadow: false,
    // --- Always on top ---
    // [WIN] 'screen-saver' is the highest standard level and keeps the overlay
    // above full-screen-ish app windows. Drawing above Windows shell toasts
    // additionally requires the signed, installed UIAccess edition.
    alwaysOnTop: true,
    // --- Taskbar / focus behavior ---
    skipTaskbar: true, // no taskbar button for the overlay
    focusable: false, // [WIN] prevents the overlay from stealing focus/click
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // [WIN] `show: false` until ready-to-show avoids a white flash frame while
    // the transparent renderer paints for the first time.
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Keep Electron's security defaults: context isolation ON, node
      // integration OFF, sandbox ON (this is why we build preload as CJS).
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Pin the always-on-top level explicitly. Passing the level again here is
  // belt-and-suspenders on some Windows builds where the constructor flag
  // alone occasionally lands at a lower level.
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')

  // [WIN] Show the overlay on every virtual desktop / workspace. On Windows
  // this keeps the companion visible when the user switches desktops.
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // --- Click-through by default ---
  // `forward: true` means: keep IGNORING mouse events (pass them to the window
  // below), BUT still forward move events to the renderer so it can detect when
  // the cursor is hovering the sprite and ask us to re-enable interaction.
  // [WIN] `forward: true` is only honored on Windows and macOS — exactly our
  // target platform. Without it, the renderer would never see the mousemove
  // that tells it the cursor entered the sprite, so click-through could never
  // turn back off.
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })

  // Load renderer: dev server URL in dev, built file in prod.
  if (RENDERER_DEV_URL) {
    void overlayWindow.loadURL(RENDERER_DEV_URL)
  } else {
    void overlayWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  overlayWindow.once('ready-to-show', () => {
    overlayWindow?.show()
  })

  overlayWindow.on('closed', () => {
    notificationForeground.stop()
    overlayWindow = null
    stopAudioMonitor()
  })
  overlayWindow.webContents.on('render-process-gone', stopAudioMonitor)
  overlayWindow.webContents.on('render-process-gone', () => notificationForeground.stop())
  overlayWindow.webContents.on('did-start-loading', stopAudioMonitor)
}

// ---------------------------------------------------------------------------
// Settings window
// ---------------------------------------------------------------------------
// A normal, opaque, focusable window (unlike the overlay). Opened from the tray;
// closing it just hides it away (the app keeps running in the tray). We keep a
// single instance and focus it if it's already open.
function createSettingsWindow(): void {
  if (settingsWindow) {
    settingsWindow.show()
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 460,
    height: 640,
    minWidth: 380,
    minHeight: 480,
    title: 'Nudge Settings',
    // A tidy, standard window — no always-on-top, no transparency.
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // [electron-vite] The second renderer entry is a separate HTML file. In dev
  // it's served by the same dev server at /settings.html; in prod it's emitted
  // alongside index.html in out/renderer.
  if (RENDERER_DEV_URL) {
    void settingsWindow.loadURL(`${RENDERER_DEV_URL}/settings.html`)
  } else {
    void settingsWindow.loadFile(join(__dirname, '../renderer/settings.html'))
  }

  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.show()
  })

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
}

// ---------------------------------------------------------------------------
// Settings plumbing: broadcast + side effects
// ---------------------------------------------------------------------------
// Push the full, resolved settings to every renderer so live changes (size,
// color, mood, pause) apply immediately without a restart.
function broadcastSettings(settings: NudgeSettings): void {
  for (const win of [overlayWindow, settingsWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('settings:changed', settings)
    }
  }
}

// Run the OS-level effects a settings change implies. Renderer-side effects
// (sprite size/color/mood, pausing the wander) travel via broadcastSettings;
// this function owns things only the main process can do.
function applySettingsSideEffects(settings: NudgeSettings): void {
  // [WIN] Start-with-Windows writes a per-user registry "Run" entry pointing at
  // the current executable. Guarded to packaged builds so `npm run dev` never
  // registers the throwaway dev Electron binary to launch at login.
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: settings.general.startWithWindows })
  }
  // Keep the tray menu's Pause/Resume label and status line in sync.
  refreshTrayMenu()
  // Start/stop the webcam watcher to match the current preference + pause state.
  syncWebcamWatcher(settings)
  syncAudioMonitor(settings)
}

// Feature 3: run the webcam watcher only when the user wants the reaction AND
// Nudge isn't paused. Called from applySettingsSideEffects, so any toggle of
// reactToWebcam or Pause re-syncs it. Disposing emits a final "off" so a pose in
// progress unwinds cleanly. Detection is registry-only — no camera is opened.
function syncWebcamWatcher(settings: NudgeSettings): void {
  const shouldRun = settings.general.reactToWebcam && !settings.runtime.paused
  if (shouldRun && !webcamWatcher) {
    webcamWatcher = new WebcamWatcher({
      onChange: forwardWebcamChange,
      log: (msg) => {
        if (!app.isPackaged) console.log(`[webcam-watcher] ${msg}`)
      }
    })
    webcamWatcher.start()
  } else if (!shouldRun && webcamWatcher) {
    webcamWatcher.dispose()
    webcamWatcher = null
  }
}

// Push a webcam in-use edge to the overlay. The watcher only runs while unpaused,
// but re-check defensively so a late "on" during teardown can't slip through.
function forwardWebcamChange(inUse: boolean): void {
  const win = overlayWindow
  if (!win || win.isDestroyed()) return
  if (inUse && getSettings().runtime.paused) return
  win.webContents.send('webcam:changed', { inUse })
}

// ---------------------------------------------------------------------------
// System tray
// ---------------------------------------------------------------------------
function buildTrayMenu(): Menu {
  const { runtime, behavior, appearance } = getSettings()
  const paused = runtime.paused
  const modeLabel = behavior.mode === 'autoClose' ? 'Auto-close mode' : 'Nudge mode'

  // The companion needs the native watcher to react to real toasts. If it can't
  // run, say so plainly (and note the app still works — the pup just wanders).
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: paused ? 'Nudge — paused' : `Nudge — active (${modeLabel})`, enabled: false }
  ]
  if (!paused && notificationStatus === 'unavailable') {
    template.push({ label: '⚠ Notifications unavailable — wander-only', enabled: false })
  }
  // Mood submenu: one radio item per preset (in the curated MOOD_ORDER), checked
  // on the current choice. Picking one applies live via setMoodDefault.
  const moodSubmenu: Electron.MenuItemConstructorOptions[] = MOOD_ORDER.map((mood) => ({
    label: MOOD_LABELS[mood],
    type: 'radio',
    checked: appearance.moodDefault === mood,
    click: () => setMoodDefault(mood)
  }))
  template.push(
    { type: 'separator' },
    {
      label: paused ? 'Resume' : 'Pause',
      click: () => setPaused(!paused)
    },
    { label: 'Mood', submenu: moodSubmenu },
    {
      label: 'Settings…',
      click: () => createSettingsWindow()
    },
    { type: 'separator' },
    {
      label: 'Quit Nudge',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  )
  return Menu.buildFromTemplate(template)
}

function refreshTrayMenu(): void {
  tray?.setContextMenu(buildTrayMenu())
}

function createTray(): void {
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
  tray = new Tray(icon)
  tray.setToolTip('Nudge')
  refreshTrayMenu()
  // Double-clicking the tray icon opens Settings — a familiar Windows gesture.
  tray.on('double-click', () => createSettingsWindow())
}

// Toggle the paused runtime flag: persist it, run side effects, and broadcast
// so the overlay freezes/thaws its wandering. Interaction (drag/pet) stays live
// even while paused.
function setPaused(paused: boolean): void {
  const next = updateSettings({ runtime: { paused } })
  applySettingsSideEffects(next)
  broadcastSettings(next)
}

// Change the resting mood preset from the tray. Persists, re-runs side effects
// (which refreshes the tray so the new checkmark shows), and broadcasts so the
// overlay swaps its resting face + energy live — no Settings window needed.
function setMoodDefault(moodDefault: MoodDefault): void {
  const next = updateSettings({ appearance: { moodDefault } })
  applySettingsSideEffects(next)
  broadcastSettings(next)
}

// ---------------------------------------------------------------------------
// IPC: settings (renderer <-> main)
// ---------------------------------------------------------------------------
ipcMain.handle('settings:get', () => getSettings())

ipcMain.handle('settings:set', (_event, patch: SettingsPatch) => {
  const next = updateSettings(patch)
  applySettingsSideEffects(next)
  broadcastSettings(next)
  return next
})

ipcMain.handle('settings:reset', () => {
  const next = resetSettings()
  applySettingsSideEffects(next)
  broadcastSettings(next)
  return next
})

// ---------------------------------------------------------------------------
// IPC: the renderer toggles click-through as the cursor enters/leaves the sprite
// ---------------------------------------------------------------------------
// When ignore === true  -> overlay is click-through (cursor is NOT on sprite).
// When ignore === false -> overlay captures the mouse (cursor IS on sprite),
// so drag/pet interactions work.
ipcMain.on('overlay:set-mouse-ignore', (event, ignore: boolean) => {
  if (!overlayWindow || event.sender !== overlayWindow.webContents || typeof ignore !== 'boolean')
    return
  if (ignore) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true })
  } else {
    overlayWindow.setIgnoreMouseEvents(false)
  }
})

function raiseOverlayForNotification(): void {
  notificationForeground.raise()
}

ipcMain.on('overlay:raise-for-notification', (event) => {
  if (!overlayWindow || event.sender !== overlayWindow.webContents || getSettings().runtime.paused)
    return
  raiseOverlayForNotification()
})

ipcMain.on('overlay:notification-interaction', (event, active: unknown) => {
  if (!overlayWindow || event.sender !== overlayWindow.webContents || typeof active !== 'boolean')
    return
  notificationForeground.setActive(active && !getSettings().runtime.paused)
})

// ---------------------------------------------------------------------------
// Companion events (main -> renderer)
// ---------------------------------------------------------------------------
// Push an emotional trigger to the overlay. Phase 5's native notification
// watcher will call this with 'alert' when a toast appears; for now the only
// callers are the dev-only global shortcuts below, so the angry/pet reactions
// can be exercised without any of the (deliberately deferred) detection code.
type CompanionEventKind = 'alert' | 'pet' | 'calm'
function sendCompanionEvent(kind: CompanionEventKind): void {
  overlayWindow?.webContents.send('companion:event', { kind })
}

// [DEV ONLY] Simulate a Windows toast end-to-end — WITHOUT the native watcher.
// This injects the exact same 'notification:appeared' payload the real watcher
// produces, so the state machine can't tell the difference: the pet runs the
// full alert -> travel -> interact (paw-swat) reaction, and in auto-close mode
// the renderer asks us to dismiss it. It exists so the reaction can be verified
// on any machine (e.g. before the .NET 8 SDK is installed and the watcher can
// build). Gated on !app.isPackaged in registerDevShortcuts so it never ships.
//
// A simulated toast has no real window behind it, so we own its whole lifecycle:
// we open it, and we close it (either via the swat->close echo in the
// 'notification:close' handler below, or via this safety-net timer for
// notify-only mode, where the renderer never requests a close).
const SIM_PREFIX = 'dev-sim:'
const simulatedCloseTimers = new Map<string, NodeJS.Timeout>()

function simulateNotification(): void {
  const win = overlayWindow
  if (!win || win.isDestroyed()) return
  // Mirror the real forwarder's Pause gate so simulated behavior matches prod.
  if (getSettings().runtime.paused) {
    if (!app.isPackaged) console.log('[dev] simulate-notification ignored — paused')
    return
  }
  // Place a toast-sized rect in the overlay's bottom-right, where Windows shows
  // real toasts. The overlay fills the primary display, so overlay-local CSS px
  // equals the window's content size here — no screen->local conversion needed
  // (that conversion only matters for real, physical-pixel watcher events).
  const { width, height } = win.getContentBounds()
  const w = 360
  const h = 120
  const margin = 16
  const rect = {
    x: Math.max(0, width - w - margin),
    y: Math.max(0, height - h - margin),
    width: w,
    height: h
  }
  const id = `${SIM_PREFIX}${Date.now()}`

  win.webContents.send('notification:appeared', { id, rect, interactive: false })
  if (!app.isPackaged) console.log(`[dev] simulated toast ${id}`, rect)

  // Safety net: if nothing dismisses it (notify-only mode never sends a close),
  // retract it after a few seconds so the pet unwinds back to wander instead of
  // lingering forever. Auto-close mode usually beats this via the swat->close
  // echo below, which clears this timer.
  const timer = setTimeout(() => {
    simulatedCloseTimers.delete(id)
    if (!win.isDestroyed()) win.webContents.send('notification:closed', { id })
  }, 6000)
  simulatedCloseTimers.set(id, timer)
}

// [DEV ONLY] Global shortcuts to trigger reactions while there's no real
// notification source yet. Gated on !app.isPackaged so they never ship.
// N/P/C raise mood-only companion events; M simulates a full toast reaction.
function registerDevShortcuts(): void {
  if (app.isPackaged) return
  globalShortcut.register('CommandOrControl+Alt+N', () => sendCompanionEvent('alert'))
  globalShortcut.register('CommandOrControl+Alt+P', () => sendCompanionEvent('pet'))
  globalShortcut.register('CommandOrControl+Alt+C', () => sendCompanionEvent('calm'))
  // M = "mock message": inject a fake toast so the walk-over + paw-swat (+ close)
  // can be seen without the native watcher running.
  globalShortcut.register('CommandOrControl+Alt+M', () => simulateNotification())
}

// ---------------------------------------------------------------------------
// Native notification watcher (Phase 5)
// ---------------------------------------------------------------------------
// The supervisor (notificationWatcher.ts) spawns the C# watcher and hands us
// toast events in PHYSICAL screen pixels. Main is the only place that can turn
// those into the overlay's coordinate space (it owns Electron's `screen` and the
// window bounds), so conversion + forwarding lives here.

// Convert a watcher toast (physical screen px) into overlay-local CSS px and push
// it to the overlay renderer, which feeds it to the state machine.
function forwardNotificationAppeared(n: WatcherAppeared): void {
  const win = overlayWindow
  if (!win || win.isDestroyed()) return
  // Respect Pause: while paused the companion should not react to toasts at all.
  if (getSettings().runtime.paused) return

  // physical screen px -> DIP (÷ display scale) -> overlay-local (− window origin).
  // Exact for the primary-display overlay; mixed-scale multi-monitor is deferred
  // (see shared/coords.ts and IMPLEMENTATION_PLAN Phase 5).
  const primary = screen.getPrimaryDisplay()
  const bounds = win.getBounds() // DIP screen coords
  const rect = screenRectToLocalRect(
    n.screenRect,
    { x: bounds.x, y: bounds.y },
    primary.scaleFactor
  )

  raiseOverlayForNotification()
  win.webContents.send('notification:appeared', {
    id: n.id,
    rect,
    closePoint: n.screenClosePoint
      ? screenPointToLocalPoint(n.screenClosePoint, bounds, primary.scaleFactor)
      : undefined,
    interactive: n.interactive
  })
}

// Forward a close event unconditionally — even while paused or for an id we never
// forwarded. The machine ignores unrecognized ids, and this reliably unwinds any
// in-progress reaction if a toast disappears.
function forwardNotificationClosed(n: WatcherClosed): void {
  const win = overlayWindow
  if (!win || win.isDestroyed()) return
  win.webContents.send('notification:closed', { id: n.id })
}

// Renderer -> main: the companion has finished its paw-swat and wants this toast
// dismissed (Phase 6). We are the trust boundary: only relay the request to the
// watcher when the user is actually in auto-close mode and not paused. The
// renderer already enforces this, but re-checking here means a renderer bug can
// never dismiss a toast the user didn't opt into. Only an id crosses — no text.
ipcMain.on('notification:close', (_event, id: unknown) => {
  if (typeof id !== 'string' || id.length === 0) return
  // [DEV ONLY] A simulated toast has no real window to Invoke (and the watcher may
  // not be running at all), so we can't route it through the watcher. Echo the
  // close straight back to the overlay so the paw-swat visibly dismisses the fake
  // toast and the machine unwinds, and cancel its safety-net timer.
  if (id.startsWith(SIM_PREFIX)) {
    const timer = simulatedCloseTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      simulatedCloseTimers.delete(id)
    }
    overlayWindow?.webContents.send('notification:closed', { id })
    return
  }
  const { runtime, behavior } = getSettings()
  if (runtime.paused || behavior.mode !== 'autoClose') return
  notificationWatcher?.sendClose(id)
})

// Create + start the supervisor. It self-degrades to wander-only if the watcher
// executable is missing or keeps failing, reporting that through availability.
function startNotificationWatcher(): void {
  notificationWatcher = new NotificationWatcher({
    onAppeared: forwardNotificationAppeared,
    onClosed: forwardNotificationClosed,
    onAvailabilityChange: (available) => {
      notificationStatus = available ? 'available' : 'unavailable'
      refreshTrayMenu()
    },
    // Diagnostics only (the watcher already redacts any text); dev console only.
    log: (msg) => {
      if (!app.isPackaged) console.log(`[notification-watcher] ${msg}`)
    }
  })
  notificationWatcher.start()
}

// ---------------------------------------------------------------------------
// Read-only Windows audio metering. It never opens a capture/sharing session.
// ---------------------------------------------------------------------------
function resolveAudioHelper(): string | null {
  const override = process.env['NUDGE_WATCHER_EXE']
  if (!app.isPackaged && override && existsSync(override)) return override
  if (app.isPackaged) {
    const exe = join(process.resourcesPath, 'watcher', 'NudgeWatcher.exe')
    return existsSync(exe) ? exe : null
  }
  const root = app.getAppPath()
  for (const configuration of ['Debug', 'Release']) {
    const exe = join(
      root,
      'native',
      'NudgeWatcher',
      'bin',
      configuration,
      'net8.0-windows10.0.19041.0',
      'NudgeWatcher.exe'
    )
    if (existsSync(exe)) return exe
  }
  return null
}

function stopAudioMonitor(): void {
  audioRequested = false
  audioMonitor?.dispose()
  audioMonitor = null
}

function syncAudioMonitor(settings: NudgeSettings): void {
  if (!audioRequested || !settings.general.reactToAudio || settings.runtime.paused) {
    audioMonitor?.dispose()
    audioMonitor = null
    return
  }
  if (audioMonitor || process.platform !== 'win32') return
  audioMonitor = new SystemAudioMonitor({
    resolveExecutable: resolveAudioHelper,
    onLevel: (sample) => {
      const win = overlayWindow
      if (
        win &&
        !win.isDestroyed() &&
        audioRequested &&
        getSettings().general.reactToAudio &&
        !getSettings().runtime.paused
      ) {
        win.webContents.send('audio:level', sample)
      }
    },
    log: (message) => console.log('[audio-meter] ' + message)
  })
  audioMonitor.start()
}

ipcMain.on('audio:set-monitoring', (event, enabled: unknown) => {
  if (!overlayWindow || event.sender !== overlayWindow.webContents || typeof enabled !== 'boolean')
    return
  audioRequested = enabled
  syncAudioMonitor(getSettings())
})

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
// [WIN] Single-instance lock: without this, launching a second time spawns a
// second overlay stacked on the first. Required for a persistent tray app.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // Someone tried to launch a second time — surface Settings so the user gets
    // feedback that Nudge is already running, and ensure the overlay exists.
    if (!overlayWindow) createOverlayWindow()
    createSettingsWindow()
  })

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.nudge.desktop')
    // Load persisted settings BEFORE any window/tray so the overlay can read
    // them on first paint and the tray menu reflects the real state.
    const settings = initSettings()
    createOverlayWindow()
    screen.on('display-metrics-changed', syncOverlayDisplay)
    screen.on('display-added', syncOverlayDisplay)
    screen.on('display-removed', syncOverlayDisplay)
    createTray()
    // Apply startup side effects (login item) and paint the initial tray menu.
    applySettingsSideEffects(settings)
    registerDevShortcuts()
    // Start watching for real toasts (Phase 5). Safe if the watcher is absent —
    // it just reports "unavailable" and the companion stays wander-only.
    startNotificationWatcher()

    app.on('activate', () => {
      if (!overlayWindow) createOverlayWindow()
    })
  })

  // Release global shortcuts, stop the watcher, and tear down the tray on exit.
  app.on('will-quit', () => {
    notificationForeground.stop()
    globalShortcut.unregisterAll()
    // Cancel any outstanding [DEV ONLY] simulated-toast retract timers.
    for (const timer of simulatedCloseTimers.values()) clearTimeout(timer)
    simulatedCloseTimers.clear()
    notificationWatcher?.dispose()
    notificationWatcher = null
    webcamWatcher?.dispose()
    webcamWatcher = null
    stopAudioMonitor()
    tray?.destroy()
    tray = null
  })

  app.on('before-quit', () => {
    isQuitting = true
  })

  // [WIN/Phase 2] Nudge is a tray app: it must keep running with no visible
  // windows. So — unlike Phase 0 — we do NOT quit when all windows close. The
  // overlay normally never closes; even if it did, the app stays alive in the
  // tray until the user chooses Quit. (isQuitting guards the real exit path.)
  app.on('window-all-closed', () => {
    if (isQuitting && process.platform !== 'darwin') app.quit()
  })
}
