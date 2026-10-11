import { createContext, useContext, useSyncExternalStore } from "react"
import { BufferStore } from "../editor/BufferStore"
import { createUiStore, type Notice, type UiState } from "./state"
import type { Store } from "./store"
import { configSchema, type Config } from "../config/schema"
import { createClipboard, type Clipboard } from "./clipboard"
import type { GitStatus } from "../files/gitStatus"
import type { LspManager } from "../lsp/LspManager"
import type { TurnLog } from "../ai/turns"

export interface Workspace {
  root: string
  config: Config
  clipboard: Clipboard
  buffers: BufferStore
  ui: Store<UiState>
  notify(text: string, kind?: Notice["kind"]): void
  /** Set by the AI pane once mounted; used by "send to AI" and shutdown. */
  ai: AiHandle | null
  /** Git status of the workspace (null outside the app, e.g. in tests). */
  git: GitStatus | null
  /** Language servers (diagnostics, completion, hover, definition); null in tests. */
  lsp: LspManager | null
  /** What the AI changed per turn (prompt), for review and undo; null in tests. */
  turns: TurnLog | null
}

export interface AiHandle {
  /** Insert text into the CLI's input as if pasted. */
  paste(text: string): void
  /** Send text as if typed. Must not contain newlines (they would submit). */
  type(text: string): void
  /** Press Enter in the CLI (submit the prompt). */
  submit(): void
  focus(): void
  restart(): void
  kill(): void
}

export function createWorkspace(
  root: string,
  ui?: Partial<UiState>,
  config: Config = configSchema.parse({}),
  clipboard: Clipboard = createClipboard({ tool: null }),
): Workspace {
  const uiStore = createUiStore(ui)
  let noticeTimer: ReturnType<typeof setTimeout> | null = null
  const ws: Workspace = {
    root,
    config,
    clipboard,
    buffers: new BufferStore({ root, highlightMaxBytes: config.editor.highlightMaxBytes }),
    ui: uiStore,
    ai: null,
    git: null,
    lsp: null,
    turns: null,
    notify(text, kind = "info") {
      uiStore.set({ notice: { text, kind } })
      if (noticeTimer) clearTimeout(noticeTimer)
      noticeTimer = setTimeout(() => uiStore.set({ notice: null }), kind === "error" ? 8000 : 4000)
    },
  }
  return ws
}

export const WorkspaceContext = createContext<Workspace | null>(null)

export function useWorkspace(): Workspace {
  const ws = useContext(WorkspaceContext)
  if (!ws) throw new Error("WorkspaceContext missing")
  return ws
}

export function useUi(): UiState {
  const ws = useWorkspace()
  return useSyncExternalStore(ws.ui.subscribe, ws.ui.get)
}

/** Re-render on any buffer store change; returns the store. */
export function useBuffers(): BufferStore {
  const ws = useWorkspace()
  useSyncExternalStore(ws.buffers.subscribe, ws.buffers.getSnapshot)
  return ws.buffers
}
