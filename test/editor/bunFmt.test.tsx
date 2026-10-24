import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { join } from "node:path"
import { configSchema } from "../../src/config/schema"
import { hasFormatConfig, NoParser, runBunFmt } from "../../src/editor/bunFmt"
import { createWorkspace, fixture, renderApp, type Harness, waitUntil } from "../helpers"

setDefaultTimeout(15_000)

let h: Harness | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  h = null
})

async function project(files: Record<string, string>, open: string, editor: Record<string, unknown> = {}) {
  const root = await fixture(files)
  const ws = createWorkspace(root, undefined, configSchema.parse({ editor }))
  await ws.buffers.open(open)
  h = await renderApp(ws, { tree: <text>TREE</text> })
  return { h, ws, root }
}

const format = async (h: Harness, notice: string) => {
  await h.step(() => h.keys.pressKey("\x1bF"))
  await waitUntil(
    () => h.frame().includes(notice),
    5000,
    () => h.setup.renderOnce(),
  )
}

test("bun fmt formats from stdin, with the project's config; unknown types and syntax errors throw", async () => {
  const root = await fixture({ "bunfig.toml": "[fmt]\nsemi = false\n", "src/deep/a.ts": "" })
  expect(await runBunFmt(join(root, "src/deep/a.ts"), "const   x = 1;\n", root)).toBe("const x = 1\n")
  await expect(runBunFmt(join(root, "a.py"), "x = 1\n", root)).rejects.toBeInstanceOf(NoParser)
  await expect(runBunFmt(join(root, "a.ts"), "const = ;\n", root)).rejects.toThrow("Variable declaration expected. (1:7)")
})

test("a Prettier or bunfig [fmt] config counts from the file up to the root", async () => {
  const withBunfig = await fixture({ "bunfig.toml": "[test]\n\n[fmt]\nprintWidth = 120\n", "src/a.ts": "" })
  expect(await hasFormatConfig(join(withBunfig, "src/a.ts"), withBunfig)).toBe(true)
  const withPkg = await fixture({ "package.json": '{ "prettier": {} }', "src/a.ts": "" })
  expect(await hasFormatConfig(join(withPkg, "src/a.ts"), withPkg)).toBe(true)
  const bare = await fixture({ "bunfig.toml": "[test]\n", "a.ts": "" })
  expect(await hasFormatConfig(join(bare, "a.ts"), bare)).toBe(false)
})

test("Shift+Alt+F: a project with a [fmt] config but no Prettier formats with bun fmt", async () => {
  const { h, ws } = await project({ "bunfig.toml": "[fmt]\nsemi = false\n", "a.ts": "const   x = {a:1};\n" }, "a.ts")
  await format(h, "Formatted with bun fmt")
  expect(ws.buffers.active!.textarea!.plainText).toBe("const x = { a: 1 }\n")
})

test("Shift+Alt+F: files no language server formats (Markdown) use bun fmt; errors keep the text", async () => {
  const { h, ws } = await project({ "a.md": "# T\n*  a\n" }, "a.md")
  await format(h, "Formatted with bun fmt")
  expect(ws.buffers.active!.textarea!.plainText).toBe("# T\n\n- a\n")
  const ts = await project({ "a.ts": "const = ;\n" }, "a.ts")
  await format(ts.h, "bun fmt: Variable declaration expected")
  expect(ts.ws.buffers.active!.textarea!.plainText).toBe("const = ;\n")
})

test("Shift+Alt+F: a file nothing can format says so", async () => {
  const { h, ws } = await project({ "a.py": "x  =  1\n" }, "a.py")
  await format(h, "No formatter for this file")
  expect(ws.buffers.active!.textarea!.plainText).toBe("x  =  1\n")
})

test('formatter "lsp" never uses bun fmt', async () => {
  const { h, ws } = await project({ "a.md": "*  a\n" }, "a.md", { formatter: "lsp" })
  await format(h, "No language server that formats this file")
  expect(ws.buffers.active!.textarea!.plainText).toBe("*  a\n")
})
