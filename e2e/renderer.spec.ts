import { test, expect, type Page } from '@playwright/test'
import { DEFAULT_SETTINGS, type NudgeSettings, type SettingsPatch } from '../src/shared/settings'
import type { NudgeApi } from '../src/preload'

declare global {
  interface Window {
    testNudge: {
      ignored: boolean
      closed: string[]
      audioEnabled: boolean
      mediaRequests: number
      emit(name: string, payload: unknown): void
    }
  }
}

async function boot(page: Page, paused = false): Promise<void> {
  await page.addInitScript(
    ({ defaults, paused }) => {
      let settings = { ...defaults, runtime: { paused } }
      const listeners = new Map<string, Set<(payload: unknown) => void>>()
      function subscribe<T>(name: string, listener: (payload: T) => void): () => void {
        const wrapper = (payload: unknown): void => listener(payload as T)
        if (!listeners.has(name)) listeners.set(name, new Set())
        listeners.get(name)!.add(wrapper)
        return () => {
          listeners.get(name)?.delete(wrapper)
        }
      }
      window.testNudge = {
        ignored: true,
        closed: [],
        audioEnabled: false,
        mediaRequests: 0,
        emit(name, payload) {
          for (const listener of listeners.get(name) ?? []) listener(payload)
        }
      }
      // Any regression to browser capture would reintroduce the DND trigger.
      for (const method of ['getDisplayMedia', 'getUserMedia'] as const) {
        if (navigator.mediaDevices)
          navigator.mediaDevices[method] = async () => {
            window.testNudge.mediaRequests++
            throw new Error('Browser capture must not be used for dancing')
          }
      }
      const api: NudgeApi = {
        setAudioMonitoring(enabled) {
          window.testNudge.audioEnabled = enabled
        },
        onAudioLevel: (callback) => subscribe('audio', callback),
        async getSettings() {
          return settings
        },
        async setSettings(patch: SettingsPatch) {
          settings = {
            appearance: { ...settings.appearance, ...patch.appearance },
            general: { ...settings.general, ...patch.general },
            behavior: { ...settings.behavior, ...patch.behavior },
            runtime: { ...settings.runtime, ...patch.runtime }
          }
          window.testNudge.emit('settings', settings)
          return settings
        },
        async resetSettings() {
          settings = defaults
          window.testNudge.emit('settings', settings)
          return settings
        },
        async getGeometry() {
          return {
            width: innerWidth,
            height: innerHeight,
            workArea: { x: 0, y: 0, width: innerWidth, height: innerHeight - 40 }
          }
        },
        setMouseIgnore(ignore) {
          window.testNudge.ignored = ignore
        },
        closeNotification(id) {
          window.testNudge.closed.push(id)
        },
        onSettingsChanged: (callback) => subscribe('settings', callback),
        onGeometryChanged: (callback) => subscribe('geometry', callback),
        onNotificationAppeared: (callback) => subscribe('notification', callback),
        onNotificationClosed: (callback) => subscribe('closed', callback),
        onWebcamChanged: (callback) => subscribe('webcam', callback),
        onCompanionEvent: (callback) => subscribe('companion', callback)
      }
      window.nudge = api
    },
    { defaults: DEFAULT_SETTINGS as NudgeSettings, paused }
  )
  await page.goto('/')
  await expect(page.locator('.sprite-container canvas')).toBeVisible()
}

async function petPoint(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('.sprite-container').boundingBox()
  if (!box) throw new Error('Pet missing')
  return { x: box.x + box.width * 0.5, y: box.y + box.height * 0.7 }
}

