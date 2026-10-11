import { expect, test } from "bun:test"
import { join } from "node:path"
import { importVSCodeSettings, mapVSCodeSettings } from "../../src/config/vscode"
import { configSchema } from "../../src/config/schema"
import { fixture } from "../helpers"

test("VS Code settings map to their equivalents; unrelated ones are ignored", () => {
  expect(
    mapVSCodeSettings({
      "editor.wordWrap": "on",
      "editor.formatOnSave": true,
      "editor.autoClosingBrackets": "never",
      "editor.quickSuggestions": false,
      "editor.fontSize": 15,
      "editor.defaultFormatter": "esbenp.prettier-vscode",
    }),
  ).toEqual({ wordWrap: true, formatOnSave: true, autoClosingBrackets: false, autocomplete: false })
  expect(mapVSCodeSettings({ "editor.wordWrap": "off" })).toEqual({ wordWrap: false })
})

test("import reads VS Code's JSON with comments and merges into the config, keeping other keys", async () => {
  const dir = await fixture({
    "settings.json": '{\n  // mine\n  "editor.wordWrap": "on",\n  "editor.formatOnSave": true, /* trailing comma */\n}\n',
    "config.json": '{ "tree": { "icons": "nerd" }, "editor": { "copyOnSelect": true } }',
  })
  const result = await importVSCodeSettings(join(dir, "config.json"), join(dir, "settings.json"))
  expect(result?.imported).toEqual({ wordWrap: true, formatOnSave: true })
  const saved = await Bun.file(join(dir, "config.json")).json()
  expect(saved).toEqual({ tree: { icons: "nerd" }, editor: { copyOnSelect: true, wordWrap: true, formatOnSave: true } })
  expect(configSchema.safeParse(saved).success).toBe(true)
})

test("import works when the existing config has comments", async () => {
  const dir = await fixture({
    "settings.json": '{ "editor.wordWrap": "on" }',
    "config.json": '{\n  // mine\n  "tree": { "icons": "nerd" },\n}\n',
  })
  const result = await importVSCodeSettings(join(dir, "config.json"), join(dir, "settings.json"))
  expect(result?.imported).toEqual({ wordWrap: true })
  expect(await Bun.file(join(dir, "config.json")).json()).toEqual({ tree: { icons: "nerd" }, editor: { wordWrap: true } })
})
