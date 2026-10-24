/**
 * Animated GIF playback. OpenTUI decodes only a GIF's first frame, so this reads the frames
 * itself: the structure is parsed once, and each frame is decompressed (LZW) and composited onto
 * a canvas only when it is shown, so a big GIF doesn't hold every frame in memory.
 */

interface Frame {
  left: number
  top: number
  width: number
  height: number
  palette: Uint8Array
  interlaced: boolean
  minCodeSize: number
  data: Uint8Array
  /** How long to show it, in ms. */
  delay: number
  /** What happens to its area before the next frame: 0/1 keep, 2 clear, 3 restore what was under it. */
  disposal: number
  transparent: number
}

export interface Gif {
  width: number
  height: number
  frames: Frame[]
}

/** Parse a GIF's structure (no pixel data is decoded yet). Throws on anything that isn't a GIF. */
export function parseGif(bytes: Uint8Array): Gif {
  const sig = new TextDecoder().decode(bytes.subarray(0, 6))
  if (sig !== "GIF87a" && sig !== "GIF89a") throw new Error("not a GIF")
  const u16 = (i: number) => bytes[i]! | (bytes[i + 1]! << 8)
  const width = u16(6)
  const height = u16(8)
  const flags = bytes[10]!
  let pos = 13
  let globalPalette: Uint8Array = new Uint8Array()
  if (flags & 0x80) {
    const size = 3 * (1 << ((flags & 7) + 1))
    globalPalette = bytes.subarray(pos, pos + size)
    pos += size
  }
  const frames: Frame[] = []
  let control = { delay: 0, disposal: 0, transparent: -1 }
  const subBlocks = (): Uint8Array[] => {
    const parts: Uint8Array[] = []
    while (pos < bytes.length) {
      const n = bytes[pos++]!
      if (n === 0) break
      parts.push(bytes.subarray(pos, pos + n))
      pos += n
    }
    return parts
  }
  while (pos < bytes.length) {
    const kind = bytes[pos++]
    if (kind === 0x3b) break // trailer
    if (kind === 0x21) {
      const label = bytes[pos++]
      const [block] = subBlocks() // reads the whole extension; only the graphic control matters
      if (label === 0xf9 && block && block.length >= 4) {
        // Graphic control, for the next image. Browsers show delays of 0 or 10 ms as 100 ms; so do we.
        const centis = block[1]! | (block[2]! << 8)
        control = {
          delay: centis <= 1 ? 100 : centis * 10,
          disposal: (block[0]! >> 2) & 7,
          transparent: block[0]! & 1 ? block[3]! : -1,
        }
      }
      continue
    }
    if (kind !== 0x2c) break // not an image: corrupt, stop here
    const left = u16(pos)
    const top = u16(pos + 2)
    const w = u16(pos + 4)
    const h = u16(pos + 6)
    const f = bytes[pos + 8]!
    pos += 9
    let palette = globalPalette
    if (f & 0x80) {
      const size = 3 * (1 << ((f & 7) + 1))
      palette = bytes.subarray(pos, pos + size)
      pos += size
    }
    const minCodeSize = bytes[pos++]!
    const parts = subBlocks()
    const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let o = 0
    for (const p of parts) (data.set(p, o), (o += p.length))
    frames.push({ left, top, width: w, height: h, palette, interlaced: !!(f & 0x40), minCodeSize, data, ...control })
    control = { delay: 0, disposal: 0, transparent: -1 }
  }
  if (!frames.length) throw new Error("GIF has no frames")
  return { width, height, frames }
}

