import { expect, test } from "bun:test"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createWorkspace } from "../../src/app/workspace"
import { loadLayout, persistLayout } from "../../src/app/layoutState"
import { runCommand } from "../../src/keymap/commands"
import { waitUntil } from "../helpers"

test("toggle AI pane: hiding moves focus off it; showing again restores", async () => {
  const ws = createWorkspace("/tmp", { focus: "ai" })
  await runCommand(ws, "view.toggleAi")
  expect(ws.ui.get()).toMatchObject({ aiVisible: false, focus: "editor" })
  await runCommand(ws, "view.toggleAi")
  expect(ws.ui.get().aiVisible).toBe(true)
})

test("maximize editor hides tree and AI, and the second press restores what was visible", async () => {
  const ws = createWorkspace("/tmp", { treeVisible: false, aiVisible: true })
  await runCommand(ws, "view.maximizeEditor")
  expect(ws.ui.get()).toMatchObject({ treeVisible: false, aiVisible: false, focus: "editor" })
  await runCommand(ws, "view.maximizeEditor")
  expect(ws.ui.get()).toMatchObject({ treeVisible: false, aiVisible: true, maximized: null })
})

test("dragged pane widths are saved after the drag and loaded next time", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "layout-")), "s/layout.json")
  const ws = createWorkspace("/tmp")
  const stop = persistLayout(ws.ui, path)
  ws.ui.set({ resizing: "ai", aiWidth: 50 })
  expect(await loadLayout(path)).toEqual({}) // not while dragging
  ws.ui.set({ resizing: null })
  await waitUntil(() => existsSync(path), 2000) // the save is asynchronous
  expect(await Bun.file(path).json()).toEqual({ treeWidth: null, aiWidth: 50, aiMaximized: false })
  expect(await loadLayout(path)).toEqual({ treeWidth: null, aiWidth: 50 })
  stop()
})

test("maximize AI hides the tree, takes focus, and the second press brings the tree back", async () => {
  const ws = createWorkspace("/tmp", { focus: "editor", treeVisible: true })
  await runCommand(ws, "view.maximizeAi")
  expect(ws.ui.get()).toMatchObject({ aiMaximized: { tree: true }, treeVisible: false, aiVisible: true, focus: "ai" })
  await runCommand(ws, "view.maximizeAi")
  expect(ws.ui.get()).toMatchObject({ aiMaximized: null, treeVisible: true })
})

test("maximize editor and maximize AI replace each other, restoring the tree from before both", async () => {
  const ws = createWorkspace("/tmp", { treeVisible: true, aiVisible: true })
  await runCommand(ws, "view.maximizeAi")
  await runCommand(ws, "view.maximizeEditor")
  expect(ws.ui.get()).toMatchObject({ aiMaximized: null, maximized: { tree: true, ai: true }, aiVisible: false })
  await runCommand(ws, "view.maximizeAi")
  expect(ws.ui.get()).toMatchObject({ maximized: null, aiMaximized: { tree: true }, aiVisible: true })
  // Hiding the AI pane ends the mode too.
  await runCommand(ws, "view.toggleAi")
  expect(ws.ui.get()).toMatchObject({ aiMaximized: null, aiVisible: false, treeVisible: true })
})

test("maximize AI is saved and comes back next time, with the tree hidden", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "layout-")), "layout.json")
  const ws = createWorkspace("/tmp")
  const stop = persistLayout(ws.ui, path)
  await runCommand(ws, "view.maximizeAi")
  await waitUntil(async () => existsSync(path) && (await Bun.file(path).text()).includes(`"aiMaximized":true`), 2000)
  expect(await loadLayout(path)).toMatchObject({ aiMaximized: { tree: true }, treeVisible: false })
  stop()
})
