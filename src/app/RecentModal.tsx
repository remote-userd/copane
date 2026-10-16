import { useEffect, useState } from "react"
import { useTerminalDimensions } from "@opentui/react"
import { useWorkspace } from "./workspace"
import { ui as colors } from "../config/theme"
import { forgetRecent, loadRecent, type RecentFolder } from "./recent"
import { Welcome } from "./Welcome"
import { switchFolder } from "../keymap/commands"
import pkg from "../../package.json"

/** Open Recent Folder (Ctrl+Alt+O): the welcome page over the editor; picking a folder restarts into it. */
export function RecentModal() {
  const ws = useWorkspace()
  const dims = useTerminalDimensions()
  const [recent, setRecent] = useState<RecentFolder[] | null>(null)
  useEffect(() => {
    void loadRecent().then((list) => setRecent(list.filter((r) => r.path !== ws.root)))
  }, [ws])
  if (!recent) return null
  return (
    <box position="absolute" left={0} top={0} width={dims.width} height={dims.height} zIndex={100} backgroundColor={colors.bg}>
      <Welcome
        version={pkg.version}
        recent={recent}
        cwd={ws.root}
        here={false}
        onOpen={(path) => {
          ws.ui.set({ modal: null })
          if (path !== ws.root) switchFolder(ws, path)
        }}
        onForget={(p) => void forgetRecent(p)}
        onQuit={() => ws.ui.set({ modal: null })}
      />
    </box>
  )
}
