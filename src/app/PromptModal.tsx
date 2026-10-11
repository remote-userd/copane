import { useEffect, useRef, useState } from "react"
import { useKeyboard } from "@opentui/react"
import type { InputRenderable } from "@opentui/core"
import { Modal } from "./Modal"
import type { Modal as ModalState } from "./state"
import { useWorkspace } from "./workspace"
import { ui as colors } from "../config/theme"

type Prompt = Extract<ModalState, { kind: "prompt" }>

/** One-line text dialog (file names). Enter submits, Esc or a click outside cancels. */
export function PromptModal({ modal }: { modal: Prompt }) {
  const ws = useWorkspace()
  const input = useRef<InputRenderable | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const close = () => ws.ui.set({ modal: null })

  useEffect(() => {
    const el = input.current
    if (!el) return
    const dot = modal.initial.lastIndexOf(".")
    const col = modal.cursorBeforeExt && dot > 0 ? dot : modal.initial.length
    el.setCursor(0, col)
  }, [modal])

  const submit = async () => {
    if (busy.current) return
    busy.current = true
    try {
      const err = await modal.submit(input.current?.value ?? "")
      if (err) setError(err)
      else if (ws.ui.get().modal?.kind === "prompt") close()
    } finally {
      busy.current = false
    }
  }

  useKeyboard((key) => {
    if (key.name === "escape") close()
    else if (key.name === "return") void submit()
    else return
    key.preventDefault()
    key.stopPropagation()
  })

  return (
    <Modal title={modal.title} height={error ? 7 : 6} onClose={close}>
      <text selectable={false} fg={colors.dim}>
        {modal.label}
      </text>
      <input
        ref={input}
        focused
        value={modal.initial}
        backgroundColor={colors.bg}
        focusedBackgroundColor={colors.bg}
        textColor={colors.text}
        onInput={() => error && setError(null)}
      />
      {error ? (
        <text selectable={false} fg={colors.error}>
          {error}
        </text>
      ) : null}
    </Modal>
  )
}
