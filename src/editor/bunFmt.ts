import { join } from "node:path"
import { foldersUp, hasPrettierConfig } from "./prettier"

/**
 * Format with Bun's own formatter (`bun fmt`, Prettier-compatible: it reads Prettier config,
 * .editorconfig and bunfig.toml's [fmt]). The installed `ce` binary is Bun itself and runs it as
 * `bun` with BUN_BE_BUN=1, so neither Bun nor Prettier needs to be installed.
 */

/** bun fmt has no parser for this file type. */
export class NoParser extends Error {}

/** Whether the project says how to format: a Prettier config or bunfig.toml's [fmt], from the file up to the root. */
export async function hasFormatConfig(path: string, root: string): Promise<boolean> {
  for (const dir of foldersUp(path, root)) {
    if (await hasPrettierConfig(dir)) return true
    const bunfig = Bun.file(join(dir, "bunfig.toml"))
    if ((await bunfig.exists()) && /^\s*\[fmt[\].]/m.test(await bunfig.text())) return true
  }
  return false
}

/** Run bun fmt on `text` as if it were `path`. Throws NoParser for file types it doesn't know, else with its message. */
export async function runBunFmt(path: string, text: string, cwd: string): Promise<string> {
  const p = Bun.spawn([process.execPath, "fmt", "--stdin-filepath", path], {
    cwd,
    env: { ...Bun.env, BUN_BE_BUN: "1" },
    stdin: new TextEncoder().encode(text),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20_000,
  })
  const [out, err, code] = await Promise.all([Bun.readableStreamToText(p.stdout), Bun.readableStreamToText(p.stderr), p.exited])
  if (p.signalCode) throw new Error("took too long and was stopped")
  if (code === 0) return out
  if (err.includes("No parser could be inferred")) throw new NoParser()
  // A syntax error comes as the code frame, then "error: …", then "at file:line:col".
  const lines = err
    .trim()
    .split("\n")
    .map((l) => l.trim())
  const message = lines
    .find((l) => l.startsWith("error:"))
    ?.slice(6)
    .trim()
  const at = lines.map((l) => /^at .*:(\d+:\d+)$/.exec(l)?.[1]).find(Boolean)
  throw new Error(message ? `${message}${at ? ` (${at})` : ""}` : `exited with ${code}`)
}
