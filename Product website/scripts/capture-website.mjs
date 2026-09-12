/* global document */
// document is used only inside browser evaluation callbacks.
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const site = dirname(dirname(fileURLToPath(import.meta.url)))
const cache = join(site, '.cache')
await mkdir(cache, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce'
  })
  await page.goto('http://127.0.0.1:4176', { waitUntil: 'networkidle' })
  await page.locator('.desktop canvas').waitFor()
  await page.waitForTimeout(200)
  await page
    .locator('.desktop')
    .screenshot({ path: join(site, 'public/images/desktop-preview.png') })
  await page.setViewportSize({ width: 1200, height: 630 })
  await page.screenshot({
    path: join(site, 'public/images/social-preview.png'),
    clip: { x: 0, y: 0, width: 1200, height: 630 }
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    for (const img of document.images) img.loading = 'eager'
    await Promise.all([...document.images].map((img) => img.decode()))
  })
  await page.screenshot({ path: join(cache, 'desktop-full.png'), fullPage: true })
  await page.screenshot({ path: join(cache, 'desktop-hero.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    for (const img of document.images) img.loading = 'eager'
    await Promise.all([...document.images].map((img) => img.decode()))
  })
  await page.screenshot({ path: join(cache, 'mobile-full.png'), fullPage: true })
  await page.screenshot({ path: join(cache, 'mobile-hero.png') })
  console.log(`Website screenshots saved to ${cache}`)
} finally {
  await browser.close()
}
