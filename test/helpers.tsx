import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { act, type ReactNode } from "react"
import { testRender } from "@opentui/react/test-utils"
import { App, type AppSlots } from "../src/app/App"
import { createWorkspace, WorkspaceContext, type Workspace } from "../src/app/workspace"

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

export type Harness = Awaited<ReturnType<typeof renderApp>>

export async function renderApp(ws: Workspace, slots: AppSlots = {}, size = { width: 140, height: 30 }, extra?: ReactNode) {
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
  const frame = () => setup.captureCharFrame()
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
