import { SyntaxStyle, type NativeResourceOwner, type StyleDefinitionInput } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { syntaxTheme } from "../config/theme"

/**
 * The syntax colours, shared by every editor, preview and code block. Native resources belong to
 * a renderer (OpenTUI 0.6), so the style is made for the current renderer: there is one in the
 * app, and a fresh one per test.
 */
let owner: NativeResourceOwner | null = null
let style: SyntaxStyle | null = null
/** Ids of styles registered on top of the theme (search matches, diagnostics…), for this style. */
const ids = new Map<string, number>()
/** Background-only styles (word and find matches…), by id: drawn over syntax colours, not instead of them. */
const overlays = new Map<number, StyleDefinitionInput>()
/** Theme style names by id, to look up a syntax colour's definition. */
let names: Map<number, string> | null = null

/** The renderer whose native scene owns the style. A new renderer starts a new style. */
export function setStyleOwner(next: NativeResourceOwner): void {
  if (next === owner) return
  owner = next
  style = null
  ids.clear()
  overlays.clear()
  names = null
}

export function getSyntaxStyle(): SyntaxStyle {
  if (!owner || owner.resourceContext.disposed) throw new Error("The syntax style was used without a live renderer")
  style ??= SyntaxStyle.fromStyles(syntaxTheme, owner)
  return style
}

/** The style when its renderer is alive, else null (a highlight finishing after a renderer is gone). */
export function liveSyntaxStyle(): SyntaxStyle | null {
  return owner && !owner.resourceContext.disposed ? getSyntaxStyle() : null
}

/** The syntax style, for a component: made for the renderer it is drawn by. */
export function useSyntaxStyle(): SyntaxStyle {
  setStyleOwner(useRenderer().nativeScene)
  return getSyntaxStyle()
}

/**
 * The id of an extra style (registered once per syntax style). An `overlay` (a background, like
 * the word under the cursor or a find match) keeps the syntax colour of the text it covers: the
 * native buffer shows one highlight per cell, so the editor draws it with `combinedStyle`.
 */
export function extraStyle(name: string, def: StyleDefinitionInput, opts: { overlay?: boolean } = {}): number {
  let id = ids.get(name)
  if (id === undefined) {
    id = getSyntaxStyle().registerStyle(name, def)
    ids.set(name, id)
    if (opts.overlay) overlays.set(id, def)
  }
  return id
}

/** Whether a style is an overlay (see extraStyle). */
export function isOverlay(styleId: number): boolean {
  return overlays.has(styleId)
}

/** An overlay drawn over a syntax colour: the colour (and italics…) of one, the background of the other. */
export function combinedStyle(overlayId: number, syntaxId: number): number {
  const overlay = overlays.get(overlayId)
  if (!overlay) return overlayId
  const style = getSyntaxStyle()
  if (!names) {
    names = new Map()
    for (const name of style.getRegisteredNames()) {
      const id = style.getStyleId(name)
      if (id !== null) names.set(id, name)
    }
  }
  const base = names.get(syntaxId)
  const def = base ? style.getStyle(base) : undefined
  if (!def) return overlayId
  return extraStyle(`${overlayId}@${syntaxId}`, { ...def, ...overlay })
}
