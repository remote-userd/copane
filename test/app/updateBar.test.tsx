import { afterEach, expect, test } from "bun:test"
import { createWorkspace, fixture, renderApp, type Harness } from "../helpers"

let h: Harness | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  h = null
})

test("a release that's out but not installed shows in the status bar; an installed one offers a restart", async () => {
  const ws = createWorkspace(await fixture({ "a.txt": "a" }))
  h = await renderApp(ws)
  ws.ui.set({ updateAvailable: "v9.9.9" })
  await h.setup.renderOnce()
  expect(h.frame()).toContain("⬆ copane v9.9.9: install")
  ws.ui.set({ updateReady: true, updateAvailable: null })
  await h.setup.renderOnce()
  expect(h.frame()).toContain("⟳ Update installed: restart")
  expect(h.frame()).not.toContain("v9.9.9")
})
