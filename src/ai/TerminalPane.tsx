import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useKeyboard, useRenderer } from "@opentui/react"
import { EmbeddedTerminalRenderable, type BoxRenderable } from "@opentui/core"
import { useUi, useWorkspace } from "../app/workspace"
import { onShutdown } from "../app/shutdown"
import { Store } from "../app/store"
import { ui as colors } from "../config/theme"
import { PaneHeader } from "../app/PaneHeader"
import { AgentProcess, type AgentStatus } from "./AgentProcess"
import { AgentWatch, desktopNotify, ringBell, type Attention } from "./alerts"

export interface AiConfig {
  command: string
  args: string[]
  maxScrollbackBytes: number
  notify?: "bell" | "desktop" | "off"
}

const RIGHT = 2
const DIM = "\x1b[2m"
const YELLOW = "\x1b[33m"
const RESET = "\x1b[0m"

function describeStatus(cmd: string, s: AgentStatus): string {
  switch (s.kind) {
    case "idle":
      return `${cmd}: starting`
    case "running":
      return `${cmd} ●`
    case "exited":
      return `${cmd}: exited`
    case "error":
      return `${cmd}: error`
  }
}

/** Store the status bar reads. */
const aiStatusStore = new Store<{ text: string }>({ text: "" })
/** When the CLI last printed something; "working" while that was recent. */
const activity = { last: 0, wake: null as (() => void) | null }
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

function AiHeader({ command, focused, attention }: { command: string; focused: boolean; attention: Attention | null }) {
  const status = useSyncExternalStore(aiStatusStore.subscribe, () => aiStatusStore.get().text)
  const [frame, setFrame] = useState(0)
  // Tick only while output is flowing; idle panes cost nothing.
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (t) return
      t = setInterval(() => {
        setFrame((f) => f + 1)
        if (Date.now() - activity.last >= 800 && t) {
          clearInterval(t)
          t = null
        }
      }, 120)
    }
    activity.wake = start
    return () => {
      activity.wake = null
      if (t) clearInterval(t)
    }
  }, [])
  const busy = Date.now() - activity.last < 800
  return (
    <PaneHeader title={command.split("/").pop()!.toUpperCase()} focused={focused}>
      <text selectable={false} fg={busy || attention === "waiting" ? colors.warn : attention ? colors.ok : colors.headerFg}>
        {busy
          ? `${SPINNER[frame % SPINNER.length]} working`
          : attention === "waiting"
            ? "⚠ needs you"
            : attention === "finished"
              ? "✓ done"
              : status.endsWith("●")
                ? "● ready"
                : status.replace(/^[^:]+:\s*/, "")}
      </text>
    </PaneHeader>
  )
}
export const aiStatusSource = {
  subscribe: aiStatusStore.subscribe,
  get: () => aiStatusStore.get().text,
}

