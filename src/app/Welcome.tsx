import { useRef, useState } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import type { InputRenderable } from "@opentui/core"
import { readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { ui as colors } from "../config/theme"
import { tildify, type RecentFolder } from "./recent"

/**
 * What `ce` shows when started without a folder (as VS Code's Welcome page): recently opened
 * folders to pick from, the folder you are in, or one you type. The editor itself starts once
 * one is chosen (main.tsx).
 */
export function Welcome({
  version,
  recent: initial,
  cwd,
  here = true,
  onOpen,
  onForget,
  onQuit,
}: {
  version: string
  recent: RecentFolder[]
  cwd: string
  /** Offer "Open current folder" (not from inside the editor, where that folder is already open). */
  here?: boolean
  onOpen: (path: string) => void
  onForget?: (path: string) => void
  onQuit: () => void
}) {
  const dims = useTerminalDimensions()
  const [recent, setRecent] = useState(initial)
  const [sel, setSel] = useState(0)
  const [top, setTop] = useState(0)
  const [typing, setTyping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const input = useRef<InputRenderable | null>(null)

  // The rows: each recent folder, then the actions.
  const CWD = here ? recent.length : -1
  const TYPE = recent.length + (here ? 1 : 0)
  const count = TYPE + 1
  const width = Math.min(90, Math.max(30, dims.width - 4))
  // Title, blank, heading, (list), blank, two actions, blank, help line, and some air.
  const listH = Math.max(3, Math.min(recent.length || 1, dims.height - 12))

  const move = (i: number) => {
    const next = Math.max(0, Math.min(count - 1, i))
    setSel(next)
    if (next < recent.length) setTop((t) => (next < t ? next : next >= t + listH ? next - listH + 1 : t))
  }
  const activate = (i: number) => {
    if (i < recent.length) onOpen(recent[i]!.path)
    else if (i === CWD) onOpen(cwd)
    else {
      setTyping(true)
      setError(null)
      setHint(null)
    }
  }
  const forget = (i: number) => {
    const r = recent[i]
    if (!r) return
    onForget?.(r.path)
    const rest = recent.filter((_, j) => j !== i)
    setRecent(rest)
    setSel(Math.min(i, rest.length + (here ? 1 : 0)))
    setTop((t) => Math.max(0, Math.min(t, rest.length - listH)))
  }

  /** What the typed path means: `~` is home, a relative path starts at the current folder. */
  const resolveTyped = (text: string) => {
    const t = text.trim()
    if (t === "~" || t.startsWith("~/")) return join(homedir(), t.slice(1))
    return resolve(cwd, t)
  }
  const submitTyped = async () => {
    const text = input.current?.value ?? ""
    if (!text.trim()) return setError("Type a folder path")
    const path = resolveTyped(text)
    const st = await Bun.file(path)
      .stat()
      .catch(() => null)
    if (!st) return setError(`No such folder: ${tildify(path)}`)
    if (!st.isDirectory()) return setError(`Not a folder: ${tildify(path)}`)
    onOpen(path)
  }
  /** Tab: complete the folder name being typed (as a shell does), or list the choices. */
  const complete = async () => {
    const el = input.current
    if (!el) return
    const text = el.value
    const slash = text.lastIndexOf("/")
    const typedDir = slash >= 0 ? text.slice(0, slash + 1) : ""
    const prefix = text.slice(slash + 1)
    const dir = typedDir ? resolveTyped(typedDir) : cwd
    const names = await readdir(dir, { withFileTypes: true })
      .then((ds) => ds.filter((d) => d.isDirectory() && d.name.startsWith(prefix) && (prefix.startsWith(".") || !d.name.startsWith("."))).map((d) => d.name))
      .catch(() => [] as string[])
    if (!names.length) return setHint("No folder matches")
    let common = names[0]!
    for (const n of names) while (!n.startsWith(common)) common = common.slice(0, -1)
    const done = names.length === 1 ? `${typedDir}${common}/` : `${typedDir}${common}`
    el.value = done
    el.setCursor(0, done.length)
    setHint(names.length > 1 ? names.sort().slice(0, 8).join("  ") + (names.length > 8 ? "  …" : "") : null)
  }

  useKeyboard((key) => {
    const stop = () => {
      key.preventDefault()
      key.stopPropagation()
    }
    if (typing) {
      if (key.name === "escape") {
        stop()
        setTyping(false)
        setError(null)
        setHint(null)
      } else if (key.name === "return") {
        stop()
        void submitTyped()
      } else if (key.name === "tab") {
        stop()
        void complete()
      } else if (error || hint) {
        setError(null)
        setHint(null)
      }
      return
    }
    if (key.name === "escape" || (key.ctrl && (key.name === "q" || key.name === "c"))) {
      stop()
      return onQuit()
    }
    if (key.ctrl || key.meta) return
    stop()
    if (key.name === "up" || key.name === "k") move(sel - 1)
    else if (key.name === "down" || key.name === "j") move(sel + 1)
    else if (key.name === "return") activate(sel)
    else if (key.name === "delete" || key.name === "backspace") forget(sel)
    else if (key.name === "o") activate(TYPE)
    else if (key.sequence === "." && here) activate(CWD)
    else if (/^[1-9]$/.test(key.name)) {
      const i = Number(key.name) - 1
      if (i < recent.length) activate(i)
    }
  })

  const row = (i: number, label: string, detail: string, key: string) => {
    const on = sel === i && !typing
    return (
      <box
        key={`${i}:${label}`}
        height={1}
        flexDirection="row"
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={on ? colors.selectionBg : undefined}
        onMouseOver={() => !typing && setSel(i)}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          activate(i)
        }}
      >
        <box width={4} flexShrink={0}>
          <text selectable={false} fg={colors.accent}>
            {key}
          </text>
        </box>
        <box flexShrink={0}>
          <text selectable={false} fg={colors.text}>
            {label}
          </text>
        </box>
        <box flexGrow={1} flexShrink={1} overflow="hidden" paddingLeft={2}>
          <text selectable={false} wrapMode="none" truncate fg={colors.dim}>
            {detail}
          </text>
        </box>
      </box>
    )
  }

  const shown = recent.slice(top, top + listH)
  return (
    <box flexGrow={1} backgroundColor={colors.bg} alignItems="center" justifyContent="center">
      <box
        width={width}
        flexDirection="column"
        onMouseScroll={(e) => {
          e.stopPropagation()
          const d = e.scroll?.direction === "up" ? -1 : e.scroll?.direction === "down" ? 1 : 0
          setTop((t) => Math.max(0, Math.min(Math.max(0, recent.length - listH), t + d)))
        }}
      >
        <text selectable={false} fg={colors.accent}>
          <strong>copane</strong>
          <span fg={colors.dim}>{`  ${version} · pick a folder to open`}</span>
        </text>
        <box height={1} />
        <text selectable={false} fg={colors.headerFg}>
          Recent
        </text>
        {recent.length ? (
          shown.map((r, j) => row(top + j, basename(r.path) || r.path, tildify(dirname(r.path)), top + j < 9 ? String(top + j + 1) : ""))
        ) : (
          <box height={1} paddingLeft={1}>
            <text selectable={false} fg={colors.dim}>
              No recent folders yet: they show here once you have opened some.
            </text>
          </box>
        )}
        <box height={1} />
        {here ? row(CWD, "Open current folder", tildify(cwd), ".") : null}
        {row(TYPE, "Open folder…", "type a path (Tab completes)", "o")}
        {typing ? (
          <box flexDirection="column" paddingLeft={5}>
            <box border={["left"]} borderColor={colors.accent} height={1}>
              <input
                ref={input}
                focused
                placeholder="~/code/project"
                backgroundColor={colors.bg}
                focusedBackgroundColor={colors.bg}
                textColor={colors.text}
                onInput={() => error && setError(null)}
              />
            </box>
            {error ? (
              <text selectable={false} fg={colors.error}>
                {error}
              </text>
            ) : hint ? (
              <text selectable={false} wrapMode="none" truncate fg={colors.dim}>
                {hint}
              </text>
            ) : null}
          </box>
        ) : null}
        <box height={1} />
        <text selectable={false} fg={colors.dim} wrapMode="none" truncate>
          {typing
            ? "⏎ open · Tab complete · Esc back"
            : `↑↓ choose · ⏎ open · 1-9 recent · Del forget${here ? " · . here" : ""} · o type a path · Esc ${here ? "quit" : "back"}`}
        </text>
      </box>
    </box>
  )
}
