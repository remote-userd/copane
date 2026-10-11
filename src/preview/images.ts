import { dirname, resolve } from "node:path"

/** A local image's path, or null for remote URLs (never fetched) and data URIs. */
export function localImagePath(href: string, mdPath: string): string | null {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return null
  const clean = decodeURI(href.split(/[?#]/)[0]!)
  return resolve(dirname(mdPath), clean)
}

/**
 * Cells for an image `w`×`h` pixels within `cols`×`rows`: shrunk to fit, never enlarged past its
 * own size (taking a cell as 8×16 pixels), keeping the aspect ratio (cells are twice as tall as wide).
 */
export function imageCells(w: number, h: number, cols: number, rows: number): { width: number; height: number } {
  let width = Math.max(1, Math.min(cols, Math.ceil(w / 8)))
  let height = Math.max(1, Math.round((width * h) / w / 2))
  if (height > rows) {
    height = Math.max(1, rows)
    width = Math.max(1, Math.min(width, Math.round((height * 2 * w) / h)))
  }
  return { width, height }
}