test('right-click sleeps at the top-left; notifications do not wake it; left-click resumes', async ({
  page
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await boot(page)
  const pet = page.locator('.sprite-container')
  const point = await petPoint(page)
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await expect(pet).toHaveAttribute('data-state', 'sleepTravel')
  await expect(pet).toHaveAttribute('data-state', 'sleeping', { timeout: 15000 })
  const bed = await pet.boundingBox()
  expect(bed!.x).toBeCloseTo(12)
  expect(bed!.y).toBeCloseTo(12)
  await page.evaluate(async () => {
    await window.nudge.setSettings({ behavior: { mode: 'autoClose' } })
    window.testNudge.emit('notification', {
      id: 'asleep',
      rect: { x: 300, y: 350, width: 250, height: 150 },
      interactive: false
    })
    window.testNudge.emit('webcam', { inUse: true })
  })
  await expect(pet).toHaveAttribute('data-state', 'sleeping')
  expect(await page.evaluate(() => window.testNudge.closed)).toEqual([])
  const sleepingPoint = await petPoint(page)
  await page.mouse.click(sleepingPoint.x, sleepingPoint.y)
  await expect(pet).toHaveAttribute('data-state', 'wander')
  await expect
    .poll(async () => {
      const awake = (await pet.boundingBox())!
      return Math.hypot(awake.x - bed!.x, awake.y - bed!.y)
    })
    .toBeGreaterThan(8)
  expect(errors).toEqual([])
})

test('dancing is enabled by default and follows native meter levels without media capture', async ({
  page
}) => {
  await boot(page)
  await expect.poll(() => page.evaluate(() => window.testNudge.audioEnabled)).toBe(true)
  await page.evaluate(async () => {
    // Three distinct musical onsets, with quiet intervals to re-arm the detector.
    for (let beat = 0; beat < 4; beat++) {
      for (let frame = 0; frame < 20; frame++) {
        window.testNudge.emit('audio', { level: frame < 2 ? 0.64 : 0.001, available: true })
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
  })
  const pet = page.locator('.sprite-container')
  await expect(pet).toHaveAttribute('data-state', 'dance')
  await expect(pet.locator('canvas')).toHaveAttribute('data-orientation', 'front')
  expect(await page.evaluate(() => window.testNudge.mediaRequests)).toBe(0)
  await page.evaluate(() => window.testNudge.emit('audio', { level: 0, available: false }))
  await expect(pet).not.toHaveAttribute('data-state', 'dance')
  await page.evaluate(() => window.nudge.setSettings({ general: { reactToAudio: false } }))
  await expect.poll(() => page.evaluate(() => window.testNudge.audioEnabled)).toBe(false)
})

test('sleep can be cancelled while travelling and works while paused', async ({ page }) => {
  await boot(page, true)
  const pet = page.locator('.sprite-container')
  let point = await petPoint(page)
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await expect(pet).toHaveAttribute('data-state', 'sleepTravel')
  point = await petPoint(page)
  await page.mouse.click(point.x, point.y)
  await expect(pet).toHaveAttribute('data-state', 'wander')
  point = await petPoint(page)
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await expect(pet).toHaveAttribute('data-state', 'sleeping', { timeout: 15000 })
})

test('drag preserves the grabbed point and settings preserve placement', async ({ page }) => {
  await boot(page, true)
  const pet = page.locator('.sprite-container')
  const before = (await pet.boundingBox())!
  await page.mouse.move(before.x + 12, before.y + 50)
  await page.mouse.down()
  await page.mouse.move(before.x + 112, before.y - 50, { steps: 12 })
  await page.mouse.up()
  await expect(pet).toHaveAttribute('data-state', 'idle')
  const after = (await pet.boundingBox())!
  expect(after.x - before.x).toBeCloseTo(100)
  expect(after.y - before.y).toBeCloseTo(-100)
  await page.evaluate(() =>
    window.nudge.setSettings({ appearance: { moodDefault: 'chill', colorTheme: 'ash' } })
  )
  expect((await pet.boundingBox())!.y).toBeCloseTo(after.y)
  await page.evaluate(() => window.nudge.setSettings({ appearance: { size: 'large' } }))
  const resized = (await pet.boundingBox())!
  expect(resized.y + resized.height).toBeCloseTo(after.y + after.height)
})

test('moving away from a stationary pointer restores click-through', async ({ page }) => {
  await boot(page)
  const point = await petPoint(page)
  await page.mouse.move(point.x, point.y)
  await expect.poll(() => page.evaluate(() => window.testNudge.ignored)).toBe(false)
  await expect
    .poll(() => page.evaluate(() => window.testNudge.ignored), { timeout: 10000 })
    .toBe(true)
})

test('resizing the display relocates the bed and keeps the pet asleep', async ({ page }) => {
  await boot(page)
  const point = await petPoint(page)
  await page.mouse.click(point.x, point.y, { button: 'right' })
  const pet = page.locator('.sprite-container')
  await expect(pet).toHaveAttribute('data-state', 'sleeping', { timeout: 15000 })
  await page.evaluate(() =>
    window.testNudge.emit('geometry', {
      width: 600,
      height: 500,
      workArea: { x: 40, y: 0, width: 560, height: 460 }
    })
  )
  await expect(pet).toHaveAttribute('data-state', 'sleeping')
  const box = (await pet.boundingBox())!
  expect(box.x).toBeCloseTo(52)
  expect(box.y).toBeCloseTo(12)
})

test('normal roaming changes height and briefly shows a front profile', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.2
  })
  await boot(page)
  const pet = page.locator('.sprite-container')
  const canvas = pet.locator('canvas')
  const before = (await pet.boundingBox())!
  await expect(pet).toHaveAttribute('data-state', 'wander')
  await expect.poll(async () => (await pet.boundingBox())!.y).toBeLessThan(before.y - 20)
  await expect(canvas).toHaveAttribute('data-orientation', 'front', { timeout: 8000 })
  await expect(pet).toHaveAttribute('data-state', 'wander')
  await expect(canvas).toHaveAttribute('data-orientation', 'profile', { timeout: 4000 })
})

