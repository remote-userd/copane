import { Component, type ReactNode } from "react"
import { useKeyboard } from "@opentui/react"
import { saveForCrash, shutdown } from "./shutdown"
import { ui as colors } from "../config/theme"

function CrashScreen({ error, retry }: { error: Error; retry: () => void }) {
  useKeyboard((key) => {
    if (key.ctrl && (key.name === "q" || key.name === "c")) void shutdown(1)
    else if (key.ctrl && key.name === "r") retry()
  })
  return (
    <box flexDirection="column" flexGrow={1} padding={1} backgroundColor={colors.bg}>
      <text fg={colors.error}>The editor hit an error and stopped rendering. Your open files and unsaved changes are kept.</text>
      <text fg={colors.text}>{error.message}</text>
      <text fg={colors.dim}>{(error.stack ?? "").split("\n").slice(1, 8).join("\n")}</text>
      <box height={1} />
      <text fg={colors.accent}>Ctrl+R: draw the editor again · Ctrl+Q: quit (unsaved changes come back next time)</text>
    </box>
  )
}

/**
 * A render error replaces the app with a crash screen instead of killing it. Unsaved work is
 * backed up right away (it comes back on the next start), and Ctrl+R draws the app again with
 * every buffer as it was: the text stays in the buffer store while the editors are gone.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  override componentDidCatch(): void {
    // After the editors unmounted (they hand their text to the store as they go).
    setTimeout(() => void saveForCrash(), 0)
  }
  override render() {
    return this.state.error ? <CrashScreen error={this.state.error} retry={() => this.setState({ error: null })} /> : this.props.children
  }
}
