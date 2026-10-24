import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test"
import { join } from "node:path"
import { TerminalPane, terminalErrors, type AiConfig } from "../../src/ai/TerminalPane"
import { browserCommand, linkAt } from "../../src/ai/terminalLinks"
import type { MenuItem } from "../../src/app/state"
import { MouseButtons } from "@opentui/core/testing"
import { createWorkspace, fixture, renderApp, type Harness, waitUntil } from "../helpers"

setDefaultTimeout(15_000)

// Terminal tabs run $SHELL: a plain sh here, whatever the machine's login shell is.
const shellBefore = Bun.env.SHELL
beforeAll(() => {
  Bun.env.SHELL = "/bin/sh"
})
afterAll(() => {
  Bun.env.SHELL = shellBefore
})

let h: Harness | null = null
afterEach(() => {
  h?.ws.ai?.kill()
  h?.setup.renderer.destroy()
  h = null
})
const until = (cond: () => boolean | Promise<boolean>, ms = 8000) => waitUntil(cond, ms, () => h?.setup.renderOnce())

// The agent echoes what it gets (cat), so text sent to it shows on its screen. It is a /bin/sh too,
// so terminals (also sh) are numbered after it: "sh 2".
const config = (services: AiConfig["services"]): AiConfig => ({
  command: "/bin/sh",
  args: ["-c", "echo agent-ready; exec cat"],
  maxScrollbackBytes: 100_000,
  notify: "off",
  services,
})
const TARGETS = [
  { name: "web", command: "echo 'web ready in 12 ms'" },
  // A watcher printing a compiler error that points at a project file.
  { name: "api", command: "printf 'Starting compilation...\\nsrc/main.ts:3:7 - error TS2322: boom\\n'", cwd: "api" },
]

async function pane(targets = TARGETS) {
  const root = await fixture({ "api/src/main.ts": "a\nb\nconst x: number = 'y'\n" })
  const ws = createWorkspace(root)
  h = await renderApp(ws, { tree: <text>TREE</text>, ai: <TerminalPane config={config(targets)} /> }, { width: 150, height: 24 })
  await until(() => h!.frame().includes("agent-ready"))
  return { ws, root }
}
type Ws = ReturnType<typeof createWorkspace>
const menuItem = (ws: Ws, label: string) => {
  const modal = ws.ui.get().modal
  if (modal?.kind !== "menu") throw new Error("no menu open")
  const item = modal.items.find((i: MenuItem) => i.label === label)
  if (!item) throw new Error(`no "${label}" in ${modal.items.map((i) => i.label).join(", ")}`)
  return { ...item, run: () => (ws.ui.set({ modal: null }), item.run()) }
}
const menuOpen = (ws: Ws) => until(() => ws.ui.get().modal?.kind === "menu")
const click = async (text: string) => {
  const at = h!.find(text)
  await h!.step(() => h!.mouse.click(at.x, at.y))
}

test("the header's + offers agents, a terminal and the project's dev servers", async () => {
  const { ws } = await pane()
  await click("+ new")
  await menuOpen(ws)
  const labels = (ws.ui.get().modal as { items: MenuItem[] }).items.map((i) => i.label)
  expect(labels).toEqual(["New sh", "New sh in a git worktree", "New terminal", "▶ Run web", "▶ Run api"])
  await h!.step(() => menuItem(ws, "▶ Run web").run())
  await until(() => h!.frame().includes("web ready in 12 ms") && h!.frame().includes("WEB ●"))
  // Running now: marked, and choosing it shows its tab instead of a second one.
  await h!.step(() => ws.agents!.openRun())
  await menuOpen(ws)
  expect(menuItem(ws, "● Run web").hint).toBe("echo 'web ready in 12 ms'")
})

test("a terminal runs your shell; `exit` closes its tab", async () => {
  const { ws } = await pane()
  await h!.step(() => ws.agents!.newTerminal())
  await until(() => h!.frame().includes("SH 2 ●"))
  // Typed into the terminal as you would (it has the focus).
  await h!.step(() => h!.keys.typeText("echo hi-from-shell"))
  await h!.step(() => h!.keys.pressEnter())
  // Its output, not just the typed command.
  await until(() => h!.lines().some((l) => l.includes("hi-from-shell") && !l.includes("echo")))
  await h!.step(() => h!.keys.typeText("exit"))
  await h!.step(() => h!.keys.pressEnter())
  await until(() => !h!.frame().includes("SH 2 ●"))
})

