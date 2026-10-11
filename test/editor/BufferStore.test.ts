import { beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { TextareaRenderable } from "@opentui/core"
import { BufferStore } from "../../src/editor/BufferStore"
import { DiskChangedError } from "../../src/editor/fileio"

/** Just enough of TextareaRenderable for the store. */
class FakeTextarea {
  plainText = ""
  isDestroyed = false
  logicalCursor = { row: 0, col: 0 }
  history: string[] = []
  highlights: unknown[] = []
  get lineCount() {
    return this.plainText.split("\n").length
  }
  setText(t: string) {
    this.plainText = t
    this.history = []
  }
  replaceText(t: string) {
    this.history.push(this.plainText)
    this.plainText = t
  }
  type(t: string) {
    this.history.push(this.plainText)
    this.plainText = t + this.plainText
  }
  undo() {
    const prev = this.history.pop()
    if (prev !== undefined) this.plainText = prev
  }
  setCursor(row: number, col: number) {
    this.logicalCursor = { row, col }
  }
  removeHighlightsByRef() {
    this.highlights = []
  }
  addHighlight(_line: number, h: unknown) {
    this.highlights.push(h)
  }
}

let dir: string
let store: BufferStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cedit-store-"))
  store = new BufferStore({ root: dir, highlight: async () => [], resolveStyle: () => 1, highlightDelayMs: 0 })
})

async function openWithTextarea(name: string, content: string | null) {
  if (content !== null) await writeFile(join(dir, name), content)
  const buf = await store.open(name)
  const ta = new FakeTextarea()
  store.attach(buf.id, ta as unknown as TextareaRenderable)
  return { buf, ta }
}

describe("BufferStore", () => {
  test("open loads text into the textarea when it mounts", async () => {
    const { buf, ta } = await openWithTextarea("a.ts", "hello\n")
    expect(ta.plainText).toBe("hello\n")
    expect(buf.relPath).toBe("a.ts")
    expect(buf.filetype).toBe("typescript")
    expect(store.active?.id).toBe(buf.id)
  })

  test("reopening a path activates the existing buffer", async () => {
    const { buf } = await openWithTextarea("a.ts", "x")
    await openWithTextarea("b.ts", "y")
    const again = await store.open(join(dir, "a.ts"))
    expect(again.id).toBe(buf.id)
    expect(store.active?.id).toBe(buf.id)
    expect(store.list()).toHaveLength(2)
  })

  test("edits mark dirty; undoing back to disk text clears it", async () => {
    const { buf, ta } = await openWithTextarea("a.ts", "hello\n")
    ta.type("X")
    store.onContentChange(buf.id)
    expect(buf.dirty).toBe(true)
    ta.undo()
    store.onContentChange(buf.id) // the editor reports undo as a content change
    expect(buf.dirty).toBe(false)
  })

  test("undo after save makes the buffer dirty again", async () => {
    const { buf, ta } = await openWithTextarea("a.ts", "hello\n")
    ta.type("X")
    store.onContentChange(buf.id)
    await store.save(buf.id)
    expect(buf.dirty).toBe(false)
    expect(await readFile(join(dir, "a.ts"), "utf8")).toBe("Xhello\n")
    ta.undo()
    store.onContentChange(buf.id)
    expect(buf.dirty).toBe(true)
  })

  test("disk change on a clean buffer reloads undoably", async () => {
    const { buf, ta } = await openWithTextarea("a.ts", "v1\n")
    await writeFile(join(dir, "a.ts"), "v2\n")
    expect(await store.handleDiskChange(join(dir, "a.ts"))).toBe("reloaded")
    expect(ta.plainText).toBe("v2\n")
    expect(buf.dirty).toBe(false)
    ta.undo()
    store.onContentChange(buf.id)
    expect(ta.plainText).toBe("v1\n")
    expect(buf.dirty).toBe(true)
  })

  test("disk change on a dirty buffer flags a conflict and keeps local text", async () => {
    const { buf, ta } = await openWithTextarea("a.ts", "v1\n")
    ta.type("mine ")
    store.onContentChange(buf.id)
    await writeFile(join(dir, "a.ts"), "theirs\n")
    expect(await store.handleDiskChange(join(dir, "a.ts"))).toBe("conflict")
    expect(buf.conflict).toBe(true)
    expect(ta.plainText).toBe("mine v1\n")
    await store.reloadFromDisk(buf.id)
    expect(ta.plainText).toBe("theirs\n")
    expect(buf.conflict).toBe(false)
    expect(buf.dirty).toBe(false)
  })

  test("the echo of our own save is ignored", async () => {
    const { buf, ta } = await openWithTextarea("a.ts", "v1\n")
    ta.type("x")
    store.onContentChange(buf.id)
    await store.save(buf.id)
    expect(await store.handleDiskChange(join(dir, "a.ts"))).toBe("ignored")
    expect(ta.plainText).toBe("xv1\n")
  })

  test("deleted files are flagged and save recreates them", async () => {
    const { buf } = await openWithTextarea("a.ts", "v1\n")
    await rm(join(dir, "a.ts"))
    expect(await store.handleDiskChange(join(dir, "a.ts"))).toBe("deleted")
    expect(buf.deleted).toBe(true)
    await store.save(buf.id)
    expect(buf.deleted).toBe(false)
    expect(await readFile(join(dir, "a.ts"), "utf8")).toBe("v1\n")
  })

  test("opening a missing path creates an empty new-file buffer", async () => {
    const { buf, ta } = await openWithTextarea("new.md", null)
    expect(ta.plainText).toBe("")
    expect(buf.deleted).toBe(true)
    ta.type("# hi\n")
    store.onContentChange(buf.id)
    await store.save(buf.id)
    expect(await readFile(join(dir, "new.md"), "utf8")).toBe("# hi\n")
  })

  test("close moves focus to a neighbour and cycle wraps", async () => {
    const a = (await openWithTextarea("a.ts", "a")).buf
    const b = (await openWithTextarea("b.ts", "b")).buf
    const c = (await openWithTextarea("c.ts", "c")).buf
    store.cycle(1)
    expect(store.active?.id).toBe(a.id)
    store.activate(b.id)
    store.close(b.id)
    expect(store.active?.id).toBe(c.id)
  })
})

