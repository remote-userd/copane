import { dirname, resolve } from "node:path"

/** A local image's path, or null for remote URLs (never fetched) and data URIs. */
export function localImagePath(href: string, mdPath: string): string | null {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return null
  const raw = href.split(/[?#]/)[0]!
  return resolve(dirname(mdPath), safeDecode(raw))
}

/** `my%20pic.png` → `my pic.png`; a stray `%` (`50%.png`) stays as written instead of throwing. */
function safeDecode(path: string): string {
  try {
    return decodeURI(path)
  } catch {
    return path
  }
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
