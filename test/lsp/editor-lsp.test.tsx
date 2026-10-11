import { afterEach, expect, test } from "bun:test"
import { join } from "node:path"
import { LspManager } from "../../src/lsp/LspManager"
import { createWorkspace, fixture, renderApp, type Harness } from "../helpers"

const TSC = join(import.meta.dir, "../../node_modules/.bin/tsc")
let h: Harness | null = null
let lsp: LspManager | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  lsp?.stop()
  h = null
})

async function until(cond: () => boolean, ms = 15_000) {
  for (const end = Date.now() + ms; Date.now() < end && !cond(); ) {
    await Bun.sleep(50)
    await h?.setup.renderOnce()
  }
}

test("diagnostics, F8, completion and go to definition in the editor", async () => {
  const root = await fixture({
    "util.ts": "export function greet(name: string): string {\n  return name\n}\n",
    "main.ts": 'import { greet } from "./util"\nconst n: number = "x"\ngreet("a").toUpp\n',
  })
  const ws = createWorkspace(root)
  lsp = new LspManager(root, {}, (ft) => (ft === "typescript" ? { key: "ts", command: [TSC, "--lsp", "--stdio"], languages: { typescript: "typescript" } } : null))
  ws.lsp = lsp
  lsp.attach(ws.buffers)
  await ws.buffers.open("main.ts")
  h = await renderApp(ws, { tree: <text>TREE</text> })
  await until(() => h!.frame().includes("✖ 2"))
  expect(h.frame()).toContain("✖ 2 ⚠ 0")
  expect(h.lines().find((l) => l.includes('const n: number = "x"'))).toContain("●")

  // F8 goes to the first problem and shows its message in the status bar.
  await h.step(() => h!.keys.pressKey("F8"))
  await h.setup.renderOnce()
  expect(h.lines().at(-2)).toContain("not assignable to type 'number'")

  // Completion: put the cursor after "toUpp", type "e", Ctrl+Space, Enter.
  const ta = ws.buffers.active!.textarea!
  ta.setCursor(2, 16)
  await h.step(() => h!.keys.pressKey(" ", { ctrl: true }))
  await until(() => h!.frame().includes("toUpperCase"))
  await h.step(() => h!.keys.pressEnter())
  expect(ta.plainText.split("\n")[2]).toBe('greet("a").toUpperCase')
  await until(() => h!.frame().includes("✖ 1"))
  expect(h.frame()).toContain("✖ 1")

  // Typing "." opens suggestions automatically; Tab accepts the first match.
  ta.setCursor(2, 22)
  await h.step(() => h!.keys.typeText("()."))
  await until(() => h!.frame().includes("toLowerCase"))
  await h.step(() => h!.keys.typeText("toLo"))
  await h.step(() => h!.keys.pressTab())
  expect(ta.plainText.split("\n")[2]).toBe('greet("a").toUpperCase().toLowerCase')

  // F12 on "greet" opens util.ts at the definition.
  ta.setCursor(2, 2)
  await h.step(() => h!.keys.pressKey("F12"))
  await until(() => ws.buffers.active?.name === "util.ts")
  expect(ws.buffers.active?.name).toBe("util.ts")
  await until(() => ws.buffers.active?.textarea?.getSelectedText() === "greet", 3000)
  expect(ws.buffers.active!.textarea!.getSelectedText()).toBe("greet")

  // Back to main.ts, then Ctrl+click on "greet" jumps to it; Ctrl+Alt+← returns to the line we were on.
  await h.step(() => h!.keys.pressArrow("left", { ctrl: true, meta: true }))
  await until(() => ws.buffers.active?.name === "main.ts")
  ws.buffers.active!.textarea!.setCursor(0, 0)
  const p = h.find("greet(")
  await h.step(() => h!.mouse.click(p.x + 1, p.y, 0, { modifiers: { ctrl: true } }))
  await until(() => ws.buffers.active?.name === "util.ts")
  expect(ws.buffers.active?.name).toBe("util.ts")
  await until(() => ws.buffers.active?.textarea?.getSelectedText() === "greet", 3000)
  await h.step(() => h!.keys.pressArrow("left", { ctrl: true, meta: true }))
  await until(() => ws.buffers.active?.name === "main.ts")
  expect(ws.buffers.active!.textarea!.logicalCursor.row).toBe(0)

  // A plain click first (which leaves a selection anchor in the renderer) must not swallow
  // the next Ctrl+click.
  const q = h.find("greet(")
  await h.step(() => h!.mouse.click(q.x + 3, q.y - 1))
  await h.step(() => h!.mouse.click(q.x + 1, q.y, 0, { modifiers: { ctrl: true } }))
  await until(() => ws.buffers.active?.name === "util.ts")
  expect(ws.buffers.active?.name).toBe("util.ts")
}, 40_000)

