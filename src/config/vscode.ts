import { homedir } from "node:os"
import { join } from "node:path"
import type { Config } from "./schema"

/**
 * "Import VS Code settings": copy the VS Code editor settings this editor has an equivalent
 * for into its config file. Only on request, and only those keys.
 */

type EditorConfig = Config["editor"]

/** Where VS Code keeps user settings: Linux, macOS, Windows, and Windows from WSL. */
async function findVSCodeSettings(): Promise<string | null> {
  const home = homedir()
  const candidates = [
    join(home, ".config", "Code", "User", "settings.json"),
    join(home, "Library", "Application Support", "Code", "User", "settings.json"),
    ...(Bun.env.APPDATA ? [join(Bun.env.APPDATA, "Code", "User", "settings.json")] : []),
  ]
  for (const p of candidates) if (await Bun.file(p).exists()) return p
  for (const p of new Bun.Glob("/mnt/c/Users/*/AppData/Roaming/Code/User/settings.json").scanSync({ absolute: true })) return p
  return null
}

/** The VS Code settings with an equivalent here, as editor config values. */
export function mapVSCodeSettings(vs: Record<string, unknown>): Partial<EditorConfig> {
  const out: Partial<EditorConfig> = {}
  const wrap = vs["editor.wordWrap"]
  if (typeof wrap === "string") out.wordWrap = wrap !== "off"
  const bool = (key: string, to: keyof EditorConfig) => {
    if (typeof vs[key] === "boolean") (out as Record<string, unknown>)[to] = vs[key]
  }
  bool("editor.formatOnSave", "formatOnSave")
  bool("editor.parameterHints.enabled", "parameterHints")
  bool("editor.guides.indentation", "indentGuides")
  if (typeof vs["editor.autoClosingBrackets"] === "string") out.autoClosingBrackets = vs["editor.autoClosingBrackets"] !== "never"
  if (typeof vs["editor.autoIndent"] === "string") out.autoIndent = vs["editor.autoIndent"] !== "none"
  if (vs["editor.quickSuggestions"] === false) out.autocomplete = false
  if (vs["editor.renderLineHighlight"] === "none") out.highlightCursor = false
  return out
}

/**
 * Merge the mapped settings into the config file at `configFile` (other keys untouched).
 * Returns what was imported, or null when VS Code settings weren't found.
 */
export async function importVSCodeSettings(
  configFile: string,
  settingsFile?: string | null,
): Promise<{ from: string; imported: Partial<EditorConfig> } | null> {
  const from = settingsFile ?? (await findVSCodeSettings())
  if (!from) return null
  const vs = Bun.JSONC.parse(await Bun.file(from).text()) as Record<string, unknown>
  const imported = mapVSCodeSettings(vs)
  const file = Bun.file(configFile)
  const current = (await file.exists()) ? (Bun.JSONC.parse(await file.text()) as Record<string, unknown>) : {}
  const editor = { ...((current.editor as Record<string, unknown> | undefined) ?? {}), ...imported }
  await Bun.write(configFile, JSON.stringify({ ...current, editor }, null, 2) + "\n")
  return { from, imported }
}