test('notification dash faces front to close, holds its finish, then wanders', async ({ page }) => {
  await boot(page)
  await page.evaluate(async () => {
    await window.nudge.setSettings({
      behavior: { mode: 'autoClose' },
      appearance: { moodDefault: 'grumpy' }
    })
    window.testNudge.emit('notification', {
      id: 'toast',
      rect: { x: 640, y: 60, width: 150, height: 200 },
      interactive: false
    })
  })
  const pet = page.locator('.sprite-container')
  const canvas = pet.locator('canvas')
  await expect(canvas).toHaveAttribute('data-expression', 'angry')
  await page.evaluate(() => window.testNudge.emit('closed', { id: 'unrelated' }))
  await expect(canvas).toHaveAttribute('data-expression', 'angry')
  await expect(pet).toHaveAttribute('data-state', 'interact', { timeout: 4500 })
  await expect(canvas).toHaveAttribute('data-orientation', 'front')
  await expect.poll(() => page.evaluate(() => window.testNudge.closed)).toEqual(['toast'])
  await page.evaluate(() => window.testNudge.emit('closed', { id: 'toast' }))
  await expect(pet).toHaveAttribute('data-state', 'celebrate')
  await expect(canvas).toHaveAttribute('data-orientation', 'front')
  await expect(canvas).toHaveAttribute('data-expression', 'grumpy')
  await expect
    .poll(() =>
      page.locator('.stage > canvas').evaluate((element: HTMLCanvasElement) => {
        const pixels = element
          .getContext('2d')!
          .getImageData(0, 0, element.width, element.height).data
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) return false
        return true
      })
    )
    .toBe(true)
  await expect(pet).toHaveAttribute('data-state', 'wander')
  await expect(canvas).toHaveAttribute('data-orientation', 'profile')
  await expect(canvas).toHaveAttribute('data-expression', 'grumpy')
})

