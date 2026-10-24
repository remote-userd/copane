import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  BinaryFileError,
  decodeForBuffer,
  decodeUtf8,
  detectEol,
  encodeForDisk,
  loadFile,
  saveFile,
} from "../../src/editor/fileio"

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

test("files that aren't UTF-8 are refused, not decoded with replacements", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cedit-enc-"))
  const latin1 = join(dir, "l.txt")
  await Bun.write(latin1, new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a])) // "café\n" in Latin-1
  await expect(loadFile(latin1)).rejects.toThrow("isn't UTF-8 text")
  expect(decodeUtf8(new Uint8Array([0xe9]))).toBeNull()
  expect(decodeUtf8(new TextEncoder().encode("café"))).toBe("café")
})

test("a byte-order mark is remembered and written back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cedit-enc-"))
  const path = join(dir, "bom.txt")
  await Bun.write(path, new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("hi\r\n")]))
  const loaded = await loadFile(path)
  expect(loaded.bom).toBe(true)
  expect(loaded.text).toBe("hi\n") // no BOM character in the editor
  await saveFile(path, "hi there\n", loaded.eol, loaded.bom)
  expect([...(await Bun.file(path).bytes()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  expect(new TextDecoder().decode(await Bun.file(path).bytes())).toBe("hi there\r\n")
})

test("project-wide edits skip files that aren't UTF-8 and keep a byte-order mark", async () => {
  const { applyToFiles } = await import("../../src/app/fileEdits")
  const { createWorkspace } = await import("../../src/app/workspace")
  const dir = await mkdtemp(join(tmpdir(), "cedit-enc-"))
  const latin1 = join(dir, "l.txt")
  const bom = join(dir, "b.txt")
  const latinBytes = new Uint8Array([0x6f, 0x6c, 0x64, 0x20, 0xe9, 0x0a]) // "old é\n" in Latin-1
  await Bun.write(latin1, latinBytes)
  await Bun.write(bom, "\ufeffold\n")
  const ws = createWorkspace(dir)
  const n = await applyToFiles(ws, new Map([latin1, bom].map((p) => [p, (t: string) => t.replace("old", "new")])))
  expect(n).toBe(1)
  expect([...(await Bun.file(latin1).bytes())]).toEqual([...latinBytes]) // untouched
  expect([...(await Bun.file(bom).bytes())]).toEqual([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("new\n")])
})
