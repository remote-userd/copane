import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { act, type ReactNode } from "react"
import { testRender } from "@opentui/react/test-utils"
import { App, type AppSlots } from "../src/app/App"
import { createWorkspace, WorkspaceContext, type Workspace } from "../src/app/workspace"
import { configSchema } from "../src/config/schema"
import { resetAgentTabs } from "../src/ai/TerminalPane"
import { resetNavHistory } from "../src/app/navHistory"
import { windowFocus } from "../src/app/windowFocus"
import { resetMultiEdit } from "../src/editor/MultiEdit"
import { resetConflicts } from "../src/git/conflictActions"
import { resetCommitDraft } from "../src/git/SourceControlPanel"
import { resetGitActivity } from "../src/git/activity"
import { resetCompletion } from "../src/lsp/CompletionPopup"
import { resetKeyPlatform } from "../src/keymap/platform"

/**
 * Environment for git commands in tests: a fixed author, and no optional locks (a test's own
 * `git status` must not take the index lock while the app commits, which made commits flaky).
 */
/** A config whose editor shows with no file open (editor.startHidden defaults to true). */
export const editorShown = () => configSchema.parse({ editor: { startHidden: false } })

export const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "T",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "T",
  GIT_COMMITTER_EMAIL: "t@t",
  GIT_OPTIONAL_LOCKS: "0",
}

export async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cedit-fx-"))
  for (const [p, c] of Object.entries(files)) {
    await mkdir(dirname(join(root, p)), { recursive: true })
    await writeFile(join(root, p), c)
  }
  return root
}

export function numbered(n: number): string {
  return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n"
}

/**
 * Wait until `cond` holds, calling `render` between checks. Throws when it never does: a silent
 * timeout would surface later as a confusing failed expect (or a test that hits Bun's 5 s limit).
 */
export async function waitUntil(cond: () => boolean | Promise<boolean>, ms = 4000, render?: () => unknown): Promise<void> {
  const end = Date.now() + ms
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`Timed out after ${ms} ms waiting for: ${cond.toString().replace(/\s+/g, " ").slice(0, 160)}`)
    await Bun.sleep(25)
    await render?.()
  }
}

/**
 * The screen as text. A render the app asked for itself (a notice, a timer) may still be writing
 * its output on a slow machine: the capture is refused then (OutputBusy), so try again shortly.
 */
export function captureFrame(setup: { captureCharFrame(): string }): string {
  for (let tries = 0; ; tries++) {
    try {
      return setup.captureCharFrame()
    } catch (err) {
      if (tries >= 200 || !String((err as Error).message).includes("OutputBusy")) throw err
      Bun.sleepSync(5)
    }
  }
}

export type Harness = Awaited<ReturnType<typeof renderApp>>

/**
 * Some state lives at module level (shared by every workspace in the process): reset it so a
 * test starts the way the app does, whatever the previous test left behind.
 */
export function resetModuleState(): void {
  resetAgentTabs()
  resetConflicts()
  resetCommitDraft()
  resetGitActivity()
  resetNavHistory()
  resetMultiEdit()
  resetCompletion()
  windowFocus.set({ focused: true })
  resetKeyPlatform()
}

export async function renderApp(ws: Workspace, slots: AppSlots = {}, size = { width: 140, height: 30 }, extra?: ReactNode) {
  resetModuleState()
  const setup = await testRender(
    <WorkspaceContext.Provider value={ws}>
      <App slots={slots} />
      {extra}
    </WorkspaceContext.Provider>,
    // Like the real app: Ctrl+C is an editor key, not "quit".
    { ...size, exitOnCtrlC: false },
  )
  await Bun.sleep(30)
  await setup.renderOnce()
  const frame = () => captureFrame(setup)
  const lines = () => frame().split("\n")
  /** Screen position of the first occurrence of text. */
  const find = (text: string) => {
    const ls = lines()
    for (let y = 0; y < ls.length; y++) {
      const x = ls[y]!.indexOf(text)
      if (x >= 0) return { x, y }
    }
    throw new Error(`"${text}" not on screen:\n${frame()}`)
  }
  /** Like find, but only matches at or right of column minX and at or below row minY. */
  const findAt = (text: string, minX = 0, minY = 0) => {
    const ls = lines()
    for (let y = minY; y < ls.length; y++) {
      const x = ls[y]!.indexOf(text, minX)
      if (x >= 0) return { x, y }
    }
    throw new Error(`"${text}" not on screen right of ${minX}, below ${minY}:\n${frame()}`)
  }
  const step = async (fn: () => unknown | Promise<unknown>) => {
    await act(async () => {
      await fn()
      await Bun.sleep(10)
    })
    await setup.renderOnce()
  }
  return { setup, ws, frame, lines, find, findAt, step, mouse: setup.mockMouse, keys: setup.mockInput }
}

export { createWorkspace }
