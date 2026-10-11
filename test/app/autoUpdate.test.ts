import { expect, test } from "bun:test"
import { join } from "node:path"
import { checkForUpdate, type UpdateDeps } from "../../src/app/autoUpdate"
import { fixture } from "../helpers"

const DAY = 24 * 60 * 60 * 1000

async function setup(latest: string, install: (tag: string) => Promise<void> = async () => {}) {
  const statePath = join(await fixture({}), "state", "update.json")
  const installed: string[] = []
  let now = 1_000_000_000_000
  const deps: UpdateDeps = {
    current: "0.7.0",
    latest: async () => latest,
    install: async (tag) => {
      await install(tag)
      installed.push(tag)
    },
    now: () => now,
    statePath,
  }
  return { deps, installed, statePath, later: (ms: number) => (now += ms) }
}

test("auto: a newer release is installed in the background, at most once a day", async () => {
  const { deps, installed, later } = await setup("v0.8.0")
  const seen: string[] = []
  expect(await checkForUpdate("auto", deps, { installed: (t) => seen.push(t) })).toBe("installed")
  expect(installed).toEqual(["v0.8.0"])
  expect(seen).toEqual(["v0.8.0"])
  later(DAY / 2)
  expect(await checkForUpdate("auto", deps)).toBe("skipped") // another editor, or later today
  later(DAY)
  expect(await checkForUpdate("auto", { ...deps, current: "0.8.0" })).toBe("current")
})

test("notify only says a release is out; off never asks GitHub", async () => {
  const { deps, installed } = await setup("v0.8.0")
  const available: string[] = []
  expect(await checkForUpdate("notify", deps, { available: (t) => available.push(t) })).toBe("available")
  expect(available).toEqual(["v0.8.0"])
  expect(installed).toEqual([])
  let asked = false
  expect(await checkForUpdate("off", { ...deps, latest: async () => ((asked = true), "v9.0.0") })).toBe("skipped")
  expect(asked).toBe(false)
})

test("a failed install falls back to notifying, with the reason", async () => {
  const { deps } = await setup("v0.8.0", async () => {
    throw new Error("no permission to write /usr/local/bin/copane; try again with sudo")
  })
  let reason = ""
  expect(await checkForUpdate("auto", deps, { available: (_t, why) => (reason = why ?? "") })).toBe("failed")
  expect(reason).toContain("no permission")
})

test("offline: nothing is recorded, so the next start checks again", async () => {
  const { deps, statePath } = await setup("v0.8.0")
  expect(await checkForUpdate("auto", { ...deps, latest: async () => Promise.reject(new Error("ENOTFOUND")) })).toBe("offline")
  expect(await Bun.file(statePath).exists()).toBe(false)
  expect(await checkForUpdate("auto", deps)).toBe("installed")
})
