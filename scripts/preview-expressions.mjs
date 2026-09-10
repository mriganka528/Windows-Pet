// Generate a self-contained face comparison using the app's actual renderer.
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const directory = resolve('test-results/expressions')
await mkdir(directory, { recursive: true })
const result = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `
      import { createRoot } from 'react-dom/client'
      import { useState } from 'react'
      import { SpriteCanvas } from './src/renderer/src/companion/SpriteCanvas'
      import { frontHeadY } from './src/renderer/src/companion/frontModel'
      import { ANATOMY } from './src/renderer/src/companion/gait'
      import { SPECIES_ORDER, speciesFor } from './src/renderer/src/companion/species'
      import { MOOD_ORDER, MOOD_LABELS } from './src/shared/settings'
      const descriptions = { happy: 'Soft eyes · warm smile', excited: 'Sparkling eyes · open grin', curious: 'Uneven brows · tilted head', alert: 'Wide eyes · watchful face', chill: 'Relaxed lids · slight smile', sleepy: 'Closed eyes · drowsy mouth', grumpy: 'Low brows · a proper pout', angry: 'Hard glare · tense mouth' }
      function Gallery() {
        const [id, setId] = useState('cat')
        const species = speciesFor(id)
        return <><header><div><h1>Nudge <span>Expressions</span></h1><p>Seven distinct moods, plus the stronger notification reaction.</p></div><select aria-label="Animal" value={id} onChange={e => setId(e.target.value)}>{SPECIES_ORDER.map(key => <option key={key} value={key}>{speciesFor(key).label}</option>)}</select></header>
          <main>{[...MOOD_ORDER, 'angry'].map(mood => <article key={mood}>
            <h2>{MOOD_LABELS[mood] ?? 'Notification anger'}</h2>
            <p>{descriptions[mood]}</p>
            {[true, false].map(front => <section key={String(front)}><div className="face-window"><div style={{ transform: 'translate(' + (80 - (front ? 50 : ANATOMY[id].headX) * 2) + 'px,' + (80 - (front ? frontHeadY(species) : ANATOMY[id].headY) * 2) + 'px)' }}>
              <SpriteCanvas size={200} facing="right" expression={mood} species={species} palette={species.palette} frontFacing={front} dragging={false} idle={false} still />
            </div></div><small>{front ? 'Front' : 'Profile'}</small></section>)}
          </article>)}</main></>
      }
      createRoot(document.getElementById('root')).render(<Gallery />)
    `
  },
  bundle: true,
  write: false,
  minify: true,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }
})
const file = resolve(directory, 'index.html')
await writeFile(
  file,
  `<!doctype html><html><head><meta charset="utf-8"><title>Nudge — expressions</title><style>
  *{box-sizing:border-box}body{margin:0;padding:32px;background:#f2eee6;color:#3d463c;font:14px system-ui}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px}h1{margin:0 0 6px;font-size:30px}h1 span{font-size:18px;font-weight:400;margin-left:14px;color:#78816e}p{margin:0;color:#78816e}select{padding:8px 16px;border:1px solid #c5c9bc;border-radius:8px;background:#fffdf8;color:#3d463c}main{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}article{padding:16px 12px;text-align:center;border:1px solid #e3ddd0;border-radius:16px;background:#fffdf8}h2{font-size:16px;margin:0 0 5px}article p{font-size:11px;margin-bottom:14px}.face-window{position:relative;overflow:hidden;width:160px;height:150px;margin:auto}.face-window>div{position:absolute;top:0;left:0}section+section{margin-top:12px}small{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#929584}
  </style></head><body><div id="root"></div><script>${result.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`
)
console.log(`Expression gallery: ${file}`)
if (process.argv.includes('--screenshot')) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({
      viewport: { width: 1100, height: 850 },
      deviceScaleFactor: 2
    })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(pathToFileURL(file).href)
    await page.locator('canvas').nth(15).waitFor()
    for (const species of ['cat', 'panda', 'penguin']) {
      await page.locator('select').selectOption(species)
      await page.waitForTimeout(100)
      await page.screenshot({ path: resolve(directory, species + '.png'), fullPage: true })
    }
    if (errors.length) throw new Error(errors.join('\n'))
  } finally {
    await browser.close()
  }
}
