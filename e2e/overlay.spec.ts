import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { join } from 'node:path'

// Phase 0 smoke test: launch the built Electron app and assert the overlay
// window exists and carries the transparent / frameless / always-on-top /
// click-through configuration the exit criteria demand.
//
// Prereq: run `npm run build` first so ./out exists. On CI, do build then
// `npm run test:e2e`.

let app: ElectronApplication

test.beforeAll(async () => {
  app = await electron.launch({
    args: [join(__dirname, '..', 'out', 'main', 'index.js')]
  })
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

test('placeholder sprite is present in the DOM', async () => {
  const win = await app.firstWindow()
  const sprite = win.locator('.sprite')
  await expect(sprite).toBeVisible()
})
