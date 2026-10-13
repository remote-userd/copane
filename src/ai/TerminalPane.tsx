import { basename, dirname, join, relative } from "node:path"
import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useKeyboard, useRenderer } from "@opentui/react"
import { EmbeddedTerminalRenderable, type BoxRenderable } from "@opentui/core"
import { useUi, useWorkspace, type AiHandle, type Workspace } from "../app/workspace"
import { onShutdown } from "../app/shutdown"
import { Store } from "../app/store"
import { ui as colors } from "../config/theme"
import { HoverBox } from "../app/Modal"
import { runCommand } from "../keymap/commands"
import { AgentProcess, type AgentStatus } from "./AgentProcess"
import { GitRepo } from "../git/repo"
import { AgentWatch, desktopNotify, plain, ringBell, type Attention } from "./alerts"

export interface AgentChoice {
  name: string
  command: string
  args: string[]
}

export interface AiConfig {
  command: string
  args: string[]
  maxScrollbackBytes: number
  notify?: "bell" | "desktop" | "off"
  /** More CLIs offered for new tabs, besides `command`. */
  agents?: AgentChoice[]
}

/** One AI pane tab: a CLI running in a folder (the project, or a git worktree of it). */
export interface Session {
  id: number
  name: string
  command: string
  args: string[]
  cwd: string
  /** The worktree's branch, when the agent runs in its own git worktree. */
  branch: string | null
  /**
   * The worktree's top folder, when it differs from `cwd`: the editor was opened in a subfolder
   * of the repo, and the agent starts in the same subfolder of its worktree.
   */
  worktree?: string
}

/** The top folder of a worktree session's checkout (what git commands run in). */
export const worktreeOf = (s: Pick<Session, "cwd" | "worktree">): string => s.worktree ?? s.cwd

interface SessionState {
  status: string
  /** When the current stretch of output began (the header starts its spinner then). */
  busySince: number
  attention: Attention | null
  /** Files a worktree agent changed since its branch split off (shown on its tab). */
  changes?: number
}

/**
 * When each tab's CLI last printed something; "working" while that was recent. Kept out of the
 * store: output arrives hundreds of times a second, and only the start of a stretch needs a render.
 */
const lastOutput = new Map<number, number>()
const isBusy = (id: number) => Date.now() - (lastOutput.get(id) ?? 0) < BUSY_MS

const RIGHT = 2
const DIM = "\x1b[2m"
const YELLOW = "\x1b[33m"
const RESET = "\x1b[0m"
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const BUSY_MS = 800

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

/** The tabs, which is visible, and each one's state (the header and status bar read it). */
const tabs = new Store<{ sessions: Session[]; active: number; state: Record<number, SessionState> }>({ sessions: [], active: 0, state: {} })
const setState = (id: number, patch: Partial<SessionState>) => {
  const t = tabs.get()
  const prev = t.state[id] ?? { status: "", busySince: 0, attention: null }
  tabs.set({ state: { ...t.state, [id]: { ...prev, ...patch } } })
}
/** Each tab's terminal, for copying its selection. */
const terminals = new Map<number, EmbeddedTerminalRenderable>()
/** Each tab's handle (send text to its CLI); ws.ai forwards to the visible one. */
const handles = new Map<number, AiHandle & { proc: () => AgentProcess | null }>()

/** Tests: no tabs, terminals or handles left from another test (ids restart at 1). */
export function resetAgentTabs(): void {
  for (const h of handles.values()) h.kill()
  handles.clear()
  terminals.clear()
  lastOutput.clear()
  tabs.set({ sessions: [], active: 0, state: {} })
}

/** The status bar's AI segment: the visible tab's status. */
export const aiStatusSource = {
  subscribe: tabs.subscribe,
  get: () => {
    const t = tabs.get()
    return t.state[t.active]?.status ?? ""
  },
}

function tabLabel(s: Session): string {
  return s.branch ? `${s.name} ⎇ ${s.branch}` : s.name
}

const noStore = { subscribe: () => () => {} }

