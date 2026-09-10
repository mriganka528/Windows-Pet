// Optional icon regeneration only; normal installer builds use the committed ICO.
// Uses an installed Chrome for SVG rasterization, then writes a Windows DIB icon.
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const svg = await readFile(new URL('../build/icon.svg', import.meta.url), 'utf8')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage()
  const sizes = [16, 32, 48, 64, 128, 256]
  const images = []
  for (const size of sizes) {
    const pixels = await page.evaluate(
      async ({ svg, size }) => {
        const image = new globalThis.Image()
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
        await image.decode()
        const canvas = globalThis.document.createElement('canvas')
        canvas.width = canvas.height = size
        const ctx = canvas.getContext('2d')
        ctx.drawImage(image, 0, 0, size, size)
        return Array.from(ctx.getImageData(0, 0, size, size).data)
      },
      { svg, size }
    )
    const stride = Math.ceil(size / 32) * 4
    const image = Buffer.alloc(40 + size * size * 4 + stride * size)
    image.writeUInt32LE(40, 0)
    image.writeInt32LE(size, 4)
    image.writeInt32LE(size * 2, 8)
    image.writeUInt16LE(1, 12)
    image.writeUInt16LE(32, 14)
    image.writeUInt32LE(size * size * 4, 20)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const source = ((size - y - 1) * size + x) * 4
        const target = 40 + (y * size + x) * 4
        image[target] = pixels[source + 2]
        image[target + 1] = pixels[source + 1]
        image[target + 2] = pixels[source]
        image[target + 3] = pixels[source + 3]
        if (!pixels[source + 3])
          image[40 + size * size * 4 + y * stride + (x >> 3)] |= 0x80 >> (x & 7)
      }
    images.push(image)
  }
  const header = Buffer.alloc(6 + sizes.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  sizes.forEach((size, i) => {
    const start = 6 + i * 16
    header[start] = header[start + 1] = size === 256 ? 0 : size
    header.writeUInt16LE(1, start + 4)
    header.writeUInt16LE(32, start + 6)
    header.writeUInt32LE(images[i].length, start + 8)
    header.writeUInt32LE(offset, start + 12)
    offset += images[i].length
  })
  await writeFile(new URL('../build/icon.ico', import.meta.url), Buffer.concat([header, ...images]))
  console.log('Created build/icon.ico (16, 32, 48, 64, 128 and 256 px).')
} finally {
  await browser.close()
}
