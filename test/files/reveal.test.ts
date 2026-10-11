import { expect, test } from "bun:test"
import { revealCommand, revealLabel } from "../../src/files/reveal"

test("each system gets VS Code's wording", () => {
  expect(revealLabel("wsl")).toBe("Reveal in File Explorer")
  expect(revealLabel("mac")).toBe("Reveal in Finder")
  expect(revealLabel("linux")).toBe("Open Containing Folder")
})

test("WSL selects the item in Windows Explorer, using its Windows path", () => {
  expect(revealCommand("/home/u/p/a.ts", false, "wsl", { winPath: "\\\\wsl.localhost\\Ubuntu\\home\\u\\p\\a.ts" })).toEqual([
    "explorer.exe",
    "/select,\\\\wsl.localhost\\Ubuntu\\home\\u\\p\\a.ts",
  ])
})

test("macOS selects it in Finder", () => {
  expect(revealCommand("/Users/u/p/a b.ts", false, "mac")).toEqual(["open", "-R", "/Users/u/p/a b.ts"])
})

test("Linux asks the file manager over D-Bus, else opens the folder", () => {
  const dbus = revealCommand("/home/u/p/a b.ts", false, "linux", { hasDbus: true })
  expect(dbus[0]).toBe("dbus-send")
  expect(dbus).toContain("org.freedesktop.FileManager1.ShowItems")
  expect(dbus).toContain("array:string:file:///home/u/p/a%20b.ts")
  expect(revealCommand("/home/u/p/a.ts", false, "linux")).toEqual(["xdg-open", "/home/u/p"])
  expect(revealCommand("/home/u/p/src", true, "linux")).toEqual(["xdg-open", "/home/u/p/src"])
})
