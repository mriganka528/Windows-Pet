import { build } from 'esbuild'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const site = dirname(dirname(fileURLToPath(import.meta.url)))
const workspace = dirname(site)
const output = join(site, 'public', 'images')
const cache = join(site, '.cache')
await mkdir(output, { recursive: true })
await mkdir(cache, { recursive: true })

const bundle = await build({
  stdin: {
    contents: `
      import { createRoot } from 'react-dom/client'
      import SettingsApp from './src/renderer/src/settings/SettingsApp'
      import { DEFAULT_SETTINGS, mergeSettings } from './src/shared/settings'
      let settings = structuredClone(DEFAULT_SETTINGS)
      const listeners = new Set()
      window.nudge = {
        getSettings: async () => settings,
        setSettings: async patch => { settings = mergeSettings(settings, patch); listeners.forEach(fn => fn(settings)); return settings },
        resetSettings: async () => { settings = structuredClone(DEFAULT_SETTINGS); listeners.forEach(fn => fn(settings)); return settings },
        onSettingsChanged: fn => { listeners.add(fn); return () => listeners.delete(fn) }
      }
      createRoot(document.getElementById('root')).render(<SettingsApp />)
    `,
    resolveDir: workspace,
    loader: 'tsx'
  },
  bundle: true,
  write: false,
  minify: true,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }
})
const css = await readFile(join(workspace, 'src/renderer/src/settings/settings.css'), 'utf8')
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Nudge settings screenshot</title><style>${css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`
const capture = join(cache, 'settings-capture.html')
await writeFile(capture, html)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 480, height: 840 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce'
  })
  await page.goto(pathToFileURL(capture).href)
  await page.locator('.character-grid button').last().waitFor()
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(output, 'settings.png') })
  await page.screenshot({ path: join(output, 'settings-full.png'), fullPage: true })
  await copyFile(
    join(workspace, 'art-preview/storybook-roster.png'),
    join(output, 'character-roster.png')
  )
  await copyFile(
    join(workspace, 'art-preview/storybook-expressions.png'),
    join(output, 'expressions.png')
  )
  console.log('Captured the actual Nudge settings renderer and copied the character galleries.')
} finally {
  await browser.close()
}
