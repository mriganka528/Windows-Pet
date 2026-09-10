let tile: HTMLCanvasElement | undefined

/** A shared, fixed fiber tile adds a quiet plush texture without per-frame noise. */
export function furPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (!tile) {
    tile = document.createElement('canvas')
    tile.width = tile.height = 512
    const brush = tile.getContext('2d')
    if (!brush) return null
    let seed = 73129
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    brush.lineCap = 'round'
    for (let i = 0; i < 6200; i++) {
      const x = random() * 512
      const y = random() * 512
      const length = 3 + random() * 7
      const slant = (random() - 0.5) * 4
      brush.strokeStyle = i % 3 === 0 ? 'rgba(67,44,28,0.28)' : 'rgba(255,250,233,0.46)'
      brush.lineWidth = 0.7 + random() * 0.8
      brush.beginPath()
      brush.moveTo(x, y)
      brush.quadraticCurveTo(x + slant - 1, y + length / 2, x + slant, y + length)
      brush.stroke()
    }
  }
  const pattern = ctx.createPattern(tile, 'repeat')
  pattern?.setTransform(new DOMMatrix().scale(0.25))
  return pattern
}
