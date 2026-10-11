import { useRef, useState, useSyncExternalStore } from "react"
import { useTerminalDimensions } from "@opentui/react"
import { EditorPane } from "../editor/EditorPane"
import { useAppKeymap } from "../keymap/useAppKeymap"
import { ui as colors } from "../config/theme"
import { StatusBar } from "./StatusBar"
import { ConfirmModal } from "./ConfirmModal"
import { HelpModal } from "./HelpModal"
import { ContextMenu } from "./ContextMenu"
import { PromptModal } from "./PromptModal"
import { CommandPalette } from "./CommandPalette"
import { InfoPopup } from "./InfoPopup"
import { ProblemsModal } from "../lsp/ProblemsModal"
import { LocationsModal } from "../lsp/LocationsModal"
import { CompletionPopup } from "../lsp/CompletionPopup"
import { SignaturePopup } from "../lsp/SignaturePopup"
import { MultiEdit } from "../editor/MultiEdit"
import { DiffModal } from "../editor/ConflictBar"
import { SourceControlPanel } from "../git/SourceControlPanel"
import { HunkPeek } from "../git/HunkPeek"
import { HistoryModal } from "../git/HistoryModal"
import { BranchPicker } from "../git/BranchPicker"
import { useUi, useWorkspace } from "./workspace"
import type { UiState } from "./state"
import type { ReactNode } from "react"

const MIN_TREE = 14
const MIN_AI = 30
const MIN_EDITOR = 30

/** Pane widths, honouring dragged sizes but always leaving room for the editor. */
export function paneWidths(
  total: number,
  ui: Pick<UiState, "treeWidth" | "aiWidth">,
  showTree: boolean,
  showAi: boolean,
): { treeWidth: number; aiWidth: number } {
  let tree = ui.treeWidth ?? Math.min(32, Math.max(20, Math.floor(total * 0.18)))
  let ai = ui.aiWidth ?? Math.max(40, Math.floor(total * 0.4))
  tree = Math.max(MIN_TREE, tree)
  ai = Math.max(MIN_AI, ai)
  // Leave the editor its minimum, plus one column per visible divider.
  const room = total - MIN_EDITOR - (showTree ? 1 : 0) - (showAi ? 1 : 0)
  if (showTree) tree = Math.min(tree, room - (showAi ? MIN_AI : 0))
  if (showAi) ai = Math.min(ai, room - (showTree ? tree : 0))
  return { treeWidth: tree, aiWidth: ai }
}

/** Two presses on a divider this close together are a double-click (the renderer reports only presses). */
const DOUBLE_CLICK_MS = 400

/**
 * The 1-column line between two panes; drag it to resize, double-click to go back to the default
 * width (as in VS Code). Brightens on hover and while dragging.
 */
function Divider({ side }: { side: "tree" | "ai" }) {
  const ws = useWorkspace()
  const ui = useUi()
  const [hover, setHover] = useState(false)
  const lastPress = useRef(0)
  const active = hover || ui.resizing === side
  return (
    <box
      width={1}
      flexShrink={0}
      border={["left"]}
      borderColor={active ? colors.borderFocused : colors.divider}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={(e) => {
        e.stopPropagation()
        e.preventDefault()
        const now = Date.now()
        if (now - lastPress.current < DOUBLE_CLICK_MS) {
          lastPress.current = 0
          ws.ui.set(side === "tree" ? { resizing: null, treeWidth: null } : { resizing: null, aiWidth: null })
          return
        }
        lastPress.current = now
        ws.ui.set({ resizing: side })
      }}
    />
  )
}

export interface AppSlots {
  tree?: ReactNode
  ai?: ReactNode
  picker?: ReactNode
  search?: ReactNode
  aiStatus?: { subscribe: (l: () => void) => () => void; get: () => string }
}

const noStatus = { subscribe: () => () => {}, get: () => "" }