test("rename across files (open buffer and closed file), references, format", async () => {
  const root = await fixture({
    "util.ts": "export function greet(name: string): string {\n  return name\n}\n",
    "main.ts": 'import { greet } from "./util"\ngreet("a")\nconst   x   =   greet( "b" )\n',
  })
  const ws = createWorkspace(root)
  lsp = new LspManager(root, {}, (ft) => (ft === "typescript" ? { key: "ts", command: [TSC, "--lsp", "--stdio"], languages: { typescript: "typescript" } } : null))
  ws.lsp = lsp
  lsp.attach(ws.buffers)
  await ws.buffers.open("main.ts")
  h = await renderApp(ws, { tree: <text>TREE</text> })
  await until(() => lsp!.status() === "ts")
  const ta = ws.buffers.active!.textarea!

  // Shift+F12 lists the declaration and both uses.
  ta.setCursor(1, 1)
  await h.step(() => h!.keys.pressKey("F12", { shift: true }))
  await until(() => h!.frame().includes("References to greet"))
  expect(h.frame()).toContain("References to greet (4)")
  await h.step(() => h!.keys.pressEscape())
  await Bun.sleep(150)

  // F2 renames everywhere: the open buffer changes in place, util.ts on disk.
  await h.step(() => h!.keys.pressKey("F2"))
  expect(h.frame()).toContain("Rename symbol")
  await h.step(() => h!.keys.pressKey("u", { ctrl: true })) // clear the field
  for (let i = 0; i < 10; i++) await h.step(() => h!.keys.pressBackspace())
  await h.step(() => h!.keys.typeText("hello"))
  await h.step(() => h!.keys.pressEnter())
  await until(() => ta.plainText.includes("hello("))
  expect(ta.plainText).toBe('import { hello } from "./util"\nhello("a")\nconst   x   =   hello( "b" )\n')
  expect(await Bun.file(join(root, "util.ts")).text()).toContain("export function hello(")
  ta.undo()
  expect(ta.plainText).toContain('greet("a")')
  ta.redo()

  // Ctrl+Alt+L formats the file (Alt+Shift+F arrives as Alt+→ in most terminals).
  await h.step(() => h!.keys.pressKey("l", { ctrl: true, meta: true }))
  await until(() => ta.plainText.includes('const x = hello("b")'))
  expect(ta.plainText.split("\n")[2]).toBe('const x = hello("b")')
}, 40_000)

test("parameter hints appear inside a call and close after it", async () => {
  const root = await fixture({ "main.ts": "function greet(name: string, times: number): string {\n  return name\n}\n\n" })
  const ws = createWorkspace(root)
  lsp = new LspManager(root, {}, (ft) => (ft === "typescript" ? { key: "ts", command: [TSC, "--lsp", "--stdio"], languages: { typescript: "typescript" } } : null))
  ws.lsp = lsp
  lsp.attach(ws.buffers)
  await ws.buffers.open("main.ts")
  h = await renderApp(ws, { tree: <text>TREE</text> })
  await until(() => lsp!.status() === "ts")
  const ta = ws.buffers.active!.textarea!
  ta.setCursor(3, 0)
  ta.insertText("greet")
  await h.step(() => h!.keys.typeText("("))
  const hint = () => h!.lines().find((l) => l.includes("greet(name: string, times: number): string") && !l.includes("function"))
  await until(() => !!hint())
  expect(hint()).toBeTruthy()
  await h.step(() => h!.keys.typeText('"a", 2'))
  await h.step(() => h!.keys.typeText(")"))
  await until(() => !hint(), 3000)
  expect(hint()).toBeUndefined()
}, 30_000)

test("Alt+. quick fix: a menu of code actions; choosing one adds the import", async () => {
  const root = await fixture({
    "util.ts": "export function greet(name: string): string {\n  return name\n}\n",
    "main.ts": 'greet("a")\n',
    "tsconfig.json": '{ "include": ["*.ts"] }\n',
  })
  const ws = createWorkspace(root)
  lsp = new LspManager(root, {}, (ft) => (ft === "typescript" ? { key: "ts", command: [TSC, "--lsp", "--stdio"], languages: { typescript: "typescript" } } : null))
  ws.lsp = lsp
  lsp.attach(ws.buffers)
  await ws.buffers.open("main.ts")
  h = await renderApp(ws, { tree: <text>TREE</text> })
  await until(() => h!.frame().includes("✖ 1"))
  const ta = ws.buffers.active!.textarea!
  ta.setCursor(0, 2)
  await h.step(() => h!.keys.pressKey(".", { meta: true }))
  await until(() => /Add import/i.test(h!.frame()))
  expect(h.frame()).toMatch(/Add import from "\.\/util"/)
  await h.step(() => h!.keys.pressEnter())
  await until(() => ta.plainText.startsWith("import"))
  expect(ta.plainText).toMatch(/^import \{ greet \} from "\.\/util";?\n\ngreet\("a"\)\n$/)
  await until(() => h!.frame().includes("✖ 0"))
  expect(h.frame()).toContain("✖ 0")
  ta.undo()
  expect(ta.plainText).toBe('greet("a")\n')
}, 30_000)
