import { expect, test } from "bun:test"
import { join } from "node:path"
import type { TextareaRenderable } from "@opentui/core"
import { BufferStore } from "../../src/editor/BufferStore"
import { LspManager, hoverText } from "../../src/lsp/LspManager"
import { fixture, waitUntil } from "../helpers"

const TSC = join(import.meta.dir, "../../node_modules/.bin/tsc")
const spec = { key: "ts", command: [TSC, "--lsp", "--stdio"], languages: { typescript: "typescript" } }

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

const until = (cond: () => boolean | Promise<boolean>, ms = 15_000) => waitUntil(cond, ms)

test("TypeScript 7 server: diagnostics follow edits; completion, hover, definition", async () => {
  const root = await fixture({ "a.ts": "export const n: number = 'x'\nn.toFix\n" })
  const buffers = new BufferStore({ root, highlightDelayMs: 0 })
  const lsp = new LspManager(root, {}, (ft) => (ft === "typescript" ? spec : null))
  lsp.attach(buffers)
  const buf = await buffers.open("a.ts")
  const ta = new Ta()
  buffers.attach(buf.id, ta as unknown as TextareaRenderable)
  await until(() => lsp.diagnostics(buf.path).length === 2)
  const msgs = lsp.diagnostics(buf.path).map((d) => d.message)
  expect(msgs.some((m) => m.includes("not assignable to type 'number'"))).toBe(true)
  expect(lsp.counts()).toEqual({ errors: 2, warnings: 0 })

  // Fix the first error by editing; diagnostics follow.
  ta.plainText = "export const n: number = 1\nn.toFix\n"
  buffers.onContentChange(buf.id)
  await until(() => lsp.diagnostics(buf.path).length === 1)
  expect(lsp.diagnostics(buf.path)[0]!.message).toContain("toFixed")

  // A typed character, then completion: the server gets the new text once.
  const rpc = (lsp as unknown as { docs: Map<string, { client: { rpc: { notify: (m: string, p: unknown) => void } } }> }).docs.get(buf.path)!.client.rpc
  const sent: string[] = []
  const notify = rpc.notify.bind(rpc)
  rpc.notify = (m, p) => (sent.push(m), notify(m, p))
  ta.plainText = "export const n: number = 1\nn.toFixe\n"
  buffers.onContentChange(buf.id)
  const items = await lsp.completion(buf.path, { line: 1, character: 8 })
  expect(sent.filter((m) => m === "textDocument/didChange")).toHaveLength(1)
  rpc.notify = notify
  expect(items.map((i) => i.label)).toContain("toFixed")
  expect(await lsp.hover(buf.path, { line: 0, character: 13 })).toContain("const n: number")
  const def = await lsp.definition(buf.path, { line: 1, character: 0 })
  expect(def?.path).toBe(buf.path)
  expect(def?.range.start).toEqual({ line: 0, character: 13 })

  // Closing the buffer drops its diagnostics.
  buffers.close(buf.id)
  await until(() => lsp.diagnostics(buf.path).length === 0, 2000)
  expect(lsp.counts()).toEqual({ errors: 0, warnings: 0 })
  lsp.stop()
}, 30_000)

test("hoverText flattens markup and fences", () => {
  expect(hoverText({ kind: "markdown", value: "```ts\nconst a: number\n```\nDocs" })).toBe("const a: number\nDocs")
  expect(hoverText(["x", { language: "ts", value: "y" }])).toBe("x\n\ny")
  expect(hoverText("")).toBeNull()
})

test("a missing server command fails quietly", async () => {
  const root = await fixture({ "a.ts": "x" })
  const buffers = new BufferStore({ root, highlightDelayMs: 0 })
  const lsp = new LspManager(root, {}, () => ({ key: "nope", command: ["definitely-not-a-real-lsp"], languages: { typescript: "typescript" } }))
  lsp.attach(buffers)
  await buffers.open("a.ts")
  await until(() => lsp.status().includes("✗"), 3000)
  expect(lsp.status()).toBe("nope ✗")
  expect(await lsp.hover(join(root, "a.ts"), { line: 0, character: 0 })).toBeNull()
  lsp.stop()
})

test("TypeScript 7 server: quick fix adds a missing import; organize imports drops unused ones", async () => {
  const root = await fixture({
    "a.ts": "export function foo() {\n  return 1\n}\nexport const bar = 2\n",
    "b.ts": "foo()\n",
    "c.ts": 'import { bar, foo } from "./a"\nfoo()\n',
  })
  const buffers = new BufferStore({ root, highlightDelayMs: 0 })
  const lsp = new LspManager(root, {}, (ft) => (ft === "typescript" ? spec : null))
  lsp.attach(buffers)
  await buffers.open("a.ts")
  const b = await buffers.open("b.ts")
  const tb = new Ta()
  buffers.attach(b.id, tb as unknown as TextareaRenderable)
  await until(() => lsp.diagnostics(b.path).length > 0)

  const at = { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } }
  const actions = await lsp.codeActions(b.path, at)
  const fix = actions.find((a) => /import/i.test(a.title))
  expect(fix).toBeDefined()
  const resolved = await lsp.resolveCodeAction(b.path, fix!)
  const files = lsp.editFiles(resolved.edit!)
  const { applyTextEdits } = await import("../../src/lsp/edits")
  expect(applyTextEdits("foo()\n", files.get(b.path)!)).toMatch(/^import { foo } from "\.\/a";?\n\nfoo\(\)\n$/)

  const c = await buffers.open("c.ts")
  buffers.attach(c.id, new Ta() as unknown as TextareaRenderable)
  await until(() => lsp.hasServer(c.path))
  const zero = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
  const [organize] = await lsp.codeActions(c.path, zero, ["source.organizeImports"])
  expect(organize?.kind).toStartWith("source.organizeImports")
  const done = await lsp.resolveCodeAction(c.path, organize!)
  const text = applyTextEdits(await Bun.file(c.path).text(), lsp.editFiles(done.edit!).get(c.path)!)
  expect(text).toMatch(/^import \{ foo \} from "\.\/a";?\nfoo\(\)\n$/)
  lsp.stop()
}, 30_000)

