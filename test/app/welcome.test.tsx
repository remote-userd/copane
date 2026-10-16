import { afterEach, expect, test } from "bun:test"
import { act } from "react"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { testRender } from "@opentui/react/test-utils"
import { Welcome } from "../../src/app/Welcome"
import { captureFrame, waitUntil } from "../helpers"

let setup: Awaited<ReturnType<typeof testRender>> | null = null
afterEach(() => {
  setup?.renderer.destroy()
  setup = null
})

async function welcome(opts: { here?: boolean; atHome?: boolean } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "cea-welcome-"))
  for (const d of ["alpha", "beta", "code/gamma"]) mkdirSync(join(cwd, d), { recursive: true })
  writeFileSync(join(cwd, "file.txt"), "")
  const recent = [join(cwd, "alpha"), join(cwd, "beta")].map((path, i) => ({ path, openedAt: i }))
  const opened: string[] = []
  const forgotten: string[] = []
  let quit = 0
  setup = await testRender(
    <Welcome version="9.9.9" recent={recent} cwd={cwd} here={opts.here} home={opts.atHome ? cwd : "/nowhere"} onOpen={(p) => opened.push(p)} onForget={(p) => forgotten.push(p)} onQuit={() => quit++} />,
    { width: 100, height: 30, exitOnCtrlC: false },
  )
  await setup.renderOnce()
  const s = setup
  const frame = () => captureFrame(s)
  const step = async (fn: () => unknown) => {
    await act(async () => {
      await fn()
      await Bun.sleep(10)
    })
    await s.renderOnce()
  }
  const find = (text: string) => {
    const lines = frame().split("\n")
    const y = lines.findIndex((l) => l.includes(text))
    return { x: lines[y]!.indexOf(text), y }
  }
  return { cwd, opened, forgotten, quits: () => quit, frame, step, find, keys: s.mockInput, mouse: s.mockMouse }
}

test("lists recent folders; Enter, a number or a click opens one", async () => {
  const w = await welcome()
  expect(w.frame()).toContain("RECENT")
  expect(w.frame()).toContain("alpha")
  expect(w.frame()).toContain("Open folder…")
  expect(w.frame()).toContain(`Open ${w.cwd.split("/").pop()}`)
  await w.step(() => w.keys.pressEnter())
  await w.step(() => w.keys.pressKey("2"))
  const beta = w.find("beta")
  await w.step(() => w.mouse.click(beta.x, beta.y))
  expect(w.opened).toEqual([join(w.cwd, "alpha"), join(w.cwd, "beta"), join(w.cwd, "beta")])
})

test("Delete or the row's × removes a folder; . and the button open the current one; Esc quits", async () => {
  const w = await welcome()
  await w.step(() => w.keys.pressKey("DELETE"))
  expect(w.forgotten).toEqual([join(w.cwd, "alpha")])
  expect(w.frame()).not.toContain("alpha")
  // The selected row shows its ×.
  const x = w.find(" × ")
  await w.step(() => w.mouse.click(x.x + 1, x.y))
  expect(w.forgotten).toEqual([join(w.cwd, "alpha"), join(w.cwd, "beta")])
  expect(w.frame()).toContain("Nothing yet")
  await w.step(() => w.keys.pressKey("."))
  const here = w.find(`Open ${w.cwd.split("/").pop()}`)
  await w.step(() => w.mouse.click(here.x, here.y))
  expect(w.opened).toEqual([w.cwd, w.cwd])
  await w.step(() => w.keys.pressEscape())
  await waitUntil(() => w.quits() === 1, 1000)
})

test("browse: typing filters folders, Enter goes in, the first row opens the folder shown", async () => {
  const w = await welcome()
  await w.step(() => w.keys.pressKey("o"))
  const shows = (t: string) => waitUntil(async () => (await w.step(() => {}), w.frame().includes(t)), 1000)
  await shows("Open folder")
  await shows("▸  code")
  expect(w.frame()).toContain("▸  alpha")
  await w.step(() => w.keys.typeText("co"))
  await shows("matching “co”")
  expect(w.frame()).not.toContain("▸  alpha")
  // The match is selected: Enter goes into it.
  await w.step(() => w.keys.pressEnter())
  await shows("▸  gamma")
  // A click goes into a folder; the first row opens the one shown.
  const gamma = w.find("gamma")
  await w.step(() => w.mouse.click(gamma.x, gamma.y))
  await shows("Open this folder (gamma)")
  await w.step(() => w.keys.pressEnter())
  await waitUntil(() => w.opened.length === 1, 1000)
  expect(w.opened).toEqual([join(w.cwd, "code/gamma")])
})

