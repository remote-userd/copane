import { afterEach, expect, test } from "bun:test"
import { getTreeSitterClient } from "@opentui/core"
import { computeHighlights, configureHighlighterRecycling, highlighterIdleSoon } from "../../src/editor/highlighter"
import { waitUntil } from "../helpers"

afterEach(() => configureHighlighterRecycling({ idleMs: 60_000, canStop: () => true }))

test("an idle parser worker is stopped, and the next highlight starts a fresh one", async () => {
  configureHighlighterRecycling({ idleMs: 100 })
  expect(await computeHighlights("const a = 1\n", "typescript")).not.toBeNull()
  const first = getTreeSitterClient()
  await waitUntil(() => getTreeSitterClient() !== first, 3000)
  // Highlighting still works on the new worker.
  const again = await computeHighlights("let b = 'x'\n", "typescript")
  expect(again?.length).toBeGreaterThan(0)
})

test("not while something holds on to it (a Markdown preview); going to the background stops it sooner", async () => {
  let previewOpen = true
  configureHighlighterRecycling({ idleMs: 100, canStop: () => !previewOpen })
  await computeHighlights("const a = 1\n", "typescript")
  const client = getTreeSitterClient()
  await Bun.sleep(400)
  expect(getTreeSitterClient()).toBe(client)
  previewOpen = false
  configureHighlighterRecycling({ idleMs: 60_000 })
  highlighterIdleSoon(50)
  await waitUntil(() => getTreeSitterClient() !== client, 3000)
})