describe("renamePath / pathDeleted", () => {
  test("open buffers follow a file or folder rename; deleting closes clean ones", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bs-rename-"))
    await writeFile(join(dir, "a.ts"), "a")
    await Bun.write(join(dir, "pkg/b.ts"), "b")
    await Bun.write(join(dir, "pkg/c.md"), "c")
    const store = new BufferStore({ root: dir, highlightDelayMs: 0 })
    const a = await store.open("a.ts")
    const b = await store.open("pkg/b.ts")
    const c = await store.open("pkg/c.md")
    store.renamePath(join(dir, "a.ts"), join(dir, "a.md"))
    expect(a).toMatchObject({ path: join(dir, "a.md"), relPath: "a.md", name: "a.md", filetype: "markdown" })
    store.renamePath(join(dir, "pkg"), join(dir, "lib"))
    expect(b).toMatchObject({ path: join(dir, "lib/b.ts"), relPath: join("lib", "b.ts") })
    expect(store.byPath(join(dir, "lib/c.md"))).toBe(c)
    c.dirty = true
    store.pathDeleted(join(dir, "lib"))
    expect(store.byPath(join(dir, "lib/b.ts"))).toBeNull()
    expect(c.deleted).toBe(true)
    expect(store.list().map((x) => x.name)).toEqual(["a.md", "c.md"])
    await rm(dir, { recursive: true })
  })
})

describe("conflict merge", () => {
  test("unsaved edits and a disk change on other lines merge into one undoable result", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bs-merge-"))
    const path = join(dir, "a.ts")
    await writeFile(path, "one\ntwo\nthree\nfour\nfive\n")
    const store = new BufferStore({ root: dir, highlightDelayMs: 0 })
    const buf = await store.open("a.ts")
    const ta = new FakeTextarea()
    store.attach(buf.id, ta as unknown as TextareaRenderable)
    ta.type("// mine\n")
    store.onContentChange(buf.id)
    expect(buf.dirty).toBe(true)
    await writeFile(path, "one\ntwo\nthree\nfour\nFIVE (ai)\n")
    expect(await store.handleDiskChange(path)).toBe("conflict")
    expect(store.mergePreview(buf.id)).toBe("// mine\none\ntwo\nthree\nfour\nFIVE (ai)\n")
    expect(store.mergeConflict(buf.id)).toBe(true)
    expect(ta.plainText).toBe("// mine\none\ntwo\nthree\nfour\nFIVE (ai)\n")
    expect(buf.conflict).toBe(false)
    expect(buf.dirty).toBe(true) // your edit is still unsaved
    await rm(dir, { recursive: true })
  })
})

