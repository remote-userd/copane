import { Component, type ReactNode } from "react"
import { useKeyboard } from "@opentui/react"
import { shutdown } from "./shutdown"
import { ui as colors } from "../config/theme"

function CrashScreen({ error }: { error: Error }) {
  useKeyboard((key) => {
    if (key.ctrl && (key.name === "q" || key.name === "c")) void shutdown(1)
  })
  return (
    <box flexDirection="column" flexGrow={1} padding={1} backgroundColor={colors.bg}>
      <text fg={colors.error}>The editor hit an error and stopped rendering. Unsaved changes may be lost.</text>
      <text fg={colors.text}>{error.message}</text>
      <text fg={colors.dim}>{(error.stack ?? "").split("\n").slice(1, 8).join("\n")}</text>
      <box height={1} />
      <text fg={colors.accent}>Press Ctrl+Q to quit.</text>
    </box>
  )
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  override render() {
    return this.state.error ? <CrashScreen error={this.state.error} /> : this.props.children
  }
}