/** The header: a tab per agent (with its state), and + to start another. */
function AiHeader({ focused, onNew, onClose }: { focused: boolean; onNew: (x: number, y: number) => void; onClose: (id: number) => void }) {
  const ws = useWorkspace()
  const t = useSyncExternalStore(tabs.subscribe, tabs.get)
  // Once a turn is over, what it left to review: one click (or Ctrl+Alt+V) into the editor.
  useSyncExternalStore(ws.review?.store.subscribe ?? noStore.subscribe, () => ws.review?.store.get() ?? 0)
  const turnList = useSyncExternalStore(ws.turns?.store.subscribe ?? noStore.subscribe, () => ws.turns?.store.get().turns)
  const running = turnList?.some((turn) => turn.endedAt === null) ?? false
  const toReview = running ? 0 : (ws.review?.files().length ?? 0)
  const [frame, setFrame] = useState(0)
  const busy = isBusy
  const anyBusy = t.sessions.some((s) => busy(s.id))
  // Tick only while output is flowing; idle panes cost nothing.
  useEffect(() => {
    if (!anyBusy) return
    const timer = setInterval(() => setFrame((f) => f + 1), 120)
    return () => clearInterval(timer)
  }, [anyBusy])
  const one = t.sessions.length === 1
  return (
    <box height={1} flexShrink={0} flexDirection="row" backgroundColor={colors.headerBg} paddingLeft={1} paddingRight={1} gap={1} overflow="hidden">
      {t.sessions.map((s) => {
        const st = t.state[s.id]
        const active = s.id === t.active
        const mark = busy(s.id)
          ? SPINNER[frame % SPINNER.length]
          : st?.attention === "waiting"
            ? "⚠"
            : st?.attention === "finished"
              ? "✓"
              : st?.status.endsWith("●")
                ? "●"
                : "○"
        const markColor = busy(s.id) || st?.attention === "waiting" ? colors.warn : st?.attention ? colors.ok : colors.headerFg
        // A worktree agent's tab also says how many files it changed.
        const label = tabLabel(s).toUpperCase() + (s.branch && st?.changes ? ` · ${st.changes}` : "")
        return (
          <box key={s.id} flexDirection="row" flexShrink={0} backgroundColor={active && !one ? colors.segmentBg : undefined}>
            {/* Click switches to the tab; a middle-click closes it, as editor tabs do. */}
            <HoverBox onPress={(button) => (button === 1 && !one ? onClose(s.id) : tabs.set({ active: s.id }))} paddingX={one ? 0 : 1}>
              <text selectable={false} fg={active && focused ? colors.accent : colors.headerFg}>
                {active && focused ? <strong>{label}</strong> : label}
              </text>
              <text selectable={false} fg={markColor}>
                {" " + mark}
              </text>
            </HoverBox>
            {one ? null : (
              <HoverBox onPress={() => onClose(s.id)} paddingX={0}>
                <text selectable={false} fg={colors.dim}>
                  {"× "}
                </text>
              </HoverBox>
            )}
          </box>
        )
      })}
      <box flexGrow={1} />
      {toReview ? (
        <HoverBox onPress={() => void runCommand(ws, "ai.nextChange")}>
          <text selectable={false} fg={colors.aiEdit}>
            {`✦ ${toReview} to review`}
          </text>
        </HoverBox>
      ) : null}
      <HoverBox onPress={() => onNew(-1, -1)}>
        <text selectable={false} fg={colors.headerFg}>
          {one ? "+ agent" : "+"}
        </text>
      </HoverBox>
    </box>
  )
}

