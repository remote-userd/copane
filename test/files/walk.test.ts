import { expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IgnoreMatcher } from "../../src/files/ignore"
import { listDir, walkFiles } from "../../src/files/walk"
import { fixture as files } from "../helpers"

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cedit-walk-"))
  const files: Record<string, string> = {
    ".gitignore": "dist/\n*.log\n",
    "src/a.ts": "",
    "src/b.log": "",
    "src/sub/.gitignore": "secret.txt\n",
    "src/sub/secret.txt": "",
    "src/sub/ok.txt": "",
    "dist/out.js": "",
    "node_modules/x/index.js": "",
    ".git/HEAD": "",
    "README.md": "",
  }
  for (const [p, c] of Object.entries(files)) {
    await mkdir(join(root, p, ".."), { recursive: true })
    await writeFile(join(root, p), c)
  }
  return root
}

test("walkFiles honours root and nested .gitignore plus hard excludes", async () => {
  const root = await fixture()
  const { files } = await walkFiles(root, new IgnoreMatcher(root))
  expect(files.sort()).toEqual([".gitignore", "README.md", "src/a.ts", "src/sub/.gitignore", "src/sub/ok.txt"])
})

test("listDir sorts folders first and hides ignored entries", async () => {
  const root = await fixture()
  const entries = await listDir(root, new IgnoreMatcher(root))
  expect(entries.map((e) => e.name)).toEqual(["src", ".gitignore", "README.md"])
})

test("listDir with ignored entries flags them, and still leaves out .git and node_modules", async () => {
  const root = await fixture()
  const matcher = new IgnoreMatcher(root)
  const entries = await listDir(root, matcher, true)
  expect(entries.map((e) => [e.name, e.ignored ?? false])).toEqual([
    ["dist", true],
    ["src", false],
    [".gitignore", false],
    ["README.md", false],
  ])
  // Inside an ignored folder everything is ignored; nested .gitignore rules apply too.
  expect((await listDir(join(root, "dist"), matcher, true)).map((e) => [e.name, e.ignored])).toEqual([["out.js", true]])
  const sub = await listDir(join(root, "src", "sub"), matcher, true)
  expect(sub.find((e) => e.name === "secret.txt")?.ignored).toBe(true)
  expect(sub.find((e) => e.name === "ok.txt")?.ignored).toBeUndefined()
})

test("walkFiles stops at the limit", async () => {
  const root = await fixture()
  const r = await walkFiles(root, new IgnoreMatcher(root), 2)
  expect(r.files).toHaveLength(2)
  expect(r.truncated).toBe(true)
})

test("a folder rule hides nested folders of that name, not just their contents", async () => {
  const root = await fixture()
  await mkdir(join(root, "src/dist"), { recursive: true })
  await writeFile(join(root, "src/dist/x.js"), "")
  const m = new IgnoreMatcher(root)
  expect(m.isIgnored(join(root, "src/dist"), true)).toBe(true)
  expect(m.isIgnored(join(root, "src/dist/x.js"), false)).toBe(true)
  expect((await listDir(join(root, "src"), m)).map((e) => e.name)).toEqual(["sub", "a.ts"])
  // "dist/" is for folders: a file named dist stays.
  expect(m.isIgnored(join(root, "src/dist"), false)).toBe(false)
})

test("walkFiles lists breadth-first in a stable order", async () => {
  const root = await fixture()
  for (let i = 0; i < 40; i++) await mkdir(join(root, `d${String(i).padStart(2, "0")}`, "in"), { recursive: true })
  for (let i = 0; i < 40; i++) await writeFile(join(root, `d${String(i).padStart(2, "0")}`, "in", "f.ts"), "")
  const { files } = await walkFiles(root, new IgnoreMatcher(root))
  const deep = files.filter((f) => f.endsWith("/in/f.ts"))
  expect(deep).toEqual(Array.from({ length: 40 }, (_, i) => `d${String(i).padStart(2, "0")}/in/f.ts`))
  expect(files.indexOf("README.md")).toBeLessThan(files.indexOf("src/a.ts"))
})

test("with the home folder as the project, its hidden entries are tools': ignored, not listed, not watched", async () => {
  const home = await files({ ".claude/projects/log.jsonl": "{}", ".claude.json": "{}", ".bashrc": "x", "code/app/a.ts": "a" })
  const m = new IgnoreMatcher(home, home)
  expect(m.toolPath(join(home, ".claude"))).toBe(true)
  expect(m.toolPath(join(home, ".claude/projects/log.jsonl"))).toBe(true)
  expect(m.toolPath(join(home, ".claude.json"))).toBe(true)
  expect(m.toolPath(join(home, "code/app/a.ts"))).toBe(false)
  expect(m.isIgnored(join(home, ".claude"), true)).toBe(true)
  expect(m.isIgnored(join(home, "code"), true)).toBe(false)
  expect((await walkFiles(home, new IgnoreMatcher(home, home))).files).toEqual(["code/app/a.ts"])
  // Any other project keeps its hidden folders.
  const other = new IgnoreMatcher(home, "/somewhere/else")
  expect(other.toolPath(join(home, ".claude"))).toBe(false)
  expect(other.isIgnored(join(home, ".claude"), true)).toBe(false)
})
