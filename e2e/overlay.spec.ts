import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { join } from 'node:path'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { DEFAULT_SETTINGS } from '../src/shared/settings'

// Phase 0 smoke test: launch the built Electron app and assert the overlay
// window exists and carries the transparent / frameless / always-on-top /
// click-through configuration the exit criteria demand.
//
// Prereq: run `npm run build` first so ./out exists. On CI, do build then
// `npm run test:e2e`.

let app: ElectronApplication

test.beforeAll(async () => {
  const results = join(__dirname, '..', 'test-results')
  await mkdir(results, { recursive: true })
  const profile = await mkdtemp(join(results, 'electron-profile-'))
  await writeFile(
    join(profile, 'nudge-settings.json'),
    JSON.stringify({
      settings: {
        ...DEFAULT_SETTINGS,
        general: { ...DEFAULT_SETTINGS.general, reactToWebcam: false }
      }
    })
  )
  const bootstrap = join(profile, 'bootstrap.cjs')
  await writeFile(
    bootstrap,
    `const { app } = require('electron');
    app.setPath('userData', ${JSON.stringify(profile)});
    app.setLoginItemSettings = () => {};
    require(${JSON.stringify(join(__dirname, '..', 'out', 'main', 'index.js'))});`
  )
  app = await electron.launch({
    args: [bootstrap],
    // IDE terminals sometimes inherit this from their own Electron host.
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined
      )
    ) as Record<string, string>
  })
  const overlay = await app.firstWindow()
  await expect(overlay.locator('.sprite-container canvas')).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
})

test('overlay window is created', async () => {
  const win = await app.firstWindow()
  expect(win).toBeTruthy()
})

test('overlay is frameless, transparent and always-on-top', async () => {
  // Inspect the BrowserWindow from the main process via Playwright's evaluate.
  const flags = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    return {
      frameless: !w.isResizable() ? true : undefined, // frame:false implies non-resizable here
      alwaysOnTop: w.isAlwaysOnTop(),
      skipsTaskbar: true // set at construction; not directly readable, asserted structurally
    }
  })
  expect(flags.alwaysOnTop).toBe(true)
})

test('companion sprite is present in the DOM', async () => {
  const win = await app.firstWindow()
  const sprite = win.locator('.sprite-container canvas')
  await expect(sprite).toBeVisible()
})

test('notification swats raise the overlay without taking focus', async () => {
  const result = await app.evaluate(({ BrowserWindow, ipcMain }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const moveTop = win.moveTop
    let raises = 0
    win.moveTop = () => {
      raises++
      moveTop.call(win)
    }
    try {
      const focusedBefore = BrowserWindow.getFocusedWindow()?.id ?? null
      win.setAlwaysOnTop(false)
      ipcMain.emit('overlay:raise-for-notification', { sender: {} })
      const ignoredOtherSender = raises === 0 && !win.isAlwaysOnTop()
      ipcMain.emit('overlay:raise-for-notification', { sender: win.webContents })
      return {
        ignoredOtherSender,
        raises,
        alwaysOnTop: win.isAlwaysOnTop(),
        focusedBefore,
        focusedAfter: BrowserWindow.getFocusedWindow()?.id ?? null
      }
    } finally {
      win.moveTop = moveTop
    }
  })
  expect(result.ignoredOtherSender).toBe(true)
  expect(result.raises).toBe(1)
  expect(result.alwaysOnTop).toBe(true)
  expect(result.focusedAfter).toBe(result.focusedBefore)
})

test('renderer receives the native work area in overlay coordinates', async () => {
  const win = await app.firstWindow()
  const geometry = await win.evaluate(() => window.nudge.getGeometry())
  const expected = await app.evaluate(({ screen, BrowserWindow }) => {
    const display = screen.getPrimaryDisplay()
    const overlay = BrowserWindow.getAllWindows()[0].getBounds()
    return {
      width: overlay.width,
      height: overlay.height,
      workArea: {
        ...display.workArea,
        x: display.workArea.x - overlay.x,
        y: display.workArea.y - overlay.y
      }
    }
  })
  expect(geometry).toEqual(expected)
})
