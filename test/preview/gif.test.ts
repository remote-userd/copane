import { expect, test } from "bun:test"
import { imageInfo, NativeImage } from "@opentui/core"
import { GifPlayer, lzwDecode, parseGif } from "../../src/preview/gif"
import { makeGif } from "../support/gif"

const RED: [number, number, number] = [255, 0, 0]
const BLUE: [number, number, number] = [0, 0, 255]
const pixel = (p: GifPlayer, x: number, y: number) => [...p.canvas.subarray((y * p.gif.width + x) * 4, (y * p.gif.width + x) * 4 + 4)]

test("frames, delays and disposal are read; the first frame matches OpenTUI's decoder", () => {
  const bytes = makeGif(4, 3, [RED, BLUE], [
    { width: 4, height: 3, pixels: Array(12).fill(0), delayCs: 25 },
    { left: 1, top: 1, width: 2, height: 1, pixels: [1, 1], delayCs: 0, disposal: 2 },
  ])
  expect(imageInfo(bytes).format).toBe("gif")
  const gif = parseGif(bytes)
  expect(gif.frames.map((f) => [f.delay, f.disposal])).toEqual([
    [250, 0],
    [100, 2], // a zero delay plays at 100 ms, as in browsers
  ])
  const p = new GifPlayer(gif)
  expect(p.next()).toBe(250)
  expect([...p.canvas]).toEqual([...NativeImage.decode(bytes).raw("rgba8").data])
})

test("later frames composite: transparency keeps what's under, disposal 2 clears the area", () => {
  const p = new GifPlayer(
    parseGif(
      makeGif(3, 1, [RED, BLUE, [0, 255, 0]], [
        { width: 3, height: 1, pixels: [0, 0, 0] },
        { width: 3, height: 1, pixels: [1, 2, 1], transparent: 2, disposal: 2 },
        { left: 2, width: 1, height: 1, pixels: [2] },
      ]),
    ),
  )
  p.next()
  p.next()
  expect([pixel(p, 0, 0), pixel(p, 1, 0)]).toEqual([
    [0, 0, 255, 255],
    [255, 0, 0, 255], // transparent: the red underneath shows
  ])
  p.next()
  // Frame 2 cleared to transparent before frame 3 drew its one pixel.
  expect([pixel(p, 0, 0), pixel(p, 2, 0)]).toEqual([
    [0, 0, 0, 0],
    [0, 255, 0, 255],
  ])
  p.next() // loops back to the first frame
  expect(p.index).toBe(0)
  expect(pixel(p, 0, 0)).toEqual([255, 0, 0, 255])
})

test("interlaced frames are put back in row order", () => {
  const rows = Array.from({ length: 10 }, (_, y) => y % 2)
  const p = new GifPlayer(parseGif(makeGif(1, 10, [RED, BLUE], [{ width: 1, height: 10, pixels: rows, interlaced: true }])))
  p.next()
  expect(Array.from({ length: 10 }, (_, y): number => (pixel(p, 0, y)[2] === 255 ? 1 : 0))).toEqual(rows)
})

test("lzwDecode handles a code defined by itself (KwKwK) and stops at end of data", () => {
  // Codes (3 bits, min size 2): clear(4), 1, 6 (= "1 1", not yet in the table), end(5).
  const bits = [4, 1, 6, 5].map((c, i) => c << (i * 3)).reduce((a, b) => a | b)
  expect([...lzwDecode(2, new Uint8Array([bits & 255, bits >> 8]), 3)]).toEqual([1, 1, 1])
})

test("non-GIF data is rejected", () => {
  expect(() => parseGif(new Uint8Array([1, 2, 3, 4, 5, 6, 7]))).toThrow("not a GIF")
})
