// deflateSync: PNG needs zlib-wrapped data; Bun.deflateSync writes raw deflate.
import { deflateSync } from "node:zlib"

/** A solid-colour RGBA PNG, for image fixtures. */
export function makePng(width: number, height: number, rgba: [number, number, number, number] = [200, 80, 40, 255]): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1) // first byte of each row: filter type 0
    for (let x = 0; x < width; x++) raw.set(rgba, row + 1 + x * 4)
  }
  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array(4 + data.length)
    body.set(new TextEncoder().encode(type))
    body.set(data, 4)
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set(body, 4)
    view.setUint32(8 + data.length, Bun.hash.crc32(body))
    return out
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, width)
  v.setUint32(4, height)
  ihdr.set([8, 6, 0, 0, 0], 8) // 8-bit RGBA
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) (out.set(p, o), (o += p.length))
  return out
}
