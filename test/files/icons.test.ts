import { expect, test } from "bun:test"
import { join } from "node:path"
import { ICON_KINDS, iconFor } from "../../src/files/icons"
import { hasGlyphs } from "../support/ttf"

const FONT = join(import.meta.dir, "../../assets/fonts/CaskaydiaMonoNerdFont-Regular.ttf")

test("exact file names win over extensions; extensions are case-insensitive", () => {
  expect(iconFor("package.json", false, false, "nerd")!.glyph).toBe(ICON_KINDS.npm!.nerd)
  expect(iconFor("other.json", false, false, "nerd")!.glyph).toBe(ICON_KINDS.json!.nerd)
  expect(iconFor("README.MD", false, false, "nerd")!.glyph).toBe(ICON_KINDS.md!.nerd)
  expect(iconFor("App.tsx", false, false, "simple")).toEqual({ glyph: "◆", color: ICON_KINDS.react!.color })
  expect(iconFor(".env.local", false, false, "nerd")!.glyph).toBe(ICON_KINDS.env!.nerd)
  expect(iconFor("mystery.xyz", false, false, "nerd")!.glyph).toBe(ICON_KINDS.file!.nerd)
})

test("folders: open vs closed, special names; simple style shows no folder icon", () => {
  expect(iconFor("src", true, false, "nerd")!.glyph).toBe(ICON_KINDS.folder!.nerd)
  expect(iconFor("src", true, true, "nerd")!.glyph).toBe(ICON_KINDS.folderOpen!.nerd)
  expect(iconFor("node_modules", true, false, "nerd")!.glyph).toBe(ICON_KINDS.folderNpm!.nerd)
  expect(iconFor("src", true, false, "simple")).toBeNull()
  // Open special folders switch to the open-folder glyph so their state still shows.
  expect(iconFor("node_modules", true, true, "nerd")).toEqual({
    glyph: ICON_KINDS.folderOpen!.nerd,
    color: ICON_KINDS.folderNpm!.color,
  })
  expect(iconFor("a.ts", false, false, "none")).toBeNull()
})

test("every glyph is one cell wide, and every nerd glyph exists in the bundled font", async () => {
  const has = hasGlyphs(new Uint8Array(await Bun.file(FONT).arrayBuffer()))
  for (const [name, k] of Object.entries(ICON_KINDS)) {
    expect([name, Bun.stringWidth(k.nerd)]).toEqual([name, 1])
    if (k.simple) expect([name, Bun.stringWidth(k.simple)]).toEqual([name, 1])
    expect([name, has(k.nerd.codePointAt(0)!)]).toEqual([name, true])
  }
})

test("status-bar Nerd glyphs exist in the bundled font", async () => {
  const { STATUS_GLYPHS } = await import("../../src/app/StatusBar")
  const has = hasGlyphs(new Uint8Array(await Bun.file(FONT).arrayBuffer()))
  for (const [name, g] of Object.entries(STATUS_GLYPHS.nerd)) expect([name, has(g.codePointAt(0)!)]).toEqual([name, true])
})
