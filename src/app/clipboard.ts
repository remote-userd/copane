
export interface ClipboardTool {
  name: string
  copy?: string[]
  paste?: string[]
}

export interface Clipboard {
  /** Copy to the system clipboard. Returns how it was delivered. */
  copy(text: string): Promise<"system" | "terminal" | "internal">
  /** Read the system clipboard; falls back to the last text copied in the editor. */
  paste(): Promise<string | null>
  readonly tool: ClipboardTool | null
}

/** WSL sets these for every process it starts. */
export function isWsl(): boolean {
  return !!(Bun.env.WSL_DISTRO_NAME || Bun.env.WSL_INTEROP)
}

/** Pick the best available system clipboard program for this platform. */
export function detectClipboardTool(which: (cmd: string) => string | null = (c) => Bun.which(c)): ClipboardTool | null {
  if (process.platform === "darwin" && which("pbcopy")) return { name: "pbcopy", copy: ["pbcopy"], paste: ["pbpaste"] }
  if (isWsl() && which("powershell.exe")) {
    return {
      name: "powershell",
      // Read stdin as raw bytes and decode UTF-8 ourselves; PowerShell would use the OEM code page.
      copy: [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$m=New-Object IO.MemoryStream; [Console]::OpenStandardInput().CopyTo($m); Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString($m.ToArray()))",
      ],
      paste: ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw"],
    }
  }
  if (Bun.env.WAYLAND_DISPLAY && which("wl-copy")) return { name: "wl-clipboard", copy: ["wl-copy"], paste: ["wl-paste", "-n"] }
  if (which("xclip")) return { name: "xclip", copy: ["xclip", "-selection", "clipboard"], paste: ["xclip", "-o", "-selection", "clipboard"] }
  if (which("xsel")) return { name: "xsel", copy: ["xsel", "-ib"], paste: ["xsel", "-ob"] }
  return null
}

export interface ClipboardDeps {
  /** OSC 52 through the host terminal; returns false when unsupported. */
  osc52?: (text: string) => boolean
  tool?: ClipboardTool | null
  /** Runs a command with stdin, resolves stdout (or null on failure). Injectable for tests. */
  run?: (cmd: string[], stdin?: string) => Promise<string | null>
  timeoutMs?: number
}

async function runCommand(cmd: string[], stdin?: string, timeoutMs = 3000): Promise<string | null> {
  try {
    const proc = Bun.spawn(cmd, { stdin: stdin === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "ignore" })
    if (stdin !== undefined && proc.stdin) {
      proc.stdin.write(stdin)
      await proc.stdin.end()
    }
    const timer = setTimeout(() => proc.kill(), timeoutMs)
    const [out, code] = await Promise.all([Bun.readableStreamToText(proc.stdout), proc.exited])
    clearTimeout(timer)
    return code === 0 ? out : null
  } catch {
    return null
  }
}

export function createClipboard(deps: ClipboardDeps = {}): Clipboard {
  const tool = deps.tool === undefined ? detectClipboardTool() : deps.tool
  const run = deps.run ?? ((cmd, stdin) => runCommand(cmd, stdin, deps.timeoutMs))
  let last: string | null = null

  return {
    tool,
    async copy(text) {
      last = text
      // OSC 52 is instant and works over SSH; the system tool covers terminals without it.
      const viaTerminal = deps.osc52?.(text) ?? false
      if (tool?.copy) {
        // Windows apps expect CRLF line endings.
        const payload = tool.name === "powershell" ? text.replace(/\r?\n/g, "\r\n") : text
        const ok = (await run(tool.copy, payload)) !== null
        if (ok) return "system"
      }
      return viaTerminal ? "terminal" : "internal"
    },
    async paste() {
      if (tool?.paste) {
        const out = await run(tool.paste)
        if (out !== null) {
          // PowerShell adds CRLF line endings and a trailing newline.
          let text = out.replace(/\r\n/g, "\n")
          if (tool.name === "powershell") text = text.replace(/\n$/, "")
          return text
        }
      }
      return last
    },
  }
}
