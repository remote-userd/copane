import { useTerminalDimensions } from "@opentui/react"
import { Modal } from "../app/Modal"
import { useUi, useWorkspace } from "../app/workspace"
import type { TreeModel } from "./TreeModel"
import { SearchPanel } from "./SearchPanel"
import { closeModal } from "../app/modalStack"

/** Project search as a popup: used when the terminal is too narrow for the left pane's SEARCH tab. */
export function SearchModal({ tree }: { tree: TreeModel }) {
  const ws = useWorkspace()
  const dims = useTerminalDimensions()
  const ui = useUi()
  const replace = ui.modal?.kind === "search" && !!ui.modal.replace
  const height = Math.max(8, Math.min(30, dims.height - 4))
  return (
    <Modal
      title={replace ? "Replace in files" : "Search in files"}
      width={Math.min(110, dims.width - 4)}
      height={height}
      onClose={() => closeModal(ws)}
    >
      <SearchPanel tree={tree} height={height - 4} mode="popup" />
    </Modal>
  )
}
