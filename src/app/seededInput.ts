import type { InputRenderable, KeyEvent } from "@opentui/core"

/**
 * Search fields seeded with a word (Ctrl+F, Ctrl+Alt+F) behave as in VS Code: the text is
 * selected, and the first key typed replaces it. The selection is only shown (the renderer
 * holds one selection, which jumping to a match takes), so callers keep a `fresh` flag and
 * hand the first key to `replaceSeed`.
 */

/** Select all of the field once it has rendered. Returns the cleanup for an effect. */
export function selectAllSoon(input: { current: InputRenderable | null }): () => void {
  const t = setTimeout(() => {
    const el = input.current
    if (el && !el.isDestroyed && el.plainText) el.selectAll()
  }, 0)
  return () => clearTimeout(t)
}

/**
 * The first key after seeding: typing or deleting clears the seeded text (`clear` resets the
 * query). Returns true when the key was a delete and is used up.
 */
export function replaceSeed(key: KeyEvent, input: InputRenderable | null, clear: () => void): boolean {
  const deleting = key.name === "backspace" || key.name === "delete"
  const typing = !key.ctrl && !key.meta && (deleting || (key.sequence?.length === 1 && key.sequence >= " "))
  if (!input || !typing) return false
  input.value = ""
  clear()
  if (!deleting) return false
  key.preventDefault()
  key.stopPropagation()
  return true
}