/** One tab: its terminal and CLI process. Hidden tabs keep running. Memoized: it drives its terminal itself. */
const AgentSession = memo(function AgentSession({ session, active, focused, config }: { session: Session; active: boolean; focused: boolean; config: AiConfig }) {
  const ws = useWorkspace()
  const renderer = useRenderer()
  const boxRef = useRef<BoxRenderable | null>(null)
  const termRef = useRef<EmbeddedTerminalRenderable | null>(null)
  const procRef = useRef<AgentProcess | null>(null)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const id = session.id
    const name = session.name
    const term = new EmbeddedTerminalRenderable(renderer, {
      id: `ai-terminal-${id}`,
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
    let tail = ""
    let lastScan = 0
    const decoder = new TextDecoder()
    const watchForQuestion = (data: Uint8Array) => {
      if (asked) return
      const now = Date.now()
      if (now - startedAt > 30_000) return
      // Output arrives in chunks with escape sequences between words: match on recent plain text.
      // A CLI can print hundreds of chunks a second: collect raw, clean and look a few times a second.
      tail = (tail + decoder.decode(data, { stream: true })).slice(-8000)
      if (now - lastScan < 250) {
        // Look again once the burst settles: the question may be the last thing printed.
        scanTimer ??= setTimeout(() => {
          scanTimer = null
          scanForQuestion()
        }, 250)
        return
      }
      scanForQuestion()
    }
    let scanTimer: ReturnType<typeof setTimeout> | null = null
    const scanForQuestion = () => {
      lastScan = Date.now()
      if (asked || disposed || !/trust\s+this\s+folder|do\s+you\s+trust/i.test(plain(tail))) return
      asked = true
      if (ws.ui.get().focus !== "ai" && !ws.ui.get().modal) {
        tabs.set({ active: id })
        ws.ui.set({ focus: "ai", aiVisible: true })
        term.focus()
        ws.notify(`${name} is asking a question in the AI pane`)
      }
    }
    // Tell the user when the AI finishes or waits, unless they're watching this tab.
    let windowFocused = true
    const onFocus = () => (windowFocused = true)
    const onBlur = () => (windowFocused = false)
    renderer.on("focus", onFocus)
    renderer.on("blur", onBlur)
    // Turns (what the AI changed per prompt) follow agents working in the project itself; one
    // in a worktree edits another folder.
    const turns = session.cwd === ws.root ? ws.turns : null
    let prompt = ""
    let turnStart = 0
    const submitted = () => {
      turnStart = Date.now()
      void turns?.begin(prompt)
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
      if (what !== "waiting" && Date.now() - turnStart > 3000) void turns?.end()
      // A worktree agent went quiet: recount its changes for the tab.
      if (session.branch) void recount(ws, id)
      if (what === "idle") return
      const ui = ws.ui.get()
      const how = config.notify ?? "bell"
      const watching = tabs.get().active === id && ui.focus === "ai" && ui.aiVisible && !ui.modal && windowFocused
      if (how === "off" || watching) return
      const text = what === "waiting" ? `${name} is waiting for your answer` : `${name} finished`
      setState(id, { attention: what })
      ws.ui.set({ aiAttention: what })
      // Changes waiting for review: say so, with the key that starts it from anywhere.
      const toReview = what === "finished" ? (ws.review?.files().length ?? 0) : 0
      const hint = toReview ? ` · ${toReview} file${toReview === 1 ? "" : "s"} to review (Ctrl+Alt+V)` : " (Ctrl+J to look)"
      ws.notify(text + hint, what === "waiting" ? "warn" : "info")
      ringBell()
      if (how === "desktop") desktopNotify("copane", text)
    })
    // The watch only needs ticks while a stretch of output awaits its verdict.
    let ticker: ReturnType<typeof setInterval> | null = null
    let disposed = false
    const tick = () => {
      watch.tick()
      if (!watch.pending && ticker) {
        clearInterval(ticker)
        ticker = null
      }
    }
    const ensureTicker = () => {
      if (ticker) return
      ticker = setInterval(tick, 500)
      ticker.unref?.()
    }
    const proc = new AgentProcess({
      command: session.command,
      args: session.args,
      cwd: session.cwd,
      onOutput: (data) => {
        if (disposed) return // the tab closed; the CLI is being stopped
        term.write(data)
        const now = Date.now()
        const quietBefore = !isBusy(id)
        lastOutput.set(id, now)
        // Only the start of a stretch re-renders (to start the spinner); its ticks do the rest.
        if (quietBefore) setState(id, { busySince: now })
        watchForQuestion(data)
        watch.output(data)
        ensureTicker()
      },
      onStatus: (s) => {
        if (disposed) return
        // The command's name, not its path: the status bar has little room.
        setState(id, { status: describeStatus(name, s) })
        if (s.kind === "exited") {
          term.write(`\r\n${YELLOW}[${name} exited${s.code !== null ? ` with code ${s.code}` : ""}. Press Enter to restart.]${RESET}\r\n`)
        } else if (s.kind === "error") {
          term.write(`\r\n${YELLOW}${s.message}.${RESET}\r\n${DIM}Install it, or set ai.command (F1 › Open settings).\r\nPress Enter to retry.${RESET}\r\n`)
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
    terminals.set(id, term)

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

    handles.set(id, {
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
      restart() {
        if (proc.status.kind === "running") return
        term.write("\x1bc") // reset the emulator screen
        startProc()
      },
      kill() {
        void proc.kill()
      },
      proc: () => procRef.current,
    })
    const offShutdown = onShutdown(() => proc.kill(500))

    return () => {
      // Output or an exit after this must not re-arm the ticker or alert about a closed tab.
      disposed = true
      clearTimeout(startTimer)
      if (scanTimer) clearTimeout(scanTimer)
      if (ticker) clearInterval(ticker)
      renderer.off("focus", onFocus)
      renderer.off("blur", onBlur)
      offShutdown()
      handles.delete(id)
      lastOutput.delete(id)
      terminals.delete(id)
      void proc.kill(500)
      term.destroy()
      termRef.current = null
      procRef.current = null
    }
  }, [renderer, ws, session, config.maxScrollbackBytes, config.notify])

  // Mirror app focus onto the emulator so keys flow to the CLI only when its tab is shown and focused.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    if (active && focused) term.focus()
    else term.blur()
    // Looking at the tab is seeing the news.
    if (active && focused) {
      if (tabs.get().state[session.id]?.attention) setState(session.id, { attention: null })
      if (ws.ui.get().aiAttention) ws.ui.set({ aiAttention: null })
    }
  }, [active, focused, ws, session.id])

  return <box ref={boxRef} flexGrow={1} flexDirection="column" visible={active} />
})

/**
 * Where a new worktree for `name` goes: beside the repo, e.g. ../app-codex-2, and the folder in it
 * matching `root` (the same as `path` unless the editor was opened in a subfolder of the repo `top`).
 */
export function worktreeFor(root: string, name: string, n: number, top = root): { path: string; branch: string; cwd: string } {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent"
  const path = join(dirname(top), `${basename(top)}-${slug}-${n}`)
  return { path, branch: `copane/${slug}-${n}`, cwd: join(path, relative(top, root)) }
}

/** The AI pane: one tab per agent CLI. ws.ai always points at the visible tab. */
export function TerminalPane({ config }: { config: AiConfig }) {
  const ws = useWorkspace()
  const ui = useUi()
  const t = useSyncExternalStore(tabs.subscribe, tabs.get)
  const focused = ui.focus === "ai" && !ui.modal
  const nextId = useRef(2)

  // The first tab: ai.command in the project.
  useEffect(() => {
    const name = basename(config.command)
    tabs.set({ sessions: [{ id: 1, name, command: config.command, args: config.args, cwd: ws.root, branch: null }], active: 1, state: {} })
  }, [ws, config.command, config.args])

  useEffect(() => {
    const active = () => handles.get(tabs.get().active)
    ws.ai = {
      paste: (text) => active()?.paste(text),
      type: (text) => active()?.type(text),
      submit: () => active()?.submit(),
      focus: () => active()?.focus(),
      restart: () => active()?.restart(),
      kill: () => {
        for (const h of handles.values()) h.kill()
      },
    }
    ws.agents = {
      openMenu: (x, y) => openAgentMenu(ws, config, x, y, (s) => addSession(s)),
      cycle(dir) {
        const { sessions, active } = tabs.get()
        if (sessions.length < 2) return
        const i = sessions.findIndex((s) => s.id === active)
        tabs.set({ active: sessions[(i + dir + sessions.length) % sessions.length]!.id })
        ws.ui.set({ focus: "ai", aiVisible: true })
      },
      closeActive: () => closeSession(ws, tabs.get().active),
      session: (id) => tabs.get().sessions.find((s) => s.id === id),
      activeId: () => tabs.get().active,
      close: (id) => {
        // The last tab can't go: start a fresh one in the project first.
        if (tabs.get().sessions.length < 2) addSession({ name: basename(config.command), command: config.command, args: config.args, cwd: ws.root, branch: null })
        closeTab(id)
      },
      stop: async (id) => {
        await handles.get(id)?.proc()?.kill(1500)
      },
      recount: (id) => void recount(ws, id),
    }
    return () => {
      ws.ai = null
      ws.agents = null
    }
  }, [ws, config])

  const addSession = (s: Omit<Session, "id">) => {
    const id = nextId.current++
    // A second tab of the same CLI gets a number: "claude 2".
    const same = tabs.get().sessions.filter((o) => o.name === s.name || o.name.startsWith(`${s.name} `)).length
    const name = same ? `${s.name} ${same + 1}` : s.name
    tabs.set({ sessions: [...tabs.get().sessions, { ...s, name, id }], active: id })
    ws.ui.set({ focus: "ai", aiVisible: true })
  }

  const openAiMenu = (x: number, y: number, selectedText: string) => {
    const h = handles.get(tabs.get().active)
    ws.ui.set({
      modal: {
        kind: "menu",
        x,
        y,
        items: [
          {
            label: "Copy",
            disabled: !selectedText,
            run: async () => {
              await ws.clipboard.copy(selectedText)
              ws.notify(`Copied ${selectedText.length} chars`)
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
          { label: "Restart", disabled: h?.proc()?.status.kind === "running", run: () => ws.ai?.restart() },
          { label: "New agent tab…", hint: "Ctrl+Alt+N", run: () => ws.agents?.openMenu(x, y) },
          ...(tabs.get().sessions.find((s) => s.id === tabs.get().active)?.branch
            ? [{ label: "Review & merge this agent…", run: () => ws.ui.set({ modal: { kind: "mergeAgent", sessionId: tabs.get().active } }) }]
            : []),
          { label: "Close this agent", hint: "Ctrl+Alt+W", disabled: tabs.get().sessions.length < 2, run: () => ws.agents?.closeActive() },
        ],
      },
    })
  }
  // Enter restarts a dead process.
  useKeyboard((key) => {
    if (!focused || key.name !== "return") return
    const proc = handles.get(tabs.get().active)?.proc()
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
          openAiMenu(e.x, e.y, terminalSelection(t.active))
          return
        }
        if (ws.ui.get().focus !== "ai") ws.ui.set({ focus: "ai" })
      }}
      // Ctrl+C belongs to the CLI, so mouse selections are copied on release instead.
      onMouseUp={() => {
        const text = terminalSelection(t.active)
        if (text) void ws.clipboard.copy(text).then(() => ws.notify(`Copied ${text.length} chars`))
      }}
    >
      <AiHeader focused={focused} onNew={() => ws.agents?.openMenu()} onClose={(id) => closeSession(ws, id)} />
      {t.sessions.map((s) => (
        <AgentSession key={s.id} session={s} active={s.id === t.active} focused={focused} config={config} />
      ))}
    </box>
  )
}

/** The selected text in a tab's terminal. */
function terminalSelection(id: number): string {
  const term = terminals.get(id)
  return term?.hasSelection() ? term.getSelectedText() : ""
}

/** The menu of agents to start: each configured CLI, in the project or in a new git worktree. */
function openAgentMenu(ws: Workspace, config: AiConfig, x: number | undefined, y: number | undefined, add: (s: Omit<Session, "id">) => void): void {
  const choices: AgentChoice[] = [{ name: basename(config.command), command: config.command, args: config.args }, ...(config.agents ?? [])]
  const repo = ws.git?.repo ?? null
  const count = (name: string) => tabs.get().sessions.filter((s) => s.name === name || s.name.startsWith(`${name} `)).length
  const inWorktree = async (c: AgentChoice) => {
    if (!repo) return
    let n = count(c.name) + 1
    let wt = worktreeFor(ws.root, c.name, n, repo.top)
    // Skip numbers still taken: a worktree folder, or a branch kept after its worktree was removed.
    while ((await Bun.file(join(wt.path, ".git")).exists()) || (await repo.branchExists(wt.branch))) wt = worktreeFor(ws.root, c.name, ++n, repo.top)
    ws.notify(`Creating worktree ${wt.path}…`)
    const err = await repo.addWorktree(wt.path, wt.branch)
    if (err) return ws.notify(`Could not create the worktree: ${err}`, "error")
    add({ name: c.name, command: c.command, args: c.args, cwd: wt.cwd, branch: wt.branch, ...(wt.cwd !== wt.path ? { worktree: wt.path } : {}) })
    ws.notify(`${c.name} works in ${wt.path} on branch ${wt.branch}`)
  }
  ws.ui.set({
    modal: {
      kind: "menu",
      // From a key: under the AI pane's header, at the right of the screen.
      x: x !== undefined && x >= 0 ? x : Math.max(2, (process.stdout.columns || 80) - 46),
      y: y !== undefined && y >= 0 ? y : 1,
      items: choices.flatMap((c) => [
        { label: `New ${c.name}`, run: () => add({ name: c.name, command: c.command, args: c.args, cwd: ws.root, branch: null }) },
        { label: `New ${c.name} in a git worktree`, disabled: !repo, run: () => void inWorktree(c) },
      ]),
    },
  })
}

/** Stop a tab's CLI and drop the tab (not the last one). */
function closeTab(id: number): void {
  const { sessions, active } = tabs.get()
  if (sessions.length < 2 || !sessions.some((s) => s.id === id)) return
  handles.get(id)?.kill()
  const rest = sessions.filter((s) => s.id !== id)
  const i = sessions.findIndex((s) => s.id === id)
  const { [id]: _gone, ...state } = tabs.get().state
  tabs.set({ sessions: rest, active: active === id ? rest[Math.max(0, i - 1)]!.id : active, state })
}

/** How many files a worktree agent changed since its branch split off; stored for its tab. */
async function recount(ws: Workspace, id: number): Promise<void> {
  const session = tabs.get().sessions.find((s) => s.id === id)
  const repo = ws.git?.repo
  if (!session?.branch || !repo) return
  // Counts can overlap (the agent goes quiet again before one finishes): only the latest one lands.
  const seq = (recounts.get(id) ?? 0) + 1
  recounts.set(id, seq)
  const base = await repo.mergeBase(session.branch)
  if (!base) return
  const changes = (await new GitRepo(worktreeOf(session)).changesSince(base)).length
  if (recounts.get(id) !== seq) return
  if (tabs.get().state[id]?.changes !== changes) setState(id, { changes })
}
const recounts = new Map<number, number>()

/** Close a tab (not the last). A worktree tab offers to merge its work first, or to remove its worktree. */
function closeSession(ws: Workspace, id: number): void {
  const { sessions } = tabs.get()
  if (sessions.length < 2) return ws.notify("This is the only agent; restart it instead (right-click › Restart)")
  const session = sessions.find((s) => s.id === id)
  if (!session) return
  const close = () => closeTab(id)
  if (!session.branch) return close()
  const repo = ws.git?.repo
  ws.ui.set({
    modal: {
      kind: "confirm",
      title: `Close ${tabLabel(session)}`,
      body: `It works in ${worktreeOf(session)}. Review and merge its work into your branch first, or remove that worktree (its branch ${session.branch} stays, with any commits)?`,
      options: [
        { key: "m", label: "Review & merge first", run: () => ws.ui.set({ modal: { kind: "mergeAgent", sessionId: id } }) },
        {
          key: "r",
          label: "Remove worktree",
          run: async () => {
            ws.ui.set({ modal: null })
            close()
            const err = await repo?.removeWorktree(worktreeOf(session))
            ws.notify(err ? `Worktree kept: ${err}` : `Removed ${worktreeOf(session)} (branch ${session.branch} kept)`, err ? "warn" : "info")
          },
        },
        {
          key: "k",
          label: "Keep worktree",
          run: () => {
            ws.ui.set({ modal: null })
            close()
          },
        },
        { key: "escape", label: "Cancel", run: () => ws.ui.set({ modal: null }) },
      ],
    },
  })
}
