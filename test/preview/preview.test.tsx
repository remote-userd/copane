import { afterEach, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { runCommand } from "../../src/keymap/commands"
import { previewPath } from "../../src/editor/BufferStore"
import { imageCells, localImagePath } from "../../src/preview/images"
import { createWorkspace, fixture, renderApp, type Harness, waitUntil } from "../helpers"
import { makePng } from "../support/png"

let h: Harness | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  h = null
})
const until = (cond: () => boolean | Promise<boolean>, ms = 3000) => waitUntil(cond, ms, () => h?.setup.renderOnce())

const README = "# Shop Title\n\nSome **bold** text.\n\n| Name | Price |\n| --- | --- |\n| Cable | 9 |\n"

test("an image opens as a tab with its format and size, not as a binary-file error", async () => {
  const root = await fixture({})
  writeFileSync(join(root, "logo.png"), makePng(64, 32))
  const ws = createWorkspace(root)
  const buf = await ws.buffers.open(join(root, "logo.png"))
  expect(buf.kind).toBe("image")
  expect(buf.image).toEqual({ format: "png", width: 64, height: 32, bytes: expect.any(Number), frames: 1 })
  h = await renderApp(ws, { tree: <text>TREE</text> })
  await until(() => h!.frame().includes("PNG · 64×32") && h!.frame().includes("█"))
  // Drawn at its own size (64×32 pixels is about 8×2 cells), not stretched over the pane.
  const blockRows = h.lines().filter((l) => l.includes("█"))
  expect(blockRows.length).toBeLessThanOrEqual(3)
  expect(Math.max(...blockRows.map((l) => l.split("█").length - 1))).toBeLessThanOrEqual(9)
  expect(h.frame()).toContain("PNG · 64×32")
  expect(h.frame()).toContain("logo.png")
  // The status bar shows the size instead of a cursor position.
  const status = h.lines().at(-2)!
  expect(status).toContain("64×32")
  expect(status).not.toContain("Ln 1")
})

test("a binary file that isn't an image still refuses to open", async () => {
  const root = await fixture({})
  writeFileSync(join(root, "data.bin"), new Uint8Array([1, 0, 2, 0]))
  const ws = createWorkspace(root)
  await expect(ws.buffers.open(join(root, "data.bin"))).rejects.toThrow(/binary/)
})

test("image tabs: save-all skips them, and a change on disk reloads them", async () => {
  const root = await fixture({ "a.ts": "x\n" })
  const png = join(root, "pic.png")
  writeFileSync(png, makePng(10, 10))
  const ws = createWorkspace(root)
  const img = await ws.buffers.open(png)
  expect(await ws.buffers.save(img.id)).toBeNull()
  writeFileSync(png, makePng(20, 12))
  expect(await ws.buffers.handleDiskChange(png)).toBe("reloaded")
  expect(img.image?.width).toBe(20)
  expect(img.version).toBe(1)
})

test("Alt+Shift+V opens the rendered preview tab, and again goes back to the file", async () => {
  const root = await fixture({ "README.md": README })
  const ws = createWorkspace(root)
  await ws.buffers.open(join(root, "README.md"))
  h = await renderApp(ws, { tree: <text>TREE</text> })
  await h.step(() => runCommand(ws, "markdown.openPreview"))
  expect(ws.buffers.active?.kind).toBe("preview")
  await until(() => h!.frame().includes("Shop Title") && h!.frame().includes("Cable"))
  const frame = h.frame()
  expect(frame).toContain("Preview README.md")
  expect(frame).toContain("Shop Title")
  expect(frame).not.toContain("# Shop Title")
  expect(frame).not.toContain("**bold**")
  expect(frame).toContain("Cable")
  await h.step(() => runCommand(ws, "markdown.openPreview"))
  expect(ws.buffers.active?.kind).toBe("text")
})

test("the preview follows typing in the open file", async () => {
  const root = await fixture({ "notes.md": "# First\n" })
  const ws = createWorkspace(root)
  const src = await ws.buffers.open(join(root, "notes.md"))
  h = await renderApp(ws, { tree: <text>TREE</text> })
  await until(() => src.textarea !== null)
  ws.buffers.openPreview(join(root, "notes.md"))
  await until(() => h!.frame().includes("First"))
  await h.step(() => ws.buffers.replaceText(src, "# Second heading\n"))
  await until(() => h!.frame().includes("Second heading"))
  expect(h.frame()).toContain("Second heading")
})

