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

/** The renderer whose native scene owns the style. A new renderer starts a new style. */
export function setStyleOwner(next: NativeResourceOwner): void {
  if (next === owner) return
  owner = next
  style = null
  ids.clear()
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

/** The id of an extra style (registered once per syntax style). */
export function extraStyle(name: string, def: StyleDefinitionInput): number {
  let id = ids.get(name)
  if (id === undefined) {
    id = getSyntaxStyle().registerStyle(name, def)
    ids.set(name, id)
  }
  return id
}
