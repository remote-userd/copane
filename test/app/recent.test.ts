import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { forgetRecent, loadRecent, MAX_RECENT, recordRecent, tildify } from "../../src/app/recent"
import { pathArg } from "../../src/app/args"

const tmp = () => mkdtempSync(join(tmpdir(), "cea-recent-"))

test("recording moves a folder to the top, once, and the list stays at MAX_RECENT", async () => {
  const dir = tmp()
  const file = join(dir, "state/recent.json")
  const folders = Array.from({ length: MAX_RECENT + 3 }, (_, i) => {
    const p = join(dir, `p${i}`)
    mkdirSync(p)
    return p
  })
  for (const [i, p] of folders.entries()) await recordRecent(p, file, i)
  await recordRecent(folders[5]!, file, 1000)
  const list = await loadRecent(file)
  expect(list).toHaveLength(MAX_RECENT)
  expect(list[0]!.path).toBe(folders[5]!)
  expect(list.filter((r) => r.path === folders[5]).length).toBe(1)
  expect(list[1]!.path).toBe(folders.at(-1)!)
  await forgetRecent(folders[5]!, file)
  expect((await loadRecent(file)).some((r) => r.path === folders[5])).toBe(false)
})

test("folders that are gone are left out; a broken file is an empty list", async () => {
  const dir = tmp()
  const file = join(dir, "recent.json")
  const keep = join(dir, "keep")
  const gone = join(dir, "gone")
  mkdirSync(keep)
  mkdirSync(gone)
  await recordRecent(keep, file)
  await recordRecent(gone, file)
  rmSync(gone, { recursive: true })
  expect((await loadRecent(file)).map((r) => r.path)).toEqual([keep])
  writeFileSync(file, "{not json")
  expect(await loadRecent(file)).toEqual([])
  expect(await loadRecent(join(dir, "missing.json"))).toEqual([])
})

test("tildify shortens paths under home", () => {
  expect(tildify("/home/u/code/app", "/home/u")).toBe("~/code/app")
  expect(tildify("/home/u", "/home/u")).toBe("~")
  expect(tildify("/home/uv/x", "/home/u")).toBe("/home/uv/x")
})

test("no path argument means the welcome page; . is the current folder; a file opens in it", async () => {
  const dir = tmp()
  writeFileSync(join(dir, "a.ts"), "")
  expect(await pathArg([], dir)).toEqual({ root: null, file: null })
  expect(await pathArg(["."], dir)).toEqual({ root: dir, file: null })
  expect(await pathArg(["a.ts"], dir)).toEqual({ root: dir, file: join(dir, "a.ts") })
  expect(await pathArg(["new.ts"], dir)).toEqual({ root: dir, file: join(dir, "new.ts") })
})
