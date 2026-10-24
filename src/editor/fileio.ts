/** Control characters the native edit buffer rejects (everything but \t \n \r). */
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x80-\x9F]/g

export type Eol = "\n" | "\r\n"

export interface LoadedFile {
  text: string
  eol: Eol
  /** True when control characters were stripped; saving will not restore them. */
  sanitized: boolean
  /** The file started with a UTF-8 byte-order mark (kept on save). */
  bom: boolean
  mtimeMs: number
  hash: string
}

export class BinaryFileError extends Error {
  constructor(path: string, why = "looks like a binary file") {
    super(`${path} ${why}`)
    this.name = "BinaryFileError"
  }
}

/** Saving would drop characters the editor couldn't hold (form feeds, escape codes…). */
export class ControlCharsError extends Error {
  constructor(readonly relPath: string) {
    super(`${relPath} has control characters the editor can't keep; saving removes them`)
    this.name = "ControlCharsError"
  }
}

const BOM = [0xef, 0xbb, 0xbf]
const hasBom = (bytes: Uint8Array) => bytes[0] === BOM[0] && bytes[1] === BOM[1] && bytes[2] === BOM[2]

/**
 * UTF-8 text from bytes, or null when they aren't valid UTF-8 (Latin-1, UTF-16…): decoding those
 * would replace characters, and saving would write the replacements back. `keepBom` leaves a
 * byte-order mark in the text (for rewriting a file as it was).
 */
export function decodeUtf8(bytes: Uint8Array, keepBom = false): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: keepBom }).decode(bytes)
  } catch {
    return null
  }
}

/** Saving would overwrite a change on disk that the buffer doesn't have (the AI's, say). */
export class DiskChangedError extends Error {
  constructor(readonly relPath: string) {
    super(`${relPath} changed on disk since it was opened`)
    this.name = "DiskChangedError"
  }
}

export function hashText(text: string): string {
  return Bun.hash(text).toString(16)
}

export function detectEol(raw: string): Eol {
  const crlf = raw.indexOf("\r\n")
  if (crlf === -1) return "\n"
  const lf = raw.indexOf("\n")
  return lf === crlf + 1 ? "\r\n" : "\n"
}

/** Normalize raw file contents into what the edit buffer can hold. */
export function decodeForBuffer(raw: string): { text: string; eol: Eol; sanitized: boolean } {
  const eol = detectEol(raw)
  let text = eol === "\r\n" ? raw.replace(/\r\n/g, "\n") : raw
  const stripped = text.replace(CONTROL_CHARS, "")
  return { text: stripped, eol, sanitized: stripped.length !== text.length }
}

export function encodeForDisk(text: string, eol: Eol): string {
  return eol === "\r\n" ? text.replace(/\r?\n/g, "\r\n") : text
}

export async function loadFile(path: string): Promise<LoadedFile> {
  const file = Bun.file(path)
  const bytes = await file.bytes() // throws ENOENT for a new file, as callers expect
  if (bytes.includes(0)) throw new BinaryFileError(path)
  const raw = decodeUtf8(bytes)
  if (raw === null) throw new BinaryFileError(path, "isn't UTF-8 text (copane only edits UTF-8, so it won't risk changing it)")
  const { text, eol, sanitized } = decodeForBuffer(raw)
  const info = await file.stat()
  return { text, eol, sanitized, bom: hasBom(bytes), mtimeMs: info.mtimeMs, hash: hashText(text) }
}

export async function saveFile(path: string, text: string, eol: Eol, bom = false): Promise<{ mtimeMs: number; hash: string }> {
  await Bun.write(path, (bom ? "\ufeff" : "") + encodeForDisk(text, eol))
  const info = await Bun.file(path).stat()
  return { mtimeMs: info.mtimeMs, hash: hashText(text) }
}
