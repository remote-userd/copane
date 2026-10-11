import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { testRender } from "@opentui/react/test-utils"
import { App } from "../../src/app/App"
import { ErrorBoundary } from "../../src/app/ErrorBoundary"
import { restoreRecovery, saveRecovery } from "../../src/app/recovery"
import { useUi, WorkspaceContext } from "../../src/app/workspace"
import { createWorkspace, fixture, renderApp, type Harness, waitUntil } from "../helpers"

// Several waits on the UI and git per test: more room than the default 5 s.
setDefaultTimeout(15_000)

let h: Harness | null = null
let destroy: (() => void) | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  destroy?.()
  h = null
  destroy = null
})
const until = (cond: () => boolean, render: () => unknown, _what: string, ms = 3000) => waitUntil(cond, ms, render)

test("a crash backs up unsaved changes; the next start puts them back, undoably", async () => {
  const root = await fixture({ "a.txt": "saved\n", "b.txt": "clean\n" })
  const state = join(await fixture({}), "recovery")
  const ws = createWorkspace(root)
  await ws.buffers.open("b.txt")
  const a = await ws.buffers.open("a.txt")
  h = await renderApp(ws)
  await until(() => !!a.textarea, () => h!.setup.renderOnce(), "the editor")
  ws.buffers.replaceText(a, "unsaved work\n")
  expect(a.dirty).toBe(true)
  expect(await saveRecovery(ws, state)).toBe(1) // only the dirty one

  // The next session in the same project.
  h.setup.renderer.destroy()
  const next = createWorkspace(root)
  h = await renderApp(next)
  const restored = await restoreRecovery(next, state)
  expect(restored).toEqual(["a.txt"])
  const buf = next.buffers.byPath(join(root, "a.txt"))!
  expect(next.buffers.textOf(buf)).toBe("unsaved work\n")
  expect(buf.dirty).toBe(true)
  buf.textarea!.undo()
  expect(next.buffers.textOf(buf)).toBe("saved\n")
  // Restored once: the copies are gone.
  expect(await restoreRecovery(next, state)).toEqual([])
})

test("a crash copy older than the file on disk is not restored", async () => {
  const root = await fixture({ "a.txt": "v1\n" })
  const state = join(await fixture({}), "recovery")
  const ws = createWorkspace(root)
  const a = await ws.buffers.open("a.txt")
  h = await renderApp(ws)
  await until(() => !!a.textarea, () => h!.setup.renderOnce(), "the editor")
  ws.buffers.replaceText(a, "crash copy\n")
  await saveRecovery(ws, state)
  await Bun.sleep(20)
  writeFileSync(join(root, "a.txt"), "saved later\n") // the session went on and saved
  h.setup.renderer.destroy()
  const next = createWorkspace(root)
  h = await renderApp(next)
  expect(await restoreRecovery(next, state)).toEqual([])
})

test("a render error shows the crash screen; Ctrl+R draws the app again with unsaved text intact", async () => {
  const root = await fixture({ "a.txt": "on disk\n" })
  const ws = createWorkspace(root, { focus: "editor" })
  const a = await ws.buffers.open("a.txt")
  // Throws while the find query is "boom" (any UI state would do).
  function Bomb() {
    if (useUi().findQuery === "boom") throw new Error("render went wrong")
    return null
  }
  const setup = await testRender(
    <WorkspaceContext.Provider value={ws}>
      <ErrorBoundary>
        <Bomb />
        <App slots={{}} />
      </ErrorBoundary>
    </WorkspaceContext.Provider>,
    { width: 120, height: 24, exitOnCtrlC: false },
  )
  destroy = () => setup.renderer.destroy()
  const render = () => setup.renderOnce()
  await until(() => !!a.textarea, render, "the editor")
  ws.buffers.replaceText(a, "typed, not saved\n")

  const quiet = console.error
  console.error = () => {} // React logs the caught error
  try {
    ws.ui.set({ findQuery: "boom" })
    await until(() => setup.captureCharFrame().includes("stopped rendering"), render, "the crash screen")
  } finally {
    console.error = quiet
  }
  expect(setup.captureCharFrame()).toContain("render went wrong")
  expect(ws.buffers.textOf(a)).toBe("typed, not saved\n") // kept while the editor is gone

  ws.ui.set({ findQuery: "" })
  setup.mockInput.pressKey("r", { ctrl: true })
  await until(() => !!ws.buffers.byId(a.id)?.textarea && setup.captureCharFrame().includes("typed, not saved"), render, "the editor again")
  expect(ws.buffers.textOf(a)).toBe("typed, not saved\n")
  expect(a.dirty).toBe(true)
})
