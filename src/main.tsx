import { resolve } from "node:path"
import { createCliRenderer } from "@opentui/core"
import { createRoot, useTerminalDimensions } from "@opentui/react"
import { App } from "./app/App"
import { ErrorBoundary } from "./app/ErrorBoundary"
import { installSignalHandlers, onShutdown, prepareTerminal, registerRenderer } from "./app/shutdown"
import { createWorkspace, WorkspaceContext } from "./app/workspace"
import { loadConfig } from "./config/load"
import { createClipboard } from "./app/clipboard"
import { loadLayout, persistLayout } from "./app/layoutState"
import { installPerfLog, perfCommit } from "./app/perf"
import { Profiler } from "react"

const noop = () => {}
import { saveBeforeAi } from "./app/saveBeforeAi"
import { isCompiled, setLaunchCwd, takeRestoreState, watchForUpdate } from "./app/update"
import { FileTree } from "./files/FileTree"
import { FilePicker } from "./files/FilePicker"
import { SearchModal } from "./files/SearchModal"
import { SearchPanel } from "./files/SearchPanel"
import { Sidebar } from "./app/Sidebar"
import { TreeModel } from "./files/TreeModel"
import { GitStatus } from "./files/gitStatus"
import { keepBlames } from "./git/blame"
import { LspManager } from "./lsp/LspManager"
import { applyFileEdits } from "./lsp/lspActions"
import { aiStatusSource, TerminalPane } from "./ai/TerminalPane"
import { affectedOpenFiles, FileWatcher } from "./files/watcher"
import { TurnLog } from "./ai/turns"
import { AiReview, reviewStatePath } from "./ai/review"
import { windowFocus, windowFocused } from "./app/windowFocus"
import pkg from "../package.json"

const USAGE = `Usage: copane [file|directory]
       copane --upgrade        install the latest release
       copane --install-font   install the bundled Nerd Font for file-tree icons
       copane --version

Opens a terminal code editor with an AI CLI (default: claude) in a side pane.
Config: ~/.config/copane/config.json`

async function parseArgs(argv: string[]): Promise<{ root: string; file: string | null }> {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(USAGE)
    process.exit(0)
  }
  if (argv.includes("-v") || argv.includes("--version")) {
    console.log(`copane ${pkg.version}`)
    process.exit(0)
  }
  if (argv.includes("--upgrade")) {
    const { upgrade } = await import("./setup/upgrade")
    process.exit(await upgrade())
  }
  if (argv.includes("--install-font")) {
    const { main } = await import("./setup/installFont")
    await main()
    process.exit(0)
  }
  const arg = argv.find((a) => !a.startsWith("-"))
  if (!arg) return { root: process.cwd(), file: null }
  const abs = resolve(arg)
  // A missing path is a new file, opened relative to the current folder.
  const info = await Bun.file(abs).stat().catch(() => null)
  if (info?.isDirectory()) return { root: abs, file: null }
  return { root: process.cwd(), file: abs }
}

const args = await parseArgs(process.argv.slice(2))

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("copane needs an interactive terminal.")
  process.exit(1)
}
setLaunchCwd(process.cwd())
process.chdir(args.root)
const { config, warning } = await loadConfig()

prepareTerminal()
installSignalHandlers()

const renderer = await createCliRenderer({ exitOnCtrlC: false })
registerRenderer(renderer)
// Polling and animations pause while the terminal window is in the background.
renderer.on("focus", () => windowFocus.set({ focused: true }))
renderer.on("blur", () => windowFocus.set({ focused: false }))
// Every pane, popup and preview listens for keys; Node's leak warning at 10 would print over the UI.
renderer.keyInput.setMaxListeners(100)
installPerfLog(renderer)

const ws = createWorkspace(
  args.root,
  { focus: args.file ? "editor" : "tree", aiVisible: !config.ai.startHidden, wordWrap: config.editor.wordWrap, ...(await loadLayout()) },
  config,
  createClipboard({ osc52: (text) => renderer.copyToClipboardOSC52(text) }),
)
onShutdown(persistLayout(ws.ui))
onShutdown(saveBeforeAi(ws))
const tree = new TreeModel(ws.root)
// Build the Ctrl+P index in the background once the first screen is up, so the picker opens instantly.
setTimeout(() => void tree.files(), 1500).unref?.()
const git = new GitStatus(ws.root)
ws.git = git
const lsp = new LspManager(ws.root, config.lsp)
ws.lsp = lsp
lsp.onApplyEdit = (files) => applyFileEdits(ws, files)
lsp.attach(ws.buffers)
onShutdown(() => lsp.stop())
void git.start()
// Back from another app: catch up on git (polling paused meanwhile; the file watcher didn't).
windowFocus.subscribe(() => windowFocused() && git.refresh(0))
onShutdown(() => git.stop())
// Per-file git caches follow the open tabs, so a long session doesn't keep every file it touched.
let openCount = 0
ws.buffers.subscribe(() => {
  const list = ws.buffers.list()
  if (list.length >= openCount) return void (openCount = list.length)
  openCount = list.length
  const open = new Set(list.map((b) => b.path))
  git.keepContents(open)
  keepBlames(open)
})
onShutdown(() => ws.buffers.dispose())
if (warning) setTimeout(() => ws.notify(warning, "warn"), 100)