test("a server stops once its last file has been closed a while, and starts again on the next", async () => {
  const root = await fixture({ "a.ts": "export const a = 1\n", "b.ts": "export const b = 2\n" })
  const buffers = new BufferStore({ root, highlightDelayMs: 0 })
  const lsp = new LspManager(root, {}, (ft) => (ft === "typescript" ? spec : null))
  lsp.idleStopMs = 200
  lsp.attach(buffers)
  const a = await buffers.open("a.ts")
  await until(() => lsp.status() === "ts")
  const b = await buffers.open("b.ts")
  buffers.close(a.id)
  await Bun.sleep(400)
  expect(lsp.status()).toBe("ts") // b.ts still open
  buffers.close(b.id)
  await buffers.open("a.ts") // reopened in time (right away, so a slow machine can't miss it): the same server carries on
  await Bun.sleep(400)
  expect(lsp.status()).toBe("ts")
  buffers.close(buffers.active!.id)
  await until(() => lsp.status() === "", 2000)
  expect(lsp.status()).toBe("")
  await buffers.open("b.ts")
  await until(() => lsp.status() === "ts")
  expect(lsp.status()).toBe("ts")
  lsp.stop()
}, 30_000)

test("a language server that dies is started again; one that keeps dying is left stopped", async () => {
  const root = await fixture({ "a.ts": "x\n" })
  const starts = join(root, "starts.log")
  // A "server" that counts its starts and dies at once.
  const crashing = { key: "crashy", command: ["sh", "-c", `echo start >> ${starts}; exit 1`], languages: { typescript: "typescript" } }
  const buffers = new BufferStore({ root })
  const lsp = new LspManager(root, {}, () => crashing)
  lsp.attach(buffers)
  const buf = await buffers.open("a.ts")
  buffers.attach(buf.id, new Ta() as unknown as TextareaRenderable)
  const count = async () => ((await Bun.file(starts).text().catch(() => "")).match(/start/g) ?? []).length
  for (let i = 0; i < 100 && (await count()) < 3; i++) await Bun.sleep(50)
  await Bun.sleep(300)
  expect(await count()).toBe(3) // restarted twice, then given up
  expect(lsp.status()).toBe("crashy ✗")
  expect(lsp.hasServer(buf.path)).toBe(false)
  // Another file of the language doesn't start it again either.
  await Bun.write(join(root, "b.ts"), "y\n")
  await buffers.open("b.ts")
  await Bun.sleep(300)
  expect(await count()).toBe(3)
  lsp.stop()
}, 15_000)

test("a slow answer to an older diagnostics request doesn't overwrite a newer one", async () => {
  const root = await fixture({ "a.ts": "export const n: number = 'x'\n" })
  const buffers = new BufferStore({ root, highlightDelayMs: 0 })
  const lsp = new LspManager(root, {}, (ft) => (ft === "typescript" ? spec : null))
  lsp.attach(buffers)
  const buf = await buffers.open("a.ts")
  const ta = new Ta()
  buffers.attach(buf.id, ta as unknown as TextareaRenderable)
  await until(() => lsp.diagnostics(buf.path).length === 1)

  // The next request is answered late, with what was true before the fix.
  type Request = (m: string, p: unknown) => Promise<unknown>
  const rpc = (lsp as unknown as { docs: Map<string, { client: { rpc: { request: Request } } }> }).docs.get(buf.path)!.client.rpc
  const request = rpc.request.bind(rpc)
  const stale = Promise.withResolvers<void>()
  let late: Promise<unknown> | null = null
  rpc.request = (m, p) => {
    if (m !== "textDocument/diagnostic" || late) return request(m, p)
    late = stale.promise.then(() => ({ kind: "full", items: [{ message: "stale", severity: 1, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }] }))
    return late
  }
  ta.plainText = "export const n: number = 1\n"
  buffers.onContentChange(buf.id)
  await until(() => late !== null) // the first request is out
  ta.plainText = "export const n: number = 2\n"
  buffers.onContentChange(buf.id)
  await until(() => lsp.diagnostics(buf.path).length === 0)
  stale.resolve()
  await late
  await Promise.resolve() // the manager's handler of the late answer has run
  expect(lsp.diagnostics(buf.path)).toEqual([])
  rpc.request = request
  lsp.stop()
})
