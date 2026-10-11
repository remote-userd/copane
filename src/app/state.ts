import { Store } from "./store"

export type Focus = "tree" | "editor" | "ai"

export interface ConfirmOption {
  key: string
  label: string
  run: () => void | Promise<void>
}

export interface MenuItem {
  label: string
  /** Shortcut shown on the right, e.g. "^C". */
  hint?: string
  disabled?: boolean
  run: () => void | Promise<void>
}

export type Modal =
  | { kind: "menu"; x: number; y: number; items: MenuItem[] }
  | { kind: "confirm"; title: string; body: string; options: ConfirmOption[] }
  | {
      kind: "prompt"
      title: string
      label: string
      initial: string
      /** Put the cursor before the extension (renaming "a.ts" edits "a"). */
      cursorBeforeExt?: boolean
      /** Returns an error to show (dialog stays open), or null to close. */
      submit: (value: string) => Promise<string | null>
    }
  | { kind: "picker"; query?: string }
  | { kind: "search"; replace?: boolean; restore?: boolean }
  | { kind: "diff"; bufId: number }
  | { kind: "scm" }
  | { kind: "branches"; mode?: "switch" | "delete" }
  | { kind: "history"; path: string | null; sha?: string }
  | { kind: "palette" }
  | { kind: "info"; x: number; y: number; text: string }
  | { kind: "problems" }
  | { kind: "locations"; title: string; locations: { path: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }[] }
  | { kind: "help" }
  | { kind: "turns" }
  | { kind: "mergeAgent"; sessionId: number }

export interface Notice {
  text: string
  kind: "info" | "warn" | "error"
}

export interface UiState {
  focus: Focus
  treeVisible: boolean
  aiVisible: boolean
  modal: Modal | null
  notice: Notice | null
  /** Pane widths set by dragging a border; null = automatic. Session only. */
  treeWidth: number | null
  aiWidth: number | null
  /** Which border is being dragged. */
  resizing: "tree" | "ai" | null
  /** A newer build was installed while running; offer a restart. */
  updateReady: boolean
  /** Find bar over the editor: open, with replace row, and whether it has keyboard focus. */
  find: { replace: boolean; active: boolean; seed: number; anchor: { row: number; col: number } } | null
  findQuery: string
  replaceWith: string
  /** Inline diff of the change at a line: a git change (Alt+H, a click on its marker) or an unreviewed AI edit (Alt+N). */
  hunkPeek: { bufId: number; row: number; kind?: "git" | "ai" } | null
  /** A path the tree should reveal and select (set by breadcrumbs), consumed by the tree. */
  revealPath: string | null
  /** What the left pane shows: the file tree or project search. */
  sidebar: "files" | "search"
  /** Each Ctrl+Alt+F bumps `n`: focus the search field, seeded with `text` (the selection). */
  searchSeed: { n: number; replace: boolean; text: string } | null
  /** Wrap long lines in the editor (Alt+Z). */
  wordWrap: boolean
  /** Pane visibility before "maximize editor", restored by toggling it again. */
  maximized: { tree: boolean; ai: boolean } | null
  /** Show a live preview beside Markdown files (Ctrl+K V). */
  mdSide: boolean
  /** The AI finished or is waiting for you while you weren't looking; cleared when its pane gets focus. */
  aiAttention: "finished" | "waiting" | null
}

export function createUiStore(initial?: Partial<UiState>): Store<UiState> {
  return new Store<UiState>({
    focus: "editor",
    treeVisible: true,
    aiVisible: true,
    modal: null,
    notice: null,
    treeWidth: null,
    aiWidth: null,
    resizing: null,
    updateReady: false,
    maximized: null,
    mdSide: false,
    aiAttention: null,
    wordWrap: false,
    sidebar: "files",
    searchSeed: null,
    revealPath: null,
    hunkPeek: null,
    find: null,
    findQuery: "",
    replaceWith: "",
    ...initial,
  })
}
