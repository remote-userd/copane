import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BinaryFileError, decodeForBuffer, detectEol, encodeForDisk, loadFile, saveFile } from "../../src/editor/fileio"

describe("fileio", () => {
  test("detects CRLF and LF", () => {
    expect(detectEol("a\r\nb\r\n")).toBe("\r\n")
    expect(detectEol("a\nb\n")).toBe("\n")
    expect(detectEol("no newline")).toBe("\n")
  })

  test("normalizes CRLF for the buffer and restores it on save", () => {
    const raw = "one\r\ntwo\r\n"
    const { text, eol } = decodeForBuffer(raw)
    expect(text).toBe("one\ntwo\n")
    expect(encodeForDisk(text, eol)).toBe(raw)
  })

  test("strips control characters the native buffer rejects but keeps tabs", () => {
    const { text, sanitized } = decodeForBuffer("a\tb\x1b[31mc\x07\n")
    expect(text).toBe("a\tb[31mc\n")
    expect(sanitized).toBe(true)
  })

  test("round-trips bytes exactly for LF and CRLF files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cedit-"))
    for (const content of ["const a = 1\nconst b = 'é'\n", "x\r\ny\r\n", "no trailing newline"]) {
      const p = join(dir, "f.txt")
      await writeFile(p, content)
      const loaded = await loadFile(p)
      await saveFile(p, loaded.text, loaded.eol)
      expect(await readFile(p, "utf8")).toBe(content)
    }
  })

  test("rejects binary files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cedit-"))
    const p = join(dir, "b.bin")
    await writeFile(p, new Uint8Array([0x89, 0x50, 0x00, 0x01]))
    await expect(loadFile(p)).rejects.toBeInstanceOf(BinaryFileError)
  })
})
