import { expect, test } from "bun:test"
import { symlinkSync } from "node:fs"
import { join } from "node:path"
import type { TextareaRenderable } from "@opentui/core"
import { BufferStore } from "../../src/editor/BufferStore"
import { LspManager } from "../../src/lsp/LspManager"
import { projectRoot, resetProjectRoots } from "../../src/lsp/projectRoot"
import { installHint, serverFor } from "../../src/lsp/servers"
import { fixture, waitUntil } from "../helpers"

const NODE_MODULES = join(import.meta.dir, "../../node_modules")
const until = (cond: () => boolean | Promise<boolean>, ms = 20_000) => waitUntil(cond, ms)

class Ta {
  plainText = ""
  isDestroyed = false
  logicalCursor = { row: 0, col: 0 }
  lineCount = 1
  setText(t: string) {
    this.plainText = t
  }
  replaceText(t: string) {
    this.plainText = t
  }
  setCursor() {}
  removeHighlightsByRef() {}
  addHighlight() {}
}

/** Two packages, not a workspace (each its own package.json and node_modules), and a loose script at the root. */
async function monorepo() {
  const root = await fixture({
    "scripts/tool.ts": "export const t = 1\n",
    "packages/api/package.json": "{}",
    "packages/api/tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
    "packages/api/src/main.ts": "export const port: number = 'x'\n",
    "packages/web/package.json": "{}",
    "packages/web/tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
    "packages/web/src/app.ts": "export const title: string = 1\n",
  })
  // Each package gets the project's TypeScript 7 (it has `tsc --lsp`).
  for (const p of ["api", "web"]) symlinkSync(NODE_MODULES, join(root, "packages", p, "node_modules"))
  resetProjectRoots()
  return root
}

test("a file's project is its nearest package, never above the workspace", async () => {
  const root = await monorepo()
  expect(await projectRoot("typescript", join(root, "packages/api/src/main.ts"), root)).toBe(join(root, "packages/api"))
  expect(await projectRoot("typescript", join(root, "scripts/tool.ts"), root)).toBe(root)
  expect(await projectRoot("typescript", "/elsewhere/x.ts", root)).toBe(root)
  // No markers for this language: the workspace.
  expect(await projectRoot("zig", join(root, "packages/api/src/main.ts"), root)).toBe(root)
})

test("each package gets its own server, run in the package with its own TypeScript", async () => {
  const root = await monorepo()
  const api = await serverFor("typescript", root, {}, join(root, "packages/api/src/main.ts"))
  expect(api?.root).toBe(join(root, "packages/api"))
  expect(api?.command[0]).toBe(join(root, "packages/api/node_modules/.bin/tsc"))

  const buffers = new BufferStore({ root, highlightDelayMs: 0 })
  const lsp = new LspManager(root)
  lsp.attach(buffers)
  const open = async (rel: string) => {
    const buf = await buffers.open(rel)
    buffers.attach(buf.id, new Ta() as unknown as TextareaRenderable)
    return buf
  }
  const a = await open("packages/api/src/main.ts")
  const w = await open("packages/web/src/app.ts")
  await until(() => lsp.diagnostics(a.path).length === 1 && lsp.diagnostics(w.path).length === 1)
  expect(lsp.diagnostics(a.path)[0]!.message).toContain("not assignable to type 'number'")
  expect(lsp.diagnostics(w.path)[0]!.message).toContain("not assignable to type 'string'")
  await until(() => lsp.status().split(" ").length === 2 && !lsp.status().includes("…"))
  expect(lsp.status().split(" ").sort()).toEqual(["typescript:api", "typescript:web"])
  lsp.stop()
})

test("a language with no server installed says what to install, once", async () => {
  const root = await fixture({ "a.py": "x = 1\n", "b.py": "y = 2\n", "c.zig": "" })
  const buffers = new BufferStore({ root, highlightDelayMs: 0 })
  const told: string[] = []
  const lsp = new LspManager(root, {}, () => null)
  lsp.onMissing = (ft, hint) => told.push(`${ft}: ${hint}`)
  lsp.attach(buffers)
  await buffers.open("a.py")
  await buffers.open("b.py")
  await buffers.open("c.zig")
  // Every lookup done (b.py's too), not just the first.
  await until(() => told.length >= 1 && (lsp as unknown as { opening: Set<string> }).opening.size === 0, 2000)
  expect(told).toEqual([`python: ${installHint("python")}`])
  lsp.stop()
})