export function App({ slots = {} }: { slots?: AppSlots }) {
  const ws = useWorkspace()
  const ui = useUi()
  const dims = useTerminalDimensions()
  const bindings = useAppKeymap()
  const status = slots.aiStatus ?? noStatus
  const aiStatus = useSyncExternalStore(status.subscribe, status.get)

  const tooSmall = dims.width < 60 || dims.height < 12
  const showTree = ui.treeVisible && !!slots.tree && dims.width >= 100
  const showAi = ui.aiVisible && !!slots.ai
  const { treeWidth, aiWidth } = paneWidths(dims.width, ui, showTree, showAi)

  if (tooSmall) {
    return (
      <box flexGrow={1} justifyContent="center" alignItems="center" backgroundColor={colors.bg}>
        <text fg={colors.warn}>
          Terminal too small ({dims.width}x{dims.height}). Need at least 60x12. ^Q quits.
        </text>
      </box>
    )
  }

  const onDrag = (x: number) => {
    // The dragged divider follows the pointer: tree | x | editor | x | ai.
    if (ui.resizing === "tree") ws.ui.set({ treeWidth: Math.max(1, x) })
    else if (ui.resizing === "ai") ws.ui.set({ aiWidth: Math.max(1, dims.width - x - 1) })
  }

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      backgroundColor={colors.bg}
      onMouseDrag={(e) => ui.resizing && onDrag(e.x)}
      onMouseUp={() => ui.resizing && ws.ui.set({ resizing: null })}
    >
      <box flexDirection="row" flexGrow={1}>
        {showTree ? (
          <box width={treeWidth} flexShrink={0} flexDirection="column">
            {slots.tree}
          </box>
        ) : null}
        {showTree ? <Divider side="tree" /> : null}
        <EditorPane />
        {showAi && slots.ai ? <Divider side="ai" /> : null}
        {/* Keep the AI pane mounted when hidden so the CLI session survives toggling. */}
        {slots.ai ? (
          <box width={showAi ? aiWidth : 0} flexShrink={0} flexDirection="column" visible={showAi}>
            {slots.ai}
          </box>
        ) : null}
      </box>
      <StatusBar aiStatus={aiStatus} />
      {ui.modal?.kind === "confirm" ? <ConfirmModal modal={ui.modal} /> : null}
      {ui.modal?.kind === "help" ? <HelpModal bindings={bindings} /> : null}
      {ui.modal?.kind === "prompt" ? <PromptModal key={ui.modal.title + ui.modal.initial} modal={ui.modal} /> : null}
      {ui.modal?.kind === "picker" ? slots.picker : null}
      {ui.modal?.kind === "search" ? slots.search : null}
      {ui.modal?.kind === "diff" ? <DiffModal bufId={ui.modal.bufId} /> : null}
      {ui.modal?.kind === "scm" ? <SourceControlPanel /> : null}
      {ui.modal?.kind === "branches" ? <BranchPicker /> : null}
      {ui.modal?.kind === "history" ? <HistoryModal path={ui.modal.path} sha={ui.modal.sha} /> : null}
      {ui.modal?.kind === "palette" ? <CommandPalette bindings={bindings} /> : null}
      {ui.modal?.kind === "info" ? <InfoPopup x={ui.modal.x} y={ui.modal.y} text={ui.modal.text} /> : null}
      {ui.modal?.kind === "problems" ? <ProblemsModal /> : null}
      {ui.modal?.kind === "locations" ? <LocationsModal title={ui.modal.title} locations={ui.modal.locations} /> : null}
      <CompletionPopup />
      <SignaturePopup />
      <MultiEdit />
      <HunkPeek />
      {ui.modal?.kind === "menu" ? <ContextMenu key={`${ui.modal.x},${ui.modal.y}`} menu={ui.modal} /> : null}
      {/* reference ws so the root re-renders on workspace swaps in tests */}
      {ws ? null : null}
    </box>
  )
}