test('webcam reaction shows a cute front face and then resumes roaming', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => window.testNudge.emit('webcam', { inUse: true }))
  const pet = page.locator('.sprite-container')
  await expect(pet).toHaveAttribute('data-state', 'posing', { timeout: 5000 })
  await expect(pet.locator('canvas')).toHaveAttribute('data-orientation', 'front')
  await expect(pet.locator('canvas')).toHaveAttribute('data-expression', 'excited')
  await expect(pet).toHaveAttribute('data-state', 'idle', { timeout: 5000 })
})

test('each animal offers selectable coat variants with a live front preview', async ({ page }) => {
  await boot(page)
  await page.goto('/settings.html')
  await page.getByRole('button', { name: 'Fox', exact: true }).click()
  await expect(page.locator('.swatch')).toHaveCount(15)
  await page.getByRole('button', { name: 'Arctic white', exact: true }).click()
  await expect(page.locator('.coat-name')).toHaveText('Arctic white')
  await expect(page.locator('.preview-stage canvas')).toHaveAttribute('data-orientation', 'front')
  await page.getByRole('button', { name: 'Panda', exact: true }).click()
  await page.getByRole('button', { name: 'Brown panda', exact: true }).click()
  await expect(page.locator('.coat-name')).toHaveText('Brown panda')
  expect((await page.evaluate(() => window.nudge.getSettings())).appearance).toMatchObject({
    character: 'panda',
    colorTheme: 'natural-warm'
  })
})

test('sleep corner can be changed while asleep and stays clear of the taskbar', async ({
  page
}) => {
  await boot(page, true)
  await page.evaluate(() =>
    window.nudge.setSettings({ behavior: { sleepPosition: 'bottom-right' } })
  )
  const point = await petPoint(page)
  await page.mouse.click(point.x, point.y, { button: 'right' })
  const pet = page.locator('.sprite-container')
  await expect(pet).toHaveAttribute('data-state', 'sleeping', { timeout: 8000 })
  let box = (await pet.boundingBox())!
  expect(box.x).toBeCloseTo(708)
  expect(box.y).toBeCloseTo(468)
  await page.evaluate(() =>
    window.nudge.setSettings({ behavior: { sleepPosition: 'top-right', wanderSpeed: 25 } })
  )
  await expect(pet).toHaveAttribute('data-state', 'sleeping', { timeout: 8000 })
  box = (await pet.boundingBox())!
  expect(box.x).toBeCloseTo(708)
  expect(box.y).toBeCloseTo(12)
  await expect(pet.locator('canvas')).toHaveAttribute('data-expression', 'sleepy')
})

test('settings provide a saved corner choice, keyboard speed slider, and seven mood previews', async ({
  page
}) => {
  await boot(page)
  await page.goto('/settings.html')
  await expect(page.getByRole('button', { name: 'Top left', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await page.getByRole('button', { name: 'Top right', exact: true }).click()
  await expect
    .poll(
      async () => (await page.evaluate(() => window.nudge.getSettings())).behavior.sleepPosition
    )
    .toBe('top-right')
  const slider = page.getByRole('slider', { name: 'Wandering speed' })
  await expect(slider).toHaveValue('100')
  await slider.focus()
  await slider.press('End')
  await expect
    .poll(async () => (await page.evaluate(() => window.nudge.getSettings())).behavior.wanderSpeed)
    .toBe(200)
  await expect(page.locator('.speed-heading output')).toHaveText('200%')
  await slider.press('Home')
  await expect
    .poll(async () => (await page.evaluate(() => window.nudge.getSettings())).behavior.wanderSpeed)
    .toBe(25)
  await expect(page.locator('.mood-card')).toHaveCount(7)
  await page.getByRole('button', { name: 'Chill', exact: true }).click()
  await expect(page.locator('.preview-stage canvas')).toHaveAttribute('data-expression', 'chill')
  await page.getByRole('button', { name: 'Grumpy', exact: true }).click()
  await expect(page.locator('.preview-stage canvas')).toHaveAttribute('data-expression', 'grumpy')
})