export function TerminalPane({ config }: { config: AiConfig }) {
  const ws = useWorkspace()
  const ui = useUi()
  const renderer = useRenderer()
  const boxRef = useRef<BoxRenderable | null>(null)
  const termRef = useRef<EmbeddedTerminalRenderable | null>(null)
  const procRef = useRef<AgentProcess | null>(null)
  const focused = ui.focus === "ai" && !ui.modal

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const term = new EmbeddedTerminalRenderable(renderer, {
      id: "ai-terminal",
      // Width/height must be relative, otherwise they default to a fixed 80x24 grid.
      width: "100%",
      height: "100%",
      flexGrow: 1,
      maxScrollback: config.maxScrollbackBytes,
      transparentBackground: true,
      // Runs after the emulator forwards the click. When the CLI has mouse reporting on
      // (claude does), the emulator stops propagation, so the wrapper box never sees it.
      onMouseDown: (e) => {
        if (e.button === 0 && ws.ui.get().focus !== "ai") ws.ui.set({ focus: "ai" })
      },
    })
    // A CLI that opens with a question (claude's "trust this folder?") waits for an answer the
    // user may not notice while focus is in the tree or editor: bring them to it, once.
    const startedAt = Date.now()
    let asked = false
    let seen = ""
    const decoder = new TextDecoder()
    const watchForQuestion = (data: Uint8Array) => {
      if (asked || Date.now() - startedAt > 30_000) return
      // Output arrives in chunks with escape sequences between words: match on recent plain text.
      seen = (seen + decoder.decode(data, { stream: true }))
        .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "")
        .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
        .slice(-4000)
      if (!/trust\s+this\s+folder|do\s+you\s+trust/i.test(seen.replace(/\s+/g, " "))) return
      asked = true
      if (ws.ui.get().focus !== "ai" && !ws.ui.get().modal) {
        ws.ui.set({ focus: "ai", aiVisible: true })
        term.focus()
        ws.notify(`${config.command} is asking a question in the AI pane`)
      }
    }
    // Tell the user when the AI finishes or waits, unless they're watching its pane.
    let windowFocused = true
    const onFocus = () => (windowFocused = true)
    const onBlur = () => (windowFocused = false)
    renderer.on("focus", onFocus)
    renderer.on("blur", onBlur)
    const name = config.command.split("/").pop()!
    // Turns (what the AI changed per prompt): Enter starts one, the AI going quiet ends it.
    let prompt = ""
    let turnStart = 0
    const submitted = () => {
      turnStart = Date.now()
      void ws.turns?.begin(prompt)
      prompt = ""
    }
    /** Follow what goes into the prompt: typed text, pastes, Backspace; Enter submits. */
    const track = (text: string) => {
      for (const part of text.replace(/\x1b\[20[01]~/g, "").split(/(\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b.)/)) {
        if (part.startsWith("\x1b")) continue
        for (const ch of part) {
          if (ch === "\r") submitted()
          else if (ch === "\x7f" || ch === "\b") prompt = prompt.slice(0, -1)
          else if (ch === "\x15") prompt = "" // Ctrl+U clears the line
          else if (ch >= " " || ch === "\n") prompt = (prompt + ch).slice(-500)
        }
      }
    }
    const watch = new AgentWatch((what) => {
      // A turn ends when the AI goes quiet (not while it waits on a question). The first moments
      // after Enter don't count: the CLI may not have started answering yet.
      if (what !== "waiting" && Date.now() - turnStart > 3000) void ws.turns?.end()
      if (what === "idle") return
      const ui = ws.ui.get()
      const how = config.notify ?? "bell"
      if (how === "off" || (ui.focus === "ai" && ui.aiVisible && !ui.modal && windowFocused)) return
      const text = what === "waiting" ? `${name} is waiting for your answer` : `${name} finished`
      ws.ui.set({ aiAttention: what })
      ws.notify(`${text} (Ctrl+J to look)`, what === "waiting" ? "warn" : "info")
      ringBell()
      if (how === "desktop") desktopNotify("copane", text)
    })
    const ticker = setInterval(() => watch.tick(), 500)
    ticker.unref?.()
    const proc = new AgentProcess({
      command: config.command,
      args: config.args,
      cwd: ws.root,
      onOutput: (data) => {
        term.write(data)
        activity.last = Date.now()
        activity.wake?.()
        watchForQuestion(data)
        watch.output(data)
      },
      onStatus: (s) => {
        // The command's name, not its path: the status bar has little room.
        aiStatusStore.set({ text: describeStatus(name, s) })
        if (s.kind === "exited") {
          term.write(
            `\r\n${YELLOW}[${config.command} exited${s.code !== null ? ` with code ${s.code}` : ""}. Press Enter to restart.]${RESET}\r\n`,
          )
        } else if (s.kind === "error") {
          term.write(
            `\r\n${YELLOW}${s.message}.${RESET}\r\n${DIM}Install it, or set ai.command (F1 › Open settings).\r\nPress Enter to retry.${RESET}\r\n`,
          )
        }
      },
    })
    term.onData = (data) => {
      // You're answering or typing: what's on screen isn't news any more.
      watch.reset()
      track(new TextDecoder().decode(data))
      proc.write(data)
    }
    term.onTerminalResize = (cols, rows) => proc.resize(cols, rows)
    box.add(term)
    termRef.current = term
    procRef.current = proc

    // The emulator may resize before the child exists (that resize is dropped),
    // so always push the current layout size right after starting.
    const startProc = () => {
      const cols = Math.max(20, term.width)
      const rows = Math.max(5, term.height)
      proc.start(cols, rows)
      proc.resize(cols, rows)
    }
    // Start after the first layout so the PTY gets the real size.
    const startTimer = setTimeout(startProc, 50)

    const restart = () => {
      if (proc.status.kind === "running") return
      term.write("\x1bc") // reset the emulator screen
      startProc()
    }

    ws.ai = {
      paste(text) {
        const bytes = term.encodePaste(new TextEncoder().encode(text))
        if (bytes.length) proc.write(bytes)
        track(text.replace(/\r/g, "\n"))
      },
      type(text) {
        const line = text.replace(/[\r\n]+/g, " ")
        track(line)
        proc.write(line)
      },
      submit() {
        submitted()
        proc.write("\r")
      },
      focus() {
        term.focus()
      },
      restart,
      kill() {
        void proc.kill()
      },
    }
    const offShutdown = onShutdown(() => proc.kill(500))

    return () => {
      clearTimeout(startTimer)
      clearInterval(ticker)
      renderer.off("focus", onFocus)
      renderer.off("blur", onBlur)
      offShutdown()
      ws.ai = null
      void proc.kill(500)
      term.destroy()
      termRef.current = null
      procRef.current = null
    }
  }, [renderer, ws, config.command, config.args, config.maxScrollbackBytes, config.notify])

  // Mirror app focus onto the emulator so keys flow to the CLI only when the pane is focused.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    if (focused) term.focus()
    else term.blur()
    // Looking at the pane is seeing the news.
    if (focused && ws.ui.get().aiAttention) ws.ui.set({ aiAttention: null })
  }, [focused, ws])

  const openAiMenu = (x: number, y: number) => {
    const term = termRef.current
    const selected = term?.hasSelection() ? term.getSelectedText() : ""
    ws.ui.set({
      modal: {
        kind: "menu",
        x,
        y,
        items: [
          {
            label: "Copy",
            disabled: !selected,
            run: async () => {
              await ws.clipboard.copy(selected)
              ws.notify(`Copied ${selected.length} chars`)
            },
          },
          {
            label: "Paste",
            run: async () => {
              const text = await ws.clipboard.paste()
              if (text) ws.ai?.paste(text)
              ws.ui.set({ focus: "ai" })
              ws.ai?.focus()
            },
          },
          { label: "Restart " + config.command, disabled: procRef.current?.status.kind === "running", run: () => ws.ai?.restart() },
        ],
      },
    })
  }

  // Enter restarts a dead process.
  useKeyboard((key) => {
    if (!focused || key.name !== "return") return
    const proc = procRef.current
    if (proc && proc.status.kind !== "running") {
      key.preventDefault()
      key.stopPropagation()
      ws.ai?.restart()
    }
  })

  return (
    <box
      flexGrow={1}
      flexDirection="column"
      onMouseDown={(e) => {
        if (e.button === RIGHT) {
          e.stopPropagation()
          openAiMenu(e.x, e.y)
          return
        }
        if (ws.ui.get().focus !== "ai") ws.ui.set({ focus: "ai" })
      }}
      // Ctrl+C belongs to the CLI, so mouse selections are copied on release instead.
      onMouseUp={() => {
        const term = termRef.current
        if (!term?.hasSelection()) return
        const text = term.getSelectedText()
        if (text) void ws.clipboard.copy(text).then(() => ws.notify(`Copied ${text.length} chars from ${config.command}`))
      }}
    >
      <AiHeader command={config.command} focused={focused} attention={ui.aiAttention} />
      <box ref={boxRef} flexGrow={1} flexDirection="column" />
    </box>
  )
}
