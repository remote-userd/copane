
/** Control characters the native edit buffer rejects (everything but \t \n \r). */
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x80-\x9F]/g

export type Eol = "\n" | "\r\n"

export interface LoadedFile {
  text: string
  eol: Eol
  /** True when control characters were stripped; saving will not restore them. */
  sanitized: boolean
  mtimeMs: number
  hash: string
}

export class BinaryFileError extends Error {
  constructor(path: string) {
    super(`${path} looks like a binary file`)
    this.name = "BinaryFileError"
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
  const raw = new TextDecoder("utf-8").decode(bytes)
  const { text, eol, sanitized } = decodeForBuffer(raw)
  const info = await file.stat()
  return { text, eol, sanitized, mtimeMs: info.mtimeMs, hash: hashText(text) }
}

export async function saveFile(path: string, text: string, eol: Eol): Promise<{ mtimeMs: number; hash: string }> {
  await Bun.write(path, encodeForDisk(text, eol))
  const info = await Bun.file(path).stat()
  return { mtimeMs: info.mtimeMs, hash: hashText(text) }
}
