import { useEffect, useState, useSyncExternalStore } from "react"
import { HoverBox } from "../app/Modal"
import { useWorkspace, useKeyText } from "../app/workspace"
import { ui as colors } from "../config/theme"
import { runCommand } from "../keymap/commands"

const noSubscribe = () => () => {}

const Btn = ({ label, onPress, strong }: { label: string; onPress: () => void; strong?: boolean }) => (
  <HoverBox onPress={onPress} paddingX={1} bg={strong ? colors.segmentBg : undefined}>
    <text selectable={false} fg={strong ? colors.aiEdit : colors.text}>
      {label}
    </text>
  </HoverBox>
)

/**
 * Above a file the AI changed, while some of its changes are unreviewed: how many, and the ways
 * through them (Alt+N steps change by change, then file by file).
 */
export function AiReviewBar({ path }: { path: string }) {
  const ws = useWorkspace()
  const kt = useKeyText()
  const review = ws.review
  const version = useSyncExternalStore(review?.store.subscribe ?? noSubscribe, () => review?.store.get().version ?? 0)
  // Edits (an undo, your typing) change the count too: recount after a pause.
  const [edits, setEdits] = useState(0)
  useEffect(() => {
    if (!review?.has(path)) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = ws.buffers.onText((id) => {
      if (ws.buffers.byId(id)?.path !== path) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setEdits((n) => n + 1), 200)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [ws, review, path, version])
  const [count, setCount] = useState(0)
  useEffect(() => {
    const buf = ws.buffers.byPath(path)
    setCount(review?.has(path) && buf ? review.changes(path, ws.buffers.textOf(buf)).length : 0)
  }, [ws, review, path, version, edits])

  if (!review || !count) return null
  const others = review.files().filter((p) => p !== path).length
  const run = (id: Parameters<typeof runCommand>[1]) => () => runCommand(ws, id)
  return (
    <box flexDirection="row" flexWrap="wrap" flexShrink={0} backgroundColor={colors.aiReviewBg}>
      <box paddingLeft={1} paddingRight={1} flexShrink={0}>
        <text selectable={false} fg={colors.aiEdit}>
          {`✦ ${count} AI change${count === 1 ? "" : "s"}${others ? ` (+${others} file${others === 1 ? "" : "s"})` : ""}`}
        </text>
      </box>
      <Btn strong label={kt("Review Alt+N")} onPress={run("ai.nextChange")} />
      <Btn label="Accept file" onPress={run("ai.acceptFile")} />
      <Btn label="Undo file" onPress={run("ai.undoFile")} />
      {others ? <Btn label="Accept all" onPress={run("ai.acceptAll")} /> : null}
    </box>
  )
}