/** Decompress a frame's LZW data into palette indices. */
export function lzwDecode(minCodeSize: number, data: Uint8Array, pixels: number): Uint8Array {
  const out = new Uint8Array(pixels)
  const clear = 1 << minCodeSize
  const eoi = clear + 1
  const prefix = new Int16Array(4096)
  const suffix = new Uint8Array(4096)
  const stack = new Uint8Array(4097)
  for (let i = 0; i < clear; i++) suffix[i] = i
  let size = minCodeSize + 1
  let mask = (1 << size) - 1
  let next = eoi + 1
  let old = -1
  let first = 0
  let op = 0
  let pos = 0
  let bits = 0
  let datum = 0
  while (op < pixels) {
    while (bits < size && pos < data.length) {
      datum |= data[pos++]! << bits
      bits += 8
    }
    if (bits < size) break
    let code = datum & mask
    datum >>>= size
    bits -= size
    if (code === clear) {
      size = minCodeSize + 1
      mask = (1 << size) - 1
      next = eoi + 1
      old = -1
      continue
    }
    if (code === eoi || code > next) break
    if (old === -1) {
      out[op++] = suffix[code]!
      old = first = code
      continue
    }
    const current = code
    let sp = 0
    if (code === next) {
      // The code being defined right now: the previous string plus its own first byte.
      stack[sp++] = first
      code = old
    }
    while (code > eoi) {
      stack[sp++] = suffix[code]!
      code = prefix[code]!
    }
    first = suffix[code]!
    stack[sp++] = first
    if (next < 4096) {
      prefix[next] = old
      suffix[next] = first
      next++
      if ((next & mask) === 0 && next < 4096) {
        size++
        mask = (1 << size) - 1
      }
    }
    old = current
    while (sp > 0 && op < pixels) out[op++] = stack[--sp]!
  }
  return out
}

/** Row order of an interlaced frame: every 8th row from 0, then from 4, every 4th from 2, every 2nd from 1. */
function rowOrder(height: number, interlaced: boolean): number[] {
  if (!interlaced) return Array.from({ length: height }, (_, i) => i)
  const rows: number[] = []
  for (const [start, step] of [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2],
  ] as const)
    for (let y = start; y < height; y += step) rows.push(y)
  return rows
}

/** Plays a GIF frame by frame onto one RGBA canvas, looping, as browsers composite it. */
export class GifPlayer {
  readonly canvas: Uint8Array
  index = -1
  private saved: Uint8Array | null = null

  constructor(readonly gif: Gif) {
    this.canvas = new Uint8Array(gif.width * gif.height * 4)
  }

  get frameCount(): number {
    return this.gif.frames.length
  }

  /** Draw the next frame (wrapping to the first) and return how long to show it, in ms. */
  next(): number {
    const { frames, width, height } = this.gif
    const prev = this.index >= 0 ? frames[this.index]! : null
    this.index = (this.index + 1) % frames.length
    if (this.index === 0) {
      this.canvas.fill(0)
      this.saved = null
    } else if (prev?.disposal === 2) {
      this.clear(prev)
    } else if (prev?.disposal === 3 && this.saved) {
      this.canvas.set(this.saved)
    }
    const f = frames[this.index]!
    if (f.disposal === 3) this.saved = this.canvas.slice()
    const indices = lzwDecode(f.minCodeSize, f.data, f.width * f.height)
    const rows = rowOrder(f.height, f.interlaced)
    for (let r = 0; r < f.height; r++) {
      const y = f.top + rows[r]!
      if (y >= height) continue
      for (let x = 0; x < f.width; x++) {
        const cx = f.left + x
        if (cx >= width) break
        const idx = indices[r * f.width + x]!
        if (idx === f.transparent || idx * 3 + 2 >= f.palette.length) continue
        const o = (y * width + cx) * 4
        this.canvas[o] = f.palette[idx * 3]!
        this.canvas[o + 1] = f.palette[idx * 3 + 1]!
        this.canvas[o + 2] = f.palette[idx * 3 + 2]!
        this.canvas[o + 3] = 255
      }
    }
    return f.delay || 100
  }

  private clear(f: Frame): void {
    const { width, height } = this.gif
    for (let y = f.top; y < Math.min(height, f.top + f.height); y++) {
      const start = (y * width + f.left) * 4
      this.canvas.fill(0, start, start + Math.min(f.width, width - f.left) * 4)
    }
  }
}