test("an error gets ✗ and a header button that sends it to the agent; the next command clears it", async () => {
  const { ws, root } = await pane()
  await h!.step(() => ws.agents!.openRun())
  await menuOpen(ws)
  await h!.step(() => menuItem(ws, "▶ Run api").run())
  await until(() => h!.frame().includes("API ✗") && h!.frame().includes("✗ Fix with AI"))
  expect(terminalErrors()[0]!.error.location).toEqual({ path: join(root, "api/src/main.ts"), line: 3, col: 7 })
  // The button: the agent tab shows, with the error and where it points in its prompt.
  await click("✗ Fix with AI")
  await until(() => h!.frame().includes("The api dev server") && h!.frame().includes("@api/src/main.ts#L3"))
  expect(h!.frame()).toContain("agent-ready")
  // Back in the terminal, a new command starts a new round.
  await h!.step(() => ws.agents!.cycle(1))
  await until(() => h!.frame().includes("Starting compilation"))
  await h!.step(() => h!.keys.typeText("true"))
  await h!.step(() => h!.keys.pressEnter())
  await until(() => h!.frame().includes("API ●"))
  expect(terminalErrors()).toEqual([])
})

test("AI text goes to the agent even while a terminal shows", async () => {
  const { ws } = await pane()
  await h!.step(() => ws.agents!.newTerminal())
  await until(() => h!.frame().includes("SH 2 ●"))
  await h!.step(() => ws.ai!.type("for-the-agent"))
  // The terminal stays clean; the agent got it (and is shown by focus()).
  await h!.step(() => ws.ai!.focus())
  await until(() => h!.frame().includes("for-the-agent") && h!.frame().includes("agent-ready"))
})

test("right-click pastes into the tab clicked (no menu); ↻ restarts a dev server", async () => {
  const { ws } = await pane()
  await ws.clipboard.copy("from-the-clipboard")
  const at = h!.find("agent-ready")
  await h!.step(() => h!.mouse.click(at.x, at.y + 2, MouseButtons.RIGHT))
  await until(() => h!.frame().includes("from-the-clipboard"))
  expect(ws.ui.get().modal).toBeNull()

  await h!.step(() => ws.agents!.openRun())
  await menuOpen(ws)
  await h!.step(() => menuItem(ws, "▶ Run web").run())
  await until(() => h!.frame().includes("web ready in 12 ms") && h!.frame().includes("↻"))
  // A fresh shell runs it again: the screen is cleared, then the line comes back.
  await click("↻")
  await until(() => h!.frame().includes("web ready in 12 ms") && h!.frame().includes("WEB ●"))
})

test("links in terminal lines: file:line[:col], tsc's (line,col), and URLs", () => {
  const cwd = "/p/api"
  const line = "src/main.ts:3:7 - error, see http://localhost:3001/docs. or /abs/x.vue(12,4)"
  expect(linkAt(line, 2, cwd)).toEqual({ kind: "file", path: "/p/api/src/main.ts", line: 3, col: 7 })
  expect(linkAt(line, line.indexOf("localhost"), cwd)).toEqual({ kind: "url", url: "http://localhost:3001/docs" })
  expect(linkAt(line, line.indexOf("x.vue"), cwd)).toEqual({ kind: "file", path: "/abs/x.vue", line: 12, col: 4 })
  expect(linkAt(line, line.indexOf("error"), cwd)).toBeNull()
  expect(browserCommand("http://x", "mac")).toEqual(["open", "http://x"])
  expect(browserCommand("http://x", "linux")).toEqual(["xdg-open", "http://x"])
})

test("in the AI pane, Ctrl+J and Ctrl+B reach the CLI (Claude's new line / run in background)", async () => {
  const root = await fixture({ "a.txt": "a\n" })
  const ws = createWorkspace(root, { focus: "ai" })
  // Raw mode, so the bytes arrive as sent; dd stops after two of them and od prints them.
  const raw: AiConfig = {
    ...config([]),
    args: ["-c", "stty raw -echo; echo agent-ready; dd bs=1 count=2 2>/dev/null | od -An -tx1"],
  }
  h = await renderApp(ws, { tree: <text>TREE</text>, ai: <TerminalPane config={raw} /> }, { width: 150, height: 24 })
  await until(() => h!.frame().includes("agent-ready"))
  await h.step(() => h!.keys.pressKey("LINEFEED"))
  await h.step(() => h!.keys.pressKey("b", { ctrl: true }))
  // BSD od (macOS) pads its columns wider than GNU od.
  await until(() => /0a\s+02/.test(h!.frame()))
  expect(ws.ui.get().focus).toBe("ai")
})

test("Alt+` opens a terminal tab from the AI pane too", async () => {
  const { ws } = await pane([])
  ws.ui.set({ focus: "ai" })
  await h!.step(() => h!.keys.pressKey("`", { meta: true }))
  await until(() => h!.frame().includes("SH 2 ●"))
})
