/* global document */
// document is used only inside browser evaluation callbacks.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'
import { chromium } from 'playwright'

const site = dirname(dirname(fileURLToPath(import.meta.url)))
const release = JSON.parse(await readFile(join(site, 'src/release.json'), 'utf8'))
const cache = join(site, '.cache')
await mkdir(cache, { recursive: true })
const server = await preview({
  root: site,
  configFile: join(site, 'vite.config.mjs'),
  preview: { host: '127.0.0.1', port: 4177, strictPort: true }
})
const base = 'http://127.0.0.1:4177'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const checks = []
const errors = []
const record = (name) => {
  checks.push(name)
  console.log(`PASS ${name}`)
}
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    acceptDownloads: true
  })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => {
    if (response.status() >= 400 && response.url().startsWith(base))
      errors.push(`${response.status()} ${response.url()}`)
  })
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.locator('.desktop canvas').waitFor()
  assert.ok(
    await page.locator('.desktop canvas').evaluate((canvas) => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      return pixels.some((value, index) => index % 4 === 3 && value > 0)
    }),
    'Actual pet artwork renders into the preview canvas'
  )
  record('Actual app artwork renders in the desktop preview')

  await page.getByRole('button', { name: 'Pet me', exact: true }).click()
  await page.getByText('You just made their day.', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'Let’s dance', exact: true }).click()
  assert.equal(
    await page
      .getByRole('button', { name: 'Let’s dance', exact: true })
      .getAttribute('aria-pressed'),
    'true'
  )
  await page.getByRole('button', { name: 'Nap time', exact: true }).click()
  await page.getByRole('button', { name: 'Wake up', exact: true }).click()
  await page.getByRole('button', { name: 'Nap time', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Use nighttime preview' }).click()
  assert.equal(await page.locator('.desktop.is-night').count(), 1)
  await page.getByRole('button', { name: 'Use daytime preview' }).click()
  const beforeDrag = await page.locator('.desktop-pet-position').getAttribute('style')
  const pet = page.locator('.desktop-pet')
  const bounds = await pet.boundingBox()
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2 + 65, bounds.y + bounds.height / 2 - 10, {
    steps: 8
  })
  await page.mouse.up()
  assert.notEqual(await page.locator('.desktop-pet-position').getAttribute('style'), beforeDrag)
  await page.getByRole('button', { name: 'Preview a notification reaction' }).click()
  await page.getByText('A little reminder', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Dismiss preview notification' }).click()
  assert.equal(await page.locator('.demo-notification').count(), 0)
  record('Petting, dancing, sleep/wake, dragging, scenery, and notification controls work')

  await page.getByRole('button', { name: 'Meet all 15 companions' }).click()
  assert.equal(await page.locator('.friend-card').count(), 15)
  await page.locator('.friend-card').filter({ hasText: /^Fox$/ }).click()
  assert.match(await page.locator('.customizer-pet h3').innerText(), /Fox/)
  await page.getByRole('button', { name: 'Coat: Mint', exact: true }).click()
  assert.equal(
    await page
      .getByRole('button', { name: 'Coat: Mint', exact: true })
      .getAttribute('aria-pressed'),
    'true'
  )
  await page.getByRole('button', { name: 'Grumpy', exact: true }).click()
  assert.match(await page.locator('.customizer-pet h3').innerText(), /Grumpy/)
  await page.getByRole('button', { name: 'Show the first five' }).click()
  record('All 15 animals, coat selection, and mood selection work')

  for (const tab of await page.getByRole('tab').all()) {
    await tab.click()
    assert.equal(await tab.getAttribute('aria-selected'), 'true')
    assert.equal(await page.locator('.guide-steps li').count(), 3)
  }
  await page.getByRole('tab', { name: 'Getting started' }).click()
  await page.keyboard.press('ArrowDown')
  assert.equal(
    await page.getByRole('tab', { name: 'Pet, move & sleep' }).getAttribute('aria-selected'),
    'true'
  )
  await page.getByRole('tab', { name: 'Getting started' }).click()
  record('All five guides and keyboard tab navigation work')

  await page.locator('.download-dnd-note').scrollIntoViewIfNeeded()
  assert.match(await page.locator('.download-dnd-note').innerText(), /Do not disturb/)
  assert.match(await page.locator('.download-dnd-note').innerText(), /Close them for me/)
  await page.getByRole('link', { name: 'See Windows notification setup' }).click()
  assert.equal(
    await page.getByRole('tab', { name: 'Music & notifications' }).getAttribute('aria-selected'),
    'true'
  )
  assert.match(await page.getByRole('tabpanel').innerText(), /Focus assist → Off/)
  await page.getByRole('tab', { name: 'Getting started' }).click()
  record('DND warning is next to the download and links to Windows notification setup')

  await page.locator('.faq-list summary').first().click()
  assert.equal(await page.locator('.faq-list details[open]').count(), 1)
  await page.locator('.faq-list summary').first().click()
  const privacy = page.getByRole('button', { name: 'A note on privacy' })
  await privacy.click()
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(await privacy.evaluate((element) => document.activeElement === element), true)
  await page.getByRole('button', { name: 'Verify download', exact: true }).click()
  assert.equal(await page.locator('#checksum').inputValue(), release.sha256)
  await page.getByRole('button', { name: 'Copy checksum', exact: true }).click()
  assert.match(await page.locator('.copy-status').innerText(), /Checksum copied|Select and copy/)
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('button', { name: 'What’s included', exact: true }).click()
  assert.match(
    await page.locator('#modal-title').innerText(),
    new RegExp(release.version.replaceAll('.', '\\.'))
  )
  await page.keyboard.press('Escape')
  record('FAQ, privacy, release notes, checksum, Escape, and focus restoration work')

  await page.evaluate(async () => {
    for (const image of document.images) image.loading = 'eager'
    await Promise.all([...document.images].map((image) => image.decode()))
  })
  assert.equal(
    await page.evaluate(() => [...document.images].every((image) => image.naturalWidth > 0)),
    true
  )
  await page.getByRole('button', { name: 'Expand the actual Nudge settings screenshot' }).click()
  assert.match(await page.locator('.expanded-image').getAttribute('src'), /settings-full\.png$/)
  await page.keyboard.press('Escape')
  for (const gallery of await page.locator('.gallery-card').all()) {
    await gallery.click()
    await page.locator('.expanded-image').evaluate((image) => image.decode())
    await page.keyboard.press('Escape')
  }
  record('All screenshots load and every gallery image expands')

  if (release.downloadMode === 'local') {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.hero-actions').getByRole('link', { name: 'Download for Windows' }).click()
    ])
    assert.equal(download.suggestedFilename(), release.fileName)
    assert.equal(await download.failure(), null)
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(await download.path())) hash.update(chunk)
    assert.equal(hash.digest('hex').toUpperCase(), release.sha256)
    record(`Browser download completes and matches the actual ${release.size} installer SHA-256`)
  } else {
    // The public asset must be uploaded separately; this offline check cannot
    // certify that GitHub has published it or verify its remote contents.
    record('External installer URL is configured (remote asset availability not checked)')
  }
  const checksum = await (await fetch(`${base}/downloads/SHA256SUMS.txt`)).text()
  assert.match(checksum, new RegExp(release.sha256))
  for (const link of await page.locator('a[download$=".exe"]').all()) {
    assert.equal(
      await link.evaluate((element) => element.href),
      new URL(release.downloadUrl, base + '/').href
    )
  }

  const brokenAnchors = await page.evaluate(() =>
    [...document.querySelectorAll('a[href^="#"]')]
      .filter((link) => !document.getElementById(link.hash.slice(1)))
      .map((link) => link.hash)
  )
  assert.deepEqual(brokenAnchors, [])
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(100)
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    assert.ok(scrollWidth <= width + 1, `No horizontal overflow at ${width}px (got ${scrollWidth})`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.locator('.main-nav').getByRole('link', { name: 'The field guide' }).click()
  assert.equal(
    await page.getByRole('button', { name: 'Open navigation' }).getAttribute('aria-expanded'),
    'false'
  )
  record('Navigation links and mobile menu work; no overflow from 320px to 1920px')

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    for (const image of document.images) image.loading = 'eager'
    await Promise.all([...document.images].map((image) => image.decode()))
  })
  await page.screenshot({ path: join(cache, 'verified-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(cache, 'verified-mobile.png'), fullPage: true })
  assert.deepEqual(errors, [])
  record('No browser JavaScript errors or missing resources')

  const noJS = await browser.newContext({ javaScriptEnabled: false })
  const fallback = await noJS.newPage()
  await fallback.goto(base)
  await fallback.getByRole('heading', { name: 'Meet Nudge.' }).waitFor()
  assert.equal(
    await fallback.getByRole('link').evaluate((element) => element.href),
    new URL(release.downloadUrl, base + '/').href
  )
  await noJS.close()
  record('Download fallback works with JavaScript disabled')
  await writeFile(
    join(cache, 'verification.json'),
    JSON.stringify(
      { passed: checks.length, checks, errors, version: release.version, sha256: release.sha256 },
      null,
      2
    ) + '\n'
  )
  console.log(`\n${checks.length} checks passed. Screenshots and report: ${cache}`)
} finally {
  await browser.close()
  await new Promise((resolve) => server.httpServer.close(resolve))
}
