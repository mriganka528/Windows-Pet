import { test, expect, type Page } from '@playwright/test'
import { NOTIFICATION_SETUP_TIMEOUT_SECONDS } from '../src/shared/notificationSetup'

async function bootNotice(page: Page, openWindows = true): Promise<void> {
  await page.setViewportSize({ width: 448, height: 510 })
  await page.clock.install()
  await page.addInitScript(
    ({ openWindows }) => {
      Object.assign(window, {
        noticeTest: { dismissed: 0, settings: 0, windows: 0 }
      })
      const state = (
        window as unknown as {
          noticeTest: { dismissed: number; settings: number; windows: number }
        }
      ).noticeTest
      Object.assign(window, {
        nudge: {
          dismissNotificationSetup() {
            state.dismissed++
          },
          openNotificationSetupSettings() {
            state.settings++
          },
          async openWindowsNotificationSettings() {
            state.windows++
            return openWindows
          }
        }
      })
    },
    { openWindows }
  )
  await page.goto('/notification-setup.html')
  await expect(
    page.getByRole('heading', { name: 'Let your pet close notifications' })
  ).toBeVisible()
}

const dismissals = (page: Page): Promise<number> =>
  page.evaluate(
    () => (window as unknown as { noticeTest: { dismissed: number } }).noticeTest.dismissed
  )

test('notice explains DND and Auto-close, fits its window, then closes after 25 seconds', async ({
  page
}) => {
  await bootNotice(page)
  await expect(page.getByText(/Windows may turn on Do not disturb automatically/)).toBeVisible()
  await expect(page.getByText(/Focus assist → Off/)).toBeVisible()
  await expect(page.getByText(/choose “Close them for me”/)).toBeVisible()
  const fits = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth <= innerWidth,
    height: document.documentElement.scrollHeight <= innerHeight
  }))
  expect(fits).toEqual({ width: true, height: true })
  await page.clock.runFor((NOTIFICATION_SETUP_TIMEOUT_SECONDS - 1) * 1000)
  expect(await dismissals(page)).toBe(0)
  await page.clock.runFor(1000)
  expect(await dismissals(page)).toBe(1)
})

test('hover pauses the timer and leaving resumes it', async ({ page }) => {
  await bootNotice(page)
  await page.getByRole('heading').first().hover()
  await page.clock.runFor(30000)
  expect(await dismissals(page)).toBe(0)
  await page.mouse.move(-10, -10)
  await expect(page.getByText('Closes in 25s', { exact: true })).toBeVisible()
  await page.clock.runFor(NOTIFICATION_SETUP_TIMEOUT_SECONDS * 1000)
  expect(await dismissals(page)).toBe(1)
})

test('the close button and Escape dismiss without waiting', async ({ page }) => {
  await bootNotice(page)
  await page.getByRole('button', { name: 'Close notification setup' }).click()
  expect(await dismissals(page)).toBe(1)
  await page.keyboard.press('Escape')
  expect(await dismissals(page)).toBe(2)
})

test('settings actions work and keyboard focus pauses auto-dismissal', async ({ page }) => {
  await bootNotice(page)
  await page.getByRole('button', { name: /Windows notification settings/ }).focus()
  await page.clock.runFor(30000)
  expect(await dismissals(page)).toBe(0)
  await page.getByRole('button', { name: /Windows notification settings/ }).click()
  await page.getByRole('button', { name: 'Nudge settings', exact: true }).click()
  expect(
    await page.evaluate(
      () => (window as unknown as { noticeTest: { windows: number; settings: number } }).noticeTest
    )
  ).toMatchObject({ windows: 1, settings: 1 })
})

test('a settings launch failure keeps the manual instructions available', async ({ page }) => {
  await bootNotice(page, false)
  await page.getByRole('button', { name: /Windows notification settings/ }).click()
  await expect(page.getByRole('status')).toHaveText(
    'Open Windows Settings → System → Notifications manually.'
  )
  await page.getByRole('button', { name: 'Got it', exact: true }).click()
  expect(await dismissals(page)).toBe(1)
})
