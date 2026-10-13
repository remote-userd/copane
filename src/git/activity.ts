import { useEffect, useState, useSyncExternalStore } from "react"
import { Store } from "../app/store"

/**
 * What Source control is doing or just did (pushing, committing, an error). It lives outside the
 * panel: a push keeps going when you close it, and the status bar shows its progress meanwhile.
 */
export interface GitActivity {
  text: string
  kind: "info" | "error" | "busy"
}

export const gitActivity = new Store<{ status: GitActivity | null }>({ status: null })
let clearTimer: ReturnType<typeof setTimeout> | null = null

/** Show a status; an info message clears itself after a few seconds. */
export function setGitActivity(status: GitActivity | null): void {
  if (clearTimer) clearTimeout(clearTimer)
  clearTimer = null
  gitActivity.set({ status })
  if (status?.kind === "info") {
    clearTimer = setTimeout(() => {
      if (gitActivity.get().status === status) gitActivity.set({ status: null })
    }, 4000)
    clearTimer.unref?.()
  }
}

export function useGitActivity(): GitActivity | null {
  return useSyncExternalStore(gitActivity.subscribe, () => gitActivity.get().status)
}

/** Tests: nothing left over from another test. */
export function resetGitActivity(): void {
  setGitActivity(null)
}

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

/** A spinner character that turns while `on` (re-renders only then). */
export function useSpinner(on: boolean): string {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setFrame((f) => f + 1), 100)
    return () => clearInterval(t)
  }, [on])
  return SPINNER[frame % SPINNER.length]!
}
