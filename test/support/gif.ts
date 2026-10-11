/** A minimal GIF writer for tests: 256-colour palette, LZW without compression (a clear code every 254 pixels). */
export interface TestFrame {
  /** Palette indices, row by row (in display order; written interlaced when `interlaced`). */
  pixels: number[]
  left?: number
  top?: number
  width: number
  height: number
  delayCs?: number
  disposal?: number
  transparent?: number
  interlaced?: boolean
}

export function makeGif(width: number, height: number, palette: [number, number, number][], frames: TestFrame[]): Uint8Array {
  const out: number[] = []
  const u16 = (n: number) => out.push(n & 255, n >> 8)
  out.push(...new TextEncoder().encode("GIF89a"))
  u16(width)
  u16(height)
  out.push(0xf7, 0, 0) // global palette of 256 entries
  for (let i = 0; i < 256; i++) out.push(...(palette[i] ?? [0, 0, 0]))
  out.push(0x21, 0xff, 11, ...new TextEncoder().encode("NETSCAPE2.0"), 3, 1, 0, 0, 0) // loop forever
  for (const f of frames) {
    const t = f.transparent ?? -1
    out.push(0x21, 0xf9, 4, ((f.disposal ?? 0) << 2) | (t >= 0 ? 1 : 0))
    u16(f.delayCs ?? 10)
    out.push(t >= 0 ? t : 0, 0)
    out.push(0x2c)
    u16(f.left ?? 0)
    u16(f.top ?? 0)
    u16(f.width)
    u16(f.height)
    out.push(f.interlaced ? 0x40 : 0)
    let rows = Array.from({ length: f.height }, (_, y) => y)
    if (f.interlaced) rows = [0, 4, 2, 1].flatMap((s, i) => rows.filter((y) => y >= s && (y - s) % [8, 8, 4, 2][i]! === 0))
    const indices = rows.flatMap((y) => f.pixels.slice(y * f.width, (y + 1) * f.width))
    // 9-bit codes, packed least significant bit first.
    const codes: number[] = [256]
    indices.forEach((p, i) => {
      if (i > 0 && i % 254 === 0) codes.push(256)
      codes.push(p)
    })
    codes.push(257)
    const bytes: number[] = []
    let acc = 0
    let bits = 0
    for (const c of codes) {
      acc |= c << bits
      bits += 9
      while (bits >= 8) {
        bytes.push(acc & 255)
        acc >>= 8
        bits -= 8
      }
    }
    if (bits) bytes.push(acc & 255)
    out.push(8)
    for (let i = 0; i < bytes.length; i += 255) {
      const chunk = bytes.slice(i, i + 255)
      out.push(chunk.length, ...chunk)
    }
    out.push(0)
  }
  out.push(0x3b)
  return new Uint8Array(out)
}