test("a preview of a file that isn't open re-reads it when it changes on disk", async () => {
  const root = await fixture({ "doc.md": "# Old\n" })
  const ws = createWorkspace(root)
  ws.buffers.openPreview(join(root, "doc.md"))
  h = await renderApp(ws, { tree: <text>TREE</text> })
  await until(() => h!.frame().includes("Old"))
  writeFileSync(join(root, "doc.md"), "# New text\n")
  await h.step(() => ws.buffers.handleDiskChange(join(root, "doc.md")))
  await until(() => h!.frame().includes("New text"))
  expect(h.frame()).toContain("New text")
  expect(ws.buffers.watchedPaths()).toEqual([join(root, "doc.md")])
})

test("Ctrl+K V shows the preview beside the Markdown file, and toggles it off", async () => {
  const root = await fixture({ "README.md": README, "a.ts": "const a = 1\n" })
  const ws = createWorkspace(root)
  await ws.buffers.open(join(root, "README.md"))
  h = await renderApp(ws, { tree: <text>TREE</text> })
  await h.step(() => runCommand(ws, "markdown.togglePreviewSide"))
  // Source and rendered view side by side: the raw heading, and the heading without its "#".
  const rendered = () => h!.lines().some((l) => /(^|[^#] )Shop Title/.test(l.slice(40)))
  const sideBySide = () => h!.frame().includes("# Shop Title") && rendered()
  await until(sideBySide)
  expect(sideBySide()).toBe(true)
  expect(h.frame()).toContain("Cable")
  // Not shown for other files.
  await h.step(() => ws.buffers.open(join(root, "a.ts")))
  expect(h.frame()).not.toContain("Shop Title")
  await h.step(() => ws.buffers.open(join(root, "README.md")))
  await until(sideBySide)
  expect(sideBySide()).toBe(true)
  await h.step(() => runCommand(ws, "markdown.togglePreviewSide"))
  expect(sideBySide()).toBe(false)
})

test("preview commands on other files say so", async () => {
  const root = await fixture({ "a.ts": "x\n" })
  const ws = createWorkspace(root)
  await ws.buffers.open(join(root, "a.ts"))
  await runCommand(ws, "markdown.openPreview")
  expect(ws.ui.get().notice?.text).toBe("Not a Markdown file")
  await runCommand(ws, "markdown.togglePreviewSide")
  expect(ws.ui.get().mdSide).toBe(false)
})

test("local images in Markdown render as pictures; remote ones keep their alt text", async () => {
  const root = await fixture({
    "doc.md": "# Pics\n\n![logo](img/logo.png)\n\nAfter the picture.\n\n![badge](https://example.com/b.svg)\n",
  })
  mkdirSync(join(root, "img"))
  writeFileSync(join(root, "img/logo.png"), makePng(80, 40))
  const ws = createWorkspace(root)
  ws.buffers.openPreview(join(root, "doc.md"))
  h = await renderApp(ws, { tree: <text>TREE</text> })
  await until(() => h!.frame().includes("After the picture"))
  const frame = h.frame()
  // Drawn as coloured half-blocks in the test renderer, in place of the "logo" label.
  expect(frame).toMatch(/[▀▄█]/)
  expect(frame).not.toContain("logo")
  expect(frame).toContain("badge")
})

test("localImagePath resolves relative paths and skips URLs", () => {
  expect(localImagePath("img/a.png", "/p/docs/r.md")).toBe("/p/docs/img/a.png")
  expect(localImagePath("../a%20b.png?raw=1", "/p/docs/r.md")).toBe("/p/a b.png")
  expect(localImagePath("https://x.com/a.png", "/p/r.md")).toBeNull()
  expect(localImagePath("data:image/png;base64,AA", "/p/r.md")).toBeNull()
  expect(localImagePath("//cdn/a.png", "/p/r.md")).toBeNull()
  // A stray % is not an escape: the path is used as written (decodeURI used to throw and crash).
  expect(localImagePath("50%.png", "/p/r.md")).toBe("/p/50%.png")
  expect(localImagePath("a%zz.png", "/p/r.md")).toBe("/p/a%zz.png")
})

test("imageCells keeps the aspect ratio, never enlarges, and fits the space", () => {
  expect(imageCells(80, 40, 100, 20)).toEqual({ width: 10, height: 3 })
  expect(imageCells(2000, 1000, 60, 20)).toEqual({ width: 60, height: 15 })
  expect(imageCells(100, 2000, 60, 20).height).toBe(20)
  expect(imageCells(4000, 4000, 100, 30)).toEqual({ width: 60, height: 30 })
})

test("preview and image tabs come back after a restart (restored by path)", async () => {
  const root = await fixture({ "README.md": README })
  writeFileSync(join(root, "p.png"), makePng(4, 4))
  const ws = createWorkspace(root)
  for (const p of [previewPath(join(root, "README.md")), join(root, "p.png")]) await ws.buffers.open(p)
  expect(ws.buffers.list().map((b) => b.kind)).toEqual(["preview", "image"])
  expect(ws.buffers.list()[0]!.name).toBe("Preview README.md")
})