describe("highlighting", () => {
  test("hidden tabs are coloured when shown, not in the background", async () => {
    const seen: string[] = []
    store = new BufferStore({
      root: dir,
      highlight: async (text) => (seen.push(text), []),
      resolveStyle: () => 1,
      highlightDelayMs: 0,
    })
    const a = await openWithTextarea("a.ts", "A")
    const b = await openWithTextarea("b.ts", "B") // b is active; a went to the background
    await Bun.sleep(5)
    expect(seen).toEqual(["A", "B"])
    a.ta.replaceText("A2")
    store.onContentChange(a.buf.id) // e.g. an edit to a hidden tab
    await Bun.sleep(5)
    expect(seen).toEqual(["A", "B"])
    store.activate(a.buf.id)
    await Bun.sleep(5)
    expect(seen).toEqual(["A", "B", "A2"])
    store.close(a.buf.id) // b comes back, nothing pending for it
    await Bun.sleep(5)
    expect(seen).toEqual(["A", "B", "A2"])
    expect(store.active?.id).toBe(b.buf.id)
  })

  test("save refuses to overwrite a change on disk the watcher never reported; force overwrites", async () => {
    const { buf, ta } = await openWithTextarea("a.ts", "v1\n")
    ta.type("mine ")
    store.onContentChange(buf.id)
    await Bun.sleep(10) // a later mtime
    await writeFile(join(dir, "a.ts"), "theirs\n") // no handleDiskChange: the watcher missed it
    await expect(store.save(buf.id)).rejects.toBeInstanceOf(DiskChangedError)
    expect(await readFile(join(dir, "a.ts"), "utf8")).toBe("theirs\n")
    expect(buf.conflict).toBe(true) // now a conflict, with the bar
    await expect(store.save(buf.id)).rejects.toBeInstanceOf(DiskChangedError) // still undecided
    await store.save(buf.id, { force: true })
    expect(await readFile(join(dir, "a.ts"), "utf8")).toBe("mine v1\n")
    expect(buf.conflict).toBe(false)
    expect(buf.dirty).toBe(false)
  })

  test("a touched file (same content, new mtime) saves normally", async () => {
    const { buf, ta } = await openWithTextarea("a.ts", "v1\n")
    ta.type("x")
    store.onContentChange(buf.id)
    await Bun.sleep(10)
    await writeFile(join(dir, "a.ts"), "v1\n")
    await store.save(buf.id)
    expect(await readFile(join(dir, "a.ts"), "utf8")).toBe("xv1\n")
  })

  test("keys typed while a save is being written keep the buffer dirty", async () => {
    const { buf, ta } = await openWithTextarea("a.ts", "v1\n")
    ta.type("a")
    store.onContentChange(buf.id)
    // The text is read for the write; a key arrives right after, while the file is written.
    let text = ta.plainText
    let reads = 0
    Object.defineProperty(ta, "plainText", {
      get: () => {
        const now = text
        if (++reads === 1) text = "b" + text
        return now
      },
      set: (v: string) => (text = v),
    })
    await store.save(buf.id)
    expect(await readFile(join(dir, "a.ts"), "utf8")).toBe("av1\n")
    expect(buf.dirty).toBe(true)
  })

  test("reload from disk of a deleted file keeps the text and flags it", async () => {
    const { buf, ta } = await openWithTextarea("a.ts", "v1\n")
    ta.type("mine ")
    store.onContentChange(buf.id)
    await rm(join(dir, "a.ts"))
    expect(await store.reloadFromDisk(buf.id)).toBe("gone")
    expect(ta.plainText).toBe("mine v1\n")
    expect(buf.deleted).toBe(true)
  })
})
