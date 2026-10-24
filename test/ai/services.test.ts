import { expect, test } from "bun:test"
import { join } from "node:path"
import { detectServices, lastError, OutputLines, servicesFor } from "../../src/ai/services"
import { fixture } from "../helpers"

test("detects docker compose and each package's dev script, with its package manager", async () => {
  const root = await fixture({
    "docker-compose.yml": "services: {}\n",
    "packages/api/package.json": JSON.stringify({ scripts: { build: "x", "start:dev": "nest start --watch" } }),
    "packages/web/package.json": JSON.stringify({ scripts: { dev: "nuxt dev" } }),
    "packages/web/pnpm-lock.yaml": "",
    "packages/portal/package.json": JSON.stringify({ scripts: { serve: "node server.js" } }),
    "packages/lib/package.json": JSON.stringify({ scripts: { test: "jest" } }),
    "packages/web/node_modules/x/package.json": JSON.stringify({ scripts: { dev: "no" } }),
  })
  const s = await detectServices(root)
  expect(s.map((x) => [x.name, x.command, x.cwd])).toEqual([
    ["docker", "docker compose up", root],
    ["api", "npm run start:dev", join(root, "packages/api")],
    ["portal", "npm run serve", join(root, "packages/portal")],
    ["web", "pnpm run dev", join(root, "packages/web")],
  ])
})

test("the root package's own dev script, with bun; configured services win over detection", async () => {
  const root = await fixture({ "package.json": JSON.stringify({ scripts: { dev: "bun --watch x.ts" } }), "bun.lock": "" })
  expect((await detectServices(root)).map((s) => s.command)).toEqual(["bun run dev"])
  const configured = await servicesFor(root, [{ name: "api", command: "make run", cwd: "server" }])
  expect(configured).toEqual([{ name: "api", command: "make run", cwd: join(root, "server") }])
})

const NEST_TS = `[2:01:02 PM] File change detected. Starting incremental compilation...

src/app.service.ts:12:5 - error TS2322: Type 'string' is not assignable to type 'number'.

12     return 'x'
       ~~~~~~

[2:01:03 PM] Found 1 error. Watching for file changes.`

test("a TypeScript watch error: the first error after the rebuild started, pointing at the file", () => {
  const e = lastError(NEST_TS.split("\n"), "/p/api")!
  expect(e.text.split("\n")[0]).toBe("src/app.service.ts:12:5 - error TS2322: Type 'string' is not assignable to type 'number'.")
  expect(e.location).toEqual({ path: "/p/api/src/app.service.ts", line: 12, col: 5 })
  // Fixed: the next round reports no errors.
  const fixed = [
    ...NEST_TS.split("\n"),
    "[2:01:09 PM] File change detected. Starting incremental compilation...",
    "[2:01:10 PM] Found 0 errors. Watching for file changes.",
  ]
  expect(lastError(fixed, "/p/api")).toBeNull()
})

test("a Node crash: the stack's first project frame, not node_modules or node internals", () => {
  const out = `Server listening on :3000
/p/api/src/routes/users.js:8
    throw new Error("boom")
    ^

Error: boom
    at handler (/p/api/node_modules/express/lib/router.js:1:1)
    at getUsers (/p/api/src/routes/users.js:8:11)
    at node:internal/main:1:1

Node.js v24.1.0`
  const e = lastError(out.split("\n"), "/p/api")!
  expect(e.text).toContain("Error: boom")
  expect(e.location).toEqual({ path: "/p/api/src/routes/users.js", line: 8, col: 11 })
})

test("a Nuxt/Vite error, then a reload clears it; plain logs are no error", () => {
  const out = [
    ' ERROR  Pre-transform error: Failed to resolve import "~/x" from "pages/index.vue". Does the file exist?',
    "  Plugin: vite:import-analysis",
    "  File: /p/web/pages/index.vue:3:21",
  ]
  expect(lastError(out, "/p/web")!.location).toEqual({ path: "/p/web/pages/index.vue", line: 3, col: 21 })
  expect(lastError([...out, "✔ Vite server hmr update /pages/index.vue"], "/p/web")).toBeNull()
  expect(
    lastError(["[Nest] 1  - LOG [NestApplication] Nest application successfully started", "GET /users 200"], "/p"),
  ).toBeNull()
})

test("output lines: colours and cursor codes stripped, carriage returns overwrite, capped", () => {
  const o = new OutputLines(3)
  const enc = new TextEncoder()
  o.push(enc.encode("\x1b[31mred\x1b[0m line\r\nprogress 10%\rprogress 100%\n"))
  o.push(enc.encode("par"))
  o.push(enc.encode("tial\nmore\n"))
  expect(o.lines()).toEqual(["progress 100%", "partial", "more"])
})
