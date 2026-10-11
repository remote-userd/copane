/** Minimal TrueType reader for tests: family names and the set of mapped code points. */

function tables(buf: DataView): Map<string, { offset: number; length: number }> {
  const n = buf.getUint16(4)
  const out = new Map<string, { offset: number; length: number }>()
  for (let i = 0; i < n; i++) {
    const rec = 12 + i * 16
    const tag = String.fromCharCode(buf.getUint8(rec), buf.getUint8(rec + 1), buf.getUint8(rec + 2), buf.getUint8(rec + 3))
    out.set(tag, { offset: buf.getUint32(rec + 8), length: buf.getUint32(rec + 12) })
  }
  return out
}

/** Name-table strings (Windows/Unicode records) by name id. */
export function fontNames(bytes: Uint8Array): Map<number, string> {
  const buf = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const name = tables(buf).get("name")!
  const count = buf.getUint16(name.offset + 2)
  const strings = name.offset + buf.getUint16(name.offset + 4)
  const out = new Map<number, string>()
  for (let i = 0; i < count; i++) {
    const r = name.offset + 6 + i * 12
    const platform = buf.getUint16(r)
    const nameId = buf.getUint16(r + 6)
    const len = buf.getUint16(r + 8)
    const off = buf.getUint16(r + 10)
    if (platform !== 3 || out.has(nameId)) continue
    let s = ""
    for (let j = 0; j < len; j += 2) s += String.fromCharCode(buf.getUint16(strings + off + j))
    out.set(nameId, s)
  }
  return out
}

/** Whether each code point has a glyph, via cmap format 4 or 12. */
export function hasGlyphs(bytes: Uint8Array): (cp: number) => boolean {
  const buf = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const cmap = tables(buf).get("cmap")!
  const n = buf.getUint16(cmap.offset + 2)
  const ranges: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const sub = cmap.offset + buf.getUint32(cmap.offset + 4 + i * 8 + 4)
    const format = buf.getUint16(sub)
    if (format === 12) {
      const groups = buf.getUint32(sub + 12)
      for (let g = 0; g < groups; g++) ranges.push([buf.getUint32(sub + 16 + g * 12), buf.getUint32(sub + 20 + g * 12)])
      break
    }
    if (format === 4) {
      const segs = buf.getUint16(sub + 6) / 2
      for (let s = 0; s < segs; s++) {
        const end = buf.getUint16(sub + 14 + s * 2)
        const start = buf.getUint16(sub + 16 + segs * 2 + s * 2)
        if (start !== 0xffff) ranges.push([start, end])
      }
    }
  }
  return (cp) => ranges.some(([a, b]) => cp >= a && cp <= b)
}
