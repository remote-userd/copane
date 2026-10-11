import { applyPatch, structuredPatch } from "diff"

/**
 * Three-way merge: apply the change base→theirs on top of mine. Null when both sides changed
 * the same lines (the patch's context no longer matches).
 */
export function mergeTexts(base: string, mine: string, theirs: string): string | null {
  if (mine === base || mine === theirs) return theirs
  if (theirs === base) return mine
  const patch = structuredPatch("f", "f", base, theirs, "", "", { context: 1 })
  const merged = applyPatch(mine, patch, { fuzzFactor: 0 })
  return merged === false ? null : merged
}
