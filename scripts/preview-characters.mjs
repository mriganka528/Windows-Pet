// Render the same canvases used in the app into a self-contained review gallery.
// Run: node scripts/preview-characters.mjs [--screenshot]
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const directory = resolve('test-results/characters')
await mkdir(directory, { recursive: true })
const result = await build({
  stdin: {
    contents: `
      import { createRoot } from 'react-dom/client'
      import { useEffect, useState } from 'react'
      import { SpriteCanvas } from './src/renderer/src/companion/SpriteCanvas'
      import { SPECIES_ORDER, speciesFor } from './src/renderer/src/companion/species'
      import { speciesWithCoat } from './src/renderer/src/companion/coats'
      import { THEME_ORDER, THEME_LABELS } from './src/shared/settings'
      function Gallery() {
        const [distance, setDistance] = useState(0)
        const [coat, setCoat] = useState('natural')
        useEffect(() => {
          let raf; let previous = performance.now()
          function step(now) { setDistance(d => d + (now - previous) * 0.065); previous = now; raf = requestAnimationFrame(step) }
          raf = requestAnimationFrame(step)
          return () => cancelAnimationFrame(raf)
        }, [])
        return <><h1>Nudge <span>Storybook companions</span></h1><p>Soft fur · Rounded silhouettes · Glossy eyes · Expressive poses</p>
          <label>Coat <select value={coat} onChange={event => setCoat(event.target.value)}>{THEME_ORDER.map(id => <option key={id} value={id}>{THEME_LABELS[id]}</option>)}</select></label>
          <main>{SPECIES_ORDER.map(id => {
            const species = speciesWithCoat(speciesFor(id), coat)
            return <article key={id}><h2>{species.label}</h2><div className="poses">{['Walk', 'Run', 'Sit', 'Dance', 'Camera', 'Sleep'].map(pose =>
              <section key={pose}><SpriteCanvas size={82} facing="right" expression="happy" species={species} palette={species.palette}
                dragging={false} idle={pose === 'Sit'} moving={pose === 'Walk' || pose === 'Run'} sleeping={pose === 'Sleep'} frontFacing={pose === 'Sit'} dancing={pose === 'Dance'} posing={pose === 'Camera'}
                distanceTravelled={distance * (pose === 'Run' ? 4.5 : 1)} /><small>{pose}</small></section>
            )}</div></article>
          })}</main></>
      }
      createRoot(document.getElementById('root')).render(<Gallery />)
    `,
    resolveDir: process.cwd(),
    loader: 'tsx'
  },
  bundle: true,
  write: false,
  minify: true,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }
})
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Nudge — animal studies</title><style>
  *{box-sizing:border-box}body{margin:0;padding:32px;background:#f2eee6;color:#3d463c;font:14px system-ui}
  h1{font-size:30px;margin:0 0 8px}h1 span{font-size:17px;font-weight:400;color:#78816e;margin-left:15px}
  p{margin:0 0 24px;color:#78816e}main{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
  article{padding:12px;background:#fffdf8;border:1px solid #e5dfd3;border-radius:16px}h2{font-size:14px;margin:0 0 8px;font-weight:600}select{margin:0 0 20px 8px;padding:6px 12px;border-radius:6px;border:1px solid #c5c9bc;background:#fffdf8;color:#3d463c}
  .poses{display:flex;justify-content:space-around}section{text-align:center}small{font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:#929584}
  @media(prefers-color-scheme:dark){body{background:#242b2b;color:#e5e4d8}article{background:#343d3d;border-color:#485351}}
  </style></head><body><div id="root"></div><script>${result.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`
const file = resolve(directory, 'index.html')
await writeFile(file, html)
console.log(`Gallery: ${file}`)
if (process.argv.includes('--screenshot')) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({
      viewport: { width: 1640, height: 1150 },
      deviceScaleFactor: 2
    })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(pathToFileURL(file).href)
    await page.locator('canvas').nth(89).waitFor()
    await page.waitForTimeout(1000)
    if (process.argv.includes('--check-bounds')) {
      const clipped = new Set()
      for (let sample = 0; sample < 8; sample++) {
        await page.waitForTimeout(160)
        const edges = await page.locator('canvas').evaluateAll((canvases) =>
          canvases.flatMap((canvas) => {
            const { width: w, height: h } = canvas
            const pixels = canvas.getContext('2d').getImageData(0, 0, w, h).data
            let count = 0
            for (let x = 0; x < w; x++) {
              if (pixels[x * 4 + 3] > 24) count++
              if (pixels[((h - 1) * w + x) * 4 + 3] > 24) count++
            }
            for (let y = 0; y < h; y++) {
              if (pixels[y * w * 4 + 3] > 24) count++
              if (pixels[(y * w + w - 1) * 4 + 3] > 24) count++
            }
            return count > 1
              ? [
                  canvas.closest('article').querySelector('h2').textContent +
                    ' / ' +
                    canvas.closest('section').querySelector('small').textContent
                ]
              : []
          })
        )
        for (const edge of edges) clipped.add(edge)
      }
      if (clipped.size) throw new Error('Clipped character art: ' + [...clipped].join(', '))
      console.log('Bounds check passed: 90 character/pose combinations across 8 animation samples.')
    }
    await page.screenshot({ path: resolve(directory, 'roster.png'), fullPage: true })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.screenshot({ path: resolve(directory, 'roster-dark.png'), fullPage: true })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.locator('select').selectOption('natural-warm')
    await page.waitForTimeout(150)
    await page.screenshot({ path: resolve(directory, 'coat-variants.png'), fullPage: true })
    if (errors.length) throw new Error(errors.join('\n'))
    console.log(`Screenshots: ${directory}`)
  } finally {
    await browser.close()
  }
}
