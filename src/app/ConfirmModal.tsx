import { useKeyboard } from "@opentui/react"
import { safely } from "./safely"
import { HoverBox, Modal } from "./Modal"
import type { Modal as ModalState } from "./state"
import { useWorkspace } from "./workspace"
import { ui as colors } from "../config/theme"
import { closeModal } from "./modalStack"

export function ConfirmModal({ modal }: { modal: Extract<ModalState, { kind: "confirm" }> }) {
  const ws = useWorkspace()
  useKeyboard((key) => {
    key.preventDefault()
    key.stopPropagation()
    if (key.name === "escape") return closeModal(ws)
    const opt = modal.options.find((o) => o.key === key.name)
    if (opt) void safely(ws, opt.run)
  })
  return (
    <Modal title={modal.title} height={modal.options.length + 6} onClose={() => closeModal(ws)}>
      <text selectable={false} fg={colors.text}>{modal.body}</text>
      <box height={1} />
      {modal.options.map((o) => (
        <HoverBox key={o.key} onPress={() => void safely(ws, o.run)} paddingX={1}>
          <text selectable={false} fg={colors.text}>
            <span fg={colors.accent}>[{o.key}]</span> {o.label}
          </text>
        </HoverBox>
      ))}
    </Modal>
  )
}
