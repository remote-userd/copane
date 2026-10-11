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
  expect(await Bun.file(path).json()).toEqual({ treeWidth: null, aiWidth: 50 })
  expect(await loadLayout(path)).toEqual({ treeWidth: null, aiWidth: 50 })
  stop()
})