// Files changed by the AI CLI (or anything else) flow back into open buffers and the tree.
// What the AI changes per prompt, for review and undo (Ctrl+Alt+Z).
const turns = new TurnLog(ws.root, () => git.repo, async () => ((await git.repo?.status()) ?? []).filter((e) => e.untracked).map((e) => e.path))
ws.turns = turns
// Files the AI changed stay marked for review until accepted (Alt+N).
const review = new AiReview(ws.buffers)
const reviewFile = reviewStatePath(ws.root)
await review.load(reviewFile) // what was left to review last session
review.watch(turns)
review.followGit(git) // committing a file accepts its AI changes
onShutdown(review.persist(reviewFile, ws.root))
ws.review = review

const watcher = new FileWatcher(ws.root, async (batch) => {
  const open = ws.buffers.watchedPaths()
  const reloaded: string[] = []
  const handled = new Set<string>()
  for (const path of affectedOpenFiles(batch, open)) {
    const before = ws.buffers.byPath(path)?.diskText
    const result = await ws.buffers.handleDiskChange(path)
    handled.add(path)
    // "ignored": the content is what copane last saved (our own save), so not an AI edit.
    if (result !== "ignored") void turns.fileChanged(path, before)
    const buf = ws.buffers.byPath(path)
    if (!buf) continue
    if (result === "reloaded") reloaded.push(buf.relPath)
    else if (result === "conflict") ws.notify(`${buf.relPath} changed on disk; you have unsaved edits`, "warn")
    else if (result === "deleted") ws.notify(`${buf.relPath} was deleted on disk`, "warn")
  }
  if (reloaded.length) ws.notify(`Reloaded ${reloaded.join(", ")}`)
  // Files not open in a tab: only a running turn cares about them.
  if (turns.open) {
    for (const path of batch.paths) {
      if (handled.has(path)) continue
      const info = await Bun.file(path).stat().catch(() => null)
      if (!info?.isDirectory()) void turns.fileChanged(path)
    }
  }
  await tree.onFsChanges(batch.paths)
  git.refresh()
}, undefined, tree.matcher) // the tree's matcher: each .gitignore is read once
void watcher.start().then(() => {
  if (watcher.limitHit) ws.notify(`Watching the first ${FileWatcher.MAX_DIRS} folders only; changes deeper in may not reload`, "warn")
})
onShutdown(() => watcher.stop())

const restored = await takeRestoreState()
if (restored) {
  // Restarted (e.g. after an update): bring back the tabs, then the active one.
  void (async () => {
    for (const path of restored.files) await ws.buffers.open(path).catch(() => null)
    const active = restored.active ? ws.buffers.byPath(restored.active) : null
    if (active) {
      ws.buffers.activate(active.id)
      void tree.reveal(active.source ?? active.path)
      ws.ui.set({ focus: "editor" })
    }
    ws.notify("Restarted")
  })()
} else if (args.file) {
  ws.buffers
    .open(args.file)
    .then((b) => tree.reveal(b.path))
    .catch((err: Error) => ws.notify(err.message, "error"))
}

// A newer build installed over this binary: offer a restart from the status bar.
if (isCompiled()) {
  const stop = watchForUpdate(process.execPath, () => {
    ws.ui.set({ updateReady: true })
    ws.notify("New version installed (Ctrl+Alt+R)")
  })
  onShutdown(stop)
}

function TreeSlot() {
  const dims = useTerminalDimensions()
  // The status bar and the pane's tab strip take a row each.
  const height = dims.height - 2
  return (
    <Sidebar
      files={<FileTree tree={tree} git={git} icons={config.tree.icons} height={height} header={false} />}
      search={<SearchPanel tree={tree} height={height} mode="sidebar" />}
    />
  )
}

const aiConfig = {
  command: config.ai.command,
  args: config.ai.args,
  maxScrollbackBytes: config.ai.maxScrollbackBytes,
  notify: config.ai.notify,
  agents: config.ai.agents,
}

createRoot(renderer).render(
  // The profiler only counts with CE_PERF set (and only in `bun run dev`: see perfCommit).
  <Profiler id="app" onRender={Bun.env.CE_PERF ? perfCommit : noop}>
    <WorkspaceContext.Provider value={ws}>
      <ErrorBoundary>
        <App
          slots={{
            tree: <TreeSlot />,
            picker: <FilePicker tree={tree} />,
            search: <SearchModal tree={tree} />,
            ai: <TerminalPane config={aiConfig} />,
            aiStatus: aiStatusSource,
          }}
        />
      </ErrorBoundary>
    </WorkspaceContext.Provider>
  </Profiler>,
)
