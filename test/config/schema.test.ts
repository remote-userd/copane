import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadConfig } from "../../src/config/load"

const write = (json: string) => {
  const p = join(mkdtempSync(join(tmpdir(), "cfg-")), "config.json")
  writeFileSync(p, json)
  return p
}

test("tree.icons defaults to simple, accepts nerd, rejects unknown values with a warning", async () => {
  expect((await loadConfig(write("{}"))).config.tree.icons).toBe("simple")
  expect((await loadConfig(write('{ "tree": { "icons": "nerd" } }'))).config.tree.icons).toBe("nerd")
  const bad = await loadConfig(write('{ "tree": { "icons": "bogus" } }'))
  expect(bad.warning).toContain("tree.icons")
  expect(bad.config.tree.icons).toBe("simple")
})

test("config allows comments and trailing commas; a broken one warns briefly with the reason first", async () => {
  const { config, warning } = await loadConfig(
    write('{\n  // icons need a Nerd Font\n  "tree": { "icons": "nerd", },\n  /* the AI */ "ai": { "command": "codex" },\n}\n'),
  )
  expect(warning).toBeNull()
  expect(config.tree.icons).toBe("nerd")
  expect(config.ai.command).toBe("codex")
  const broken = await loadConfig(write('{ "tree": '))
  expect(broken.warning).toStartWith("Config ignored: ")
  expect(broken.warning).toEndWith("config.json)")
})
