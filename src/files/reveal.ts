import { dirname } from "node:path"
import { isWsl } from "../app/clipboard"

export type RevealPlatform = "wsl" | "mac" | "linux"

export function revealPlatform(): RevealPlatform {
  return isWsl() ? "wsl" : process.platform === "darwin" ? "mac" : "linux"
}

/** The menu wording VS Code uses on each system. */
export function revealLabel(platform: RevealPlatform = revealPlatform()): string {
  return platform === "wsl" ? "Reveal in File Explorer" : platform === "mac" ? "Reveal in Finder" : "Open Containing Folder"
}

/**
 * The command that shows `path` selected in the system file manager. On WSL `winPath` is the
 * Windows form of the path (from `wslpath -w`); on Linux the file manager is asked over D-Bus to
 * select it, and without D-Bus its folder is opened.
 */
export function revealCommand(
  path: string,
  isDir: boolean,
  platform: RevealPlatform,
  opts: { winPath?: string; hasDbus?: boolean } = {},
): string[] {
  if (platform === "wsl") return ["explorer.exe", `/select,${opts.winPath ?? path}`]
  if (platform === "mac") return ["open", "-R", path]
  if (opts.hasDbus) {
    const uri = Bun.pathToFileURL(path).href
    return [
      "dbus-send",
      "--session",
      "--print-reply",
      "--dest=org.freedesktop.FileManager1",
      "--type=method_call",
      "/org/freedesktop/FileManager1",
      "org.freedesktop.FileManager1.ShowItems",
      `array:string:${uri}`,
      "string:",
    ]
  }
  return ["xdg-open", isDir ? path : dirname(path)]
}

async function run(cmd: string[]): Promise<{ code: number; err: string; out: string }> {
  const p = Bun.spawn(cmd, { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([Bun.readableStreamToText(p.stdout), Bun.readableStreamToText(p.stderr), p.exited])
  return { code, err: err.trim(), out: out.trim() }
}

/** Show `path` in the system file manager. Resolves to an error message, or null on success. */
export async function revealInFileManager(path: string, isDir: boolean): Promise<string | null> {
  const platform = revealPlatform()
  try {
    if (platform === "wsl") {
      const win = await run(["wslpath", "-w", path])
      if (win.code !== 0 || !win.out) return `Can't map ${path} to a Windows path`
      // explorer.exe exits with 1 even when it worked, so its status says nothing.
      await run(revealCommand(path, isDir, platform, { winPath: win.out }))
      return null
    }
    if (platform === "linux" && Bun.which("dbus-send")) {
      const r = await run(revealCommand(path, isDir, platform, { hasDbus: true }))
      if (r.code === 0) return null
      // No file manager on the bus: open the folder instead.
    }
    const cmd = revealCommand(path, isDir, platform)
    if (!Bun.which(cmd[0]!)) return `${cmd[0]} not found`
    const r = await run(cmd)
    return r.code === 0 ? null : r.err || `${cmd[0]} failed`
  } catch (err) {
    return (err as Error).message
  }
}
