import { homedir } from "node:os"
import { join } from "node:path"
import { configSchema, type Config } from "./schema"

export function configPath(): string {
  const base = Bun.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(base, "copane", "config.json")
}

/** The path with the home folder shown as ~, short enough for the status bar. */
function shortPath(path: string): string {
  const home = homedir()
  return path.startsWith(home + "/") ? "~" + path.slice(home.length) : path
}

/** Loads the user config (JSON with comments and trailing commas, like VS Code's). Problems are returned as warnings and defaults are used. */
export async function loadConfig(path = configPath()): Promise<{ config: Config; warning: string | null }> {
  let raw: unknown = {}
  const file = Bun.file(path)
  if (await file.exists()) {
    try {
      raw = Bun.JSONC.parse(await file.text())
    } catch (err) {
      return { config: configSchema.parse({}), warning: `Config ignored: ${(err as Error).message} (${shortPath(path)})` }
    }
  }
  const parsed = configSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      config: configSchema.parse({}),
      warning: `Config ignored: ${issue?.path.join(".") || "root"}: ${issue?.message ?? "invalid"} (${shortPath(path)})`,
    }
  }
  return { config: parsed.data, warning: null }
}