test("browse: a row's open button opens it directly; Backspace goes up; Esc goes back", async () => {
  const w = await welcome()
  await w.step(() => w.keys.pressKey("o"))
  const shows = (t: string) => waitUntil(async () => (await w.step(() => {}), w.frame().includes(t)), 1000)
  await shows("▸  beta")
  const beta = w.find("▸  beta")
  await w.step(() => w.mouse.moveTo(beta.x + 2, beta.y))
  const open = w.find(" open ")
  await w.step(() => w.mouse.click(open.x + 1, open.y))
  expect(w.opened).toEqual([join(w.cwd, "beta")])
  await w.step(() => w.keys.pressBackspace())
  await shows(`Open this folder (${w.cwd.split("/").slice(-2, -1)[0]})`)
  await w.step(() => w.keys.pressEscape())
  await shows("RECENT")
})

test("inside the editor (here off) there is no button for the current folder", async () => {
  const w = await welcome({ here: false })
  expect(w.frame()).not.toContain(`Open ${w.cwd.split("/").pop()}`)
  await w.step(() => w.keys.pressKey("."))
  expect(w.opened).toEqual([])
})

test("ago says how long ago", async () => {
  const { ago } = await import("../../src/app/Welcome")
  const now = 1_000_000_000_000
  expect(ago(now - 10_000, now)).toBe("just now")
  expect(ago(now - 5 * 60_000, now)).toBe("5m ago")
  expect(ago(now - 2 * 3_600_000, now)).toBe("2h ago")
  expect(ago(now - 3 * 86_400_000, now)).toBe("3d ago")
})

test("Ctrl+Alt+O in the editor shows the recent folders (not the open one); Esc goes back", async () => {
  const { createWorkspace, fixture, renderApp } = await import("../helpers")
  const state = mkdtempSync(join(tmpdir(), "cea-state-"))
  const root = await fixture({ "a.ts": "a" })
  const other = mkdtempSync(join(tmpdir(), "cea-other-"))
  const before = Bun.env.XDG_STATE_HOME
  Bun.env.XDG_STATE_HOME = state
  try {
    const { recordRecent } = await import("../../src/app/recent")
    await recordRecent(other)
    await recordRecent(root)
    const ws = createWorkspace(root)
    const h = await renderApp(ws, { tree: <text>TREE</text> })
    setup = h.setup
    await h.step(() => h.keys.pressKey("o", { ctrl: true, meta: true }))
    await waitUntil(async () => (await h.step(() => {}), h.frame().includes("Open folder…")), 2000)
    expect(h.frame()).toContain(other.split("/").pop()!)
    expect(h.frame()).not.toContain(`Open ${root.split("/").pop()}`)
    await h.step(() => h.keys.pressEscape())
    await waitUntil(() => ws.ui.get().modal === null, 1000)
  } finally {
    if (before === undefined) delete Bun.env.XDG_STATE_HOME
    else Bun.env.XDG_STATE_HOME = before
  }
})

test("started in the home folder: the button browses it, and opening ~ itself takes a second go", async () => {
  const w = await welcome({ atHome: true })
  const shows = (t: string) => waitUntil(async () => (await w.step(() => {}), w.frame().includes(t)), 1000)
  expect(w.frame()).toContain("Browse ")
  expect(w.frame()).not.toContain(`Open ${w.cwd.split("/").pop()}`)
  await w.step(() => w.keys.pressKey("."))
  await shows("Open this folder")
  // The first row is ~ itself: a warning first, then it opens.
  await w.step(() => w.keys.pressEnter())
  await shows("your whole home folder")
  expect(w.opened).toEqual([])
  await w.step(() => w.keys.pressEnter())
  expect(w.opened).toEqual([w.cwd])
  // Going into a folder there opens it straight away.
  await w.step(() => w.keys.typeText("al"))
  await w.step(() => w.keys.pressEnter())
  await shows("Open this folder (alpha)")
  await w.step(() => w.keys.pressEnter())
  expect(w.opened).toEqual([w.cwd, join(w.cwd, "alpha")])
})
