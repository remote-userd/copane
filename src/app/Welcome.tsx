import { useEffect, useRef, useState, type ReactNode } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import type { InputRenderable } from "@opentui/core"
import { readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { ui as colors } from "../config/theme"
import { HoverBox } from "./Modal"
import { tildify, type RecentFolder } from "./recent"

/**
 * What `ce` shows when started without a folder (as VS Code's Welcome page): recently opened
 * folders, the folder you are in, or one picked in a folder browser. Everything works with the
 * mouse as well as the keys. The editor itself starts once a folder is chosen (main.tsx).
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
  const [browsing, setBrowsing] = useState(false)
  const [sel, setSel] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const [top, setTop] = useState(0)
  const branches = useBranches(recent)

  const width = Math.min(88, Math.max(40, dims.width - 4))
  // The card's frame, title, tagline, buttons, heading and gaps, plus the hints under it.
  const listH = Math.max(1, Math.min(recent.length || 1, dims.height - 16))

  const move = (i: number) => {
    if (!recent.length) return
    const next = Math.max(0, Math.min(recent.length - 1, i))
    setSel(next)
    setTop((t) => (next < t ? next : next >= t + listH ? next - listH + 1 : t))
  }
  const forget = (i: number) => {
    const r = recent[i]
    if (!r) return
    onForget?.(r.path)
    const rest = recent.filter((_, j) => j !== i)
    setRecent(rest)
    setSel(Math.max(0, Math.min(i, rest.length - 1)))
    setTop((t) => Math.max(0, Math.min(t, rest.length - listH)))
  }

  useKeyboard((key) => {
    if (browsing) return
    const stop = () => {
      key.preventDefault()
      key.stopPropagation()
    }
    if (key.name === "escape" || (key.ctrl && (key.name === "q" || key.name === "c"))) {
      stop()
      return onQuit()
    }
    if (key.ctrl || key.meta) return
    stop()
    if (key.name === "up" || key.name === "k") move(sel - 1)
    else if (key.name === "down" || key.name === "j") move(sel + 1)
    else if (key.name === "pageup") move(sel - listH)
    else if (key.name === "pagedown") move(sel + listH)
    else if (key.name === "return") recent[sel] ? onOpen(recent[sel]!.path) : setBrowsing(true)
    else if (key.name === "delete") forget(sel)
    else if (key.name === "o") setBrowsing(true)
    else if (key.sequence === "." && here) onOpen(cwd)
    else if (/^[1-9]$/.test(key.name)) {
      const r = recent[Number(key.name) - 1]
      if (r) onOpen(r.path)
    }
  })

  if (browsing) return <FolderBrowser start={cwd} width={width} onOpen={onOpen} onBack={() => setBrowsing(false)} />

  const nameW = Math.min(24, Math.max(8, ...recent.map((r) => Bun.stringWidth(basename(r.path)))))
  const recentRow = (r: RecentFolder, i: number) => {
    const on = i === sel
    const hovered = hover === i
    const branch = branches.get(r.path)
    return (
      <box
        key={r.path}
        height={1}
        flexDirection="row"
        paddingLeft={1}
        backgroundColor={on ? colors.selectionBg : hovered ? colors.tabActiveBg : undefined}
        onMouseOver={() => {
          setHover(i)
          setSel(i)
        }}
        onMouseOut={() => setHover((h) => (h === i ? null : h))}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (e.button === 0) onOpen(r.path)
        }}
      >
        <box width={3} flexShrink={0}>
          <text selectable={false} fg={on ? colors.accent : colors.dim}>
            {i < 9 ? String(i + 1) : ""}
          </text>
        </box>
        <box width={nameW + 2} flexShrink={0} overflow="hidden">
          <text selectable={false} wrapMode="none" truncate fg={colors.text}>
            {on ? <strong>{basename(r.path) || r.path}</strong> : basename(r.path) || r.path}
          </text>
        </box>
        <box flexGrow={1} flexShrink={1} overflow="hidden">
          <text selectable={false} wrapMode="none" truncate fg={colors.dim}>
            {tildify(dirname(r.path))}
          </text>
        </box>
        {branch ? (
          <box flexShrink={0} paddingLeft={2}>
            <text selectable={false} fg={colors.ok} wrapMode="none">
              {`⎇ ${branch.length > 18 ? branch.slice(0, 17) + "…" : branch}`}
            </text>
          </box>
        ) : null}
        <box width={9} flexShrink={0} flexDirection="row" justifyContent="flex-end">
          <text selectable={false} fg={colors.dim}>
            {ago(r.openedAt)}
          </text>
        </box>
        {/* Remove from the list: shown on the row under the pointer or the selection. */}
        <box width={4} flexShrink={0} flexDirection="row" justifyContent="flex-end" paddingRight={1}>
          {on || hovered ? (
            <HoverBox onPress={(b) => b === 0 && forget(i)} hoverBg={colors.accentDim}>
              <text selectable={false} fg={colors.error}>
                {" × "}
              </text>
            </HoverBox>
          ) : null}
        </box>
      </box>
    )
  }

  const shown = recent.slice(top, top + listH)
  const more = recent.length - top - shown.length
  return (
    <Screen>
      <box
        width={width}
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={colors.border}
        backgroundColor={colors.panelBg}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        onMouseScroll={(e) => {
          e.stopPropagation()
          const d = e.scroll?.direction === "up" ? -1 : e.scroll?.direction === "down" ? 1 : 0
          setTop((t) => Math.max(0, Math.min(Math.max(0, recent.length - listH), t + d)))
        }}
      >
        <text selectable={false}>
          <span fg={colors.accent}>
            <strong>◆ copane</strong>
          </span>
          <span fg={colors.dim}>{`  v${version}`}</span>
        </text>
        <text selectable={false} fg={colors.dim}>
          A code editor with your AI beside it. Open a project to start.
        </text>
        <box height={1} />
        <box flexDirection="row" gap={2} flexWrap="wrap">
          <Button label="Open folder…" keyHint="o" strong onPress={() => setBrowsing(true)} />
          {here ? <Button label={`Open ${basename(cwd) || cwd}`} keyHint="." onPress={() => onOpen(cwd)} /> : null}
        </box>
        <box height={1} />
        <box height={1} flexDirection="row">
          <box flexGrow={1}>
            <text selectable={false} fg={colors.headerFg}>
              <strong>RECENT</strong>
            </text>
          </box>
          {recent.length > listH ? (
            <text selectable={false} fg={colors.dim}>
              {`${top + 1}–${top + shown.length} of ${recent.length}`}
            </text>
          ) : null}
        </box>
        {recent.length ? (
          shown.map((r, j) => recentRow(r, top + j))
        ) : (
          <box height={1} paddingLeft={1}>
            <text selectable={false} fg={colors.dim}>
              Nothing yet: folders you open show up here.
            </text>
          </box>
        )}
        {more > 0 ? (
          <box height={1} paddingLeft={4}>
            <text selectable={false} fg={colors.dim}>{`↓ ${more} more (scroll)`}</text>
          </box>
        ) : null}
      </box>
      <Hints
        items={[
          ["↑↓", "choose"],
          ["⏎", "open"],
          ["Del", "remove", () => forget(sel)],
          ["o", "browse", () => setBrowsing(true)],
          ...(here ? ([[".", "this folder", () => onOpen(cwd)]] as const) : []),
          ["Esc", here ? "quit" : "back", onQuit],
        ]}
      />
    </Screen>
  )
}

/**
 * Pick a folder by browsing (VS Code's Open Folder): the path field and the list follow each
 * other. Typing filters the folders, a click or Enter goes into one, `open` on a row (or the
 * first row, for the folder shown) opens it.
 */
function FolderBrowser({ start, width, onOpen, onBack }: { start: string; width: number; onOpen: (path: string) => void; onBack: () => void }) {
  const dims = useTerminalDimensions()
  const input = useRef<InputRenderable | null>(null)
  const [text, setText] = useState(withSlash(tildify(start)))
  const [names, setNames] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState(0)
  const [top, setTop] = useState(0)
  const [hover, setHover] = useState<number | null>(null)

  const slash = text.lastIndexOf("/")
  const dirText = text.slice(0, slash + 1)
  const filter = text.slice(slash + 1)
  const dir = expand(dirText || ".", start)

  useEffect(() => {
    let live = true
    setNames(null)
    setError(null)
    void listFolders(dir).then((r) => {
      if (!live) return
      if (typeof r === "string") setError(r)
      setNames(typeof r === "string" ? [] : r)
    })
    return () => {
      live = false
    }
  }, [dir])

  const f = filter.toLowerCase()
  const matches = (names ?? []).filter((n) => n.toLowerCase().startsWith(f) && (f.startsWith(".") || !n.startsWith(".")))
  type Row = { kind: "open" } | { kind: "up" } | { kind: "dir"; name: string }
  const rows: Row[] = [{ kind: "open" }, ...(dir !== "/" ? [{ kind: "up" } as const] : []), ...matches.map((name) => ({ kind: "dir" as const, name }))]
  const firstDir = rows.findIndex((r) => r.kind === "dir")
  const listH = Math.max(3, Math.min(rows.length, dims.height - 12))

  // Typing a name selects the first folder it matches; a fresh folder starts on "Open".
  useEffect(() => {
    setSel(filter && firstDir >= 0 ? firstDir : 0)
    setTop(0)
  }, [text, names])

  const go = (path: string) => {
    const next = withSlash(tildify(path))
    setText(next)
    const el = input.current
    if (el) {
      el.value = next
      el.setCursor(0, next.length)
    }
  }
  const activate = (r: Row | undefined) => {
    if (!r) return
    if (r.kind === "open") return error ? undefined : onOpen(dir)
    if (r.kind === "up") return go(dirname(dir))
    go(join(dir, r.name))
  }
  const move = (i: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, i))
    setSel(next)
    setTop((t) => (next < t ? next : next >= t + listH ? next - listH + 1 : t))
  }
  /** Tab: go into the one folder the name matches, or complete what they share. */
  const complete = () => {
    if (matches.length === 1) return go(join(dir, matches[0]!))
    if (!matches.length) return
    let common = matches[0]!
    for (const n of matches) while (!n.toLowerCase().startsWith(common.toLowerCase())) common = common.slice(0, -1)
    if (common.length > filter.length) {
      const next = dirText + common
      setText(next)
      if (input.current) {
        input.current.value = next
        input.current.setCursor(0, next.length)
      }
    }
  }

  useKeyboard((key) => {
    const stop = () => {
      key.preventDefault()
      key.stopPropagation()
    }
    if (key.name === "escape") return (stop(), onBack())
    if (key.name === "up") return (stop(), move(sel - 1))
    if (key.name === "down") return (stop(), move(sel + 1))
    if (key.name === "pageup") return (stop(), move(sel - listH))
    if (key.name === "pagedown") return (stop(), move(sel + listH))
    if (key.name === "tab") return (stop(), complete())
    if (key.name === "return") {
      stop()
      // Ctrl/Alt+Enter: open the selected folder itself rather than going into it.
      const r = rows[sel]
      if ((key.meta || key.ctrl) && r?.kind === "dir") return onOpen(join(dir, r.name))
      return activate(r)
    }
    // Backspace on an empty name goes up a folder, as in a file dialog.
    if (key.name === "backspace" && !filter && dir !== "/") return (stop(), go(dirname(dir)))
  })

  const shown = rows.slice(top, top + listH)
  const rowView = (r: Row, i: number) => {
    const on = i === sel
    const hovered = hover === i
    // The path is in the field above: the first row only names the folder.
    const label = r.kind === "open" ? `Open this folder (${basename(dir) || dir})` : r.kind === "up" ? ".." : r.name
    const icon = r.kind === "open" ? "✓" : r.kind === "up" ? "↑" : "▸"
    return (
      <box
        key={r.kind === "dir" ? `d:${r.name}` : r.kind}
        height={1}
        flexDirection="row"
        paddingLeft={1}
        backgroundColor={on ? colors.selectionBg : hovered ? colors.tabActiveBg : undefined}
        onMouseOver={() => {
          setHover(i)
          setSel(i)
        }}
        onMouseOut={() => setHover((h) => (h === i ? null : h))}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (e.button === 0) activate(r)
        }}
      >
        <box width={3} flexShrink={0}>
          <text selectable={false} fg={r.kind === "open" ? colors.ok : colors.accent}>
            {icon}
          </text>
        </box>
        <box flexGrow={1} flexShrink={1} overflow="hidden">
          <text selectable={false} wrapMode="none" truncate fg={r.kind === "open" ? colors.ok : colors.text}>
            {r.kind === "open" && on ? <strong>{label}</strong> : label}
          </text>
        </box>
        {/* Open a listed folder straight away, without going into it first. */}
        {r.kind === "dir" && (on || hovered) ? (
          <HoverBox onPress={(b) => b === 0 && onOpen(join(dir, r.name))} paddingX={1} bg={colors.segmentBg}>
            <text selectable={false} fg={colors.text}>
              open
            </text>
          </HoverBox>
        ) : null}
      </box>
    )
  }

  return (
    <Screen>
      <box
        width={width}
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={colors.borderFocused}
        backgroundColor={colors.panelBg}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        onMouseScroll={(e) => {
          e.stopPropagation()
          const d = e.scroll?.direction === "up" ? -3 : e.scroll?.direction === "down" ? 3 : 0
          setTop((t) => Math.max(0, Math.min(Math.max(0, rows.length - listH), t + d)))
        }}
      >
        <box height={1} flexDirection="row">
          <box flexGrow={1}>
            <text selectable={false} fg={colors.accent}>
              <strong>Open folder</strong>
            </text>
          </box>
          <HoverBox onPress={(b) => b === 0 && onBack()} paddingX={1}>
            <text selectable={false} fg={colors.dim}>
              ← back
            </text>
          </HoverBox>
        </box>
        <box height={1} />
        <box border={["left"]} borderColor={colors.accent} height={1} paddingLeft={1}>
          <input
            ref={input}
            focused
            value={text}
            backgroundColor={colors.panelBg}
            focusedBackgroundColor={colors.panelBg}
            textColor={colors.text}
            onInput={(v) => setText(v)}
          />
        </box>
        <box height={1} paddingLeft={2}>
          <text selectable={false} fg={error ? colors.error : colors.dim} wrapMode="none" truncate>
            {error ?? (names === null ? "Reading…" : `${matches.length} folder${matches.length === 1 ? "" : "s"}${filter ? ` matching “${filter}”` : ""}`)}
          </text>
        </box>
        {shown.map((r, j) => rowView(r, top + j))}
      </box>
      <Hints
        items={[
          ["↑↓", "choose"],
          ["⏎", "go in / open"],
          ["Alt+⏎", "open selected"],
          ["Tab", "complete"],
          ["⌫", "up"],
          ["Esc", "back", onBack],
        ]}
      />
    </Screen>
  )
}

/** The page: everything centred on the editor's background. */
function Screen({ children }: { children: ReactNode }) {
  return (
    <box flexGrow={1} flexDirection="column" backgroundColor={colors.bg} alignItems="center" justifyContent="center">
      {children}
    </box>
  )
}

function Button({ label, keyHint, strong, onPress }: { label: string; keyHint: string; strong?: boolean; onPress: () => void }) {
  return (
    <HoverBox onPress={(b) => b === 0 && onPress()} paddingX={2} bg={strong ? colors.accentDim : colors.segmentBg}>
      <text selectable={false} fg={colors.text}>
        {strong ? <strong>{label}</strong> : label}
        <span fg={colors.dim}>{`  ${keyHint}`}</span>
      </text>
    </HoverBox>
  )
}

/** Key hints under the card; the ones with an action are buttons too. */
function Hints({ items }: { items: readonly (readonly [string, string, (() => void)?])[] }) {
  return (
    <box height={1} flexDirection="row" marginTop={1} gap={1}>
      {items.map(([key, what, run]) => {
        const label = (
          <text selectable={false} fg={colors.dim}>
            <span fg={colors.headerFg}>{key}</span>
            {` ${what}`}
          </text>
        )
        return run ? (
          <HoverBox key={key} onPress={(b) => b === 0 && run()} paddingX={1}>
            {label}
          </HoverBox>
        ) : (
          <box key={key} paddingLeft={1} paddingRight={1}>
            {label}
          </box>
        )
      })}
    </box>
  )
}

/** Each recent folder's git branch, read from .git/HEAD (no git process). */
function useBranches(recent: RecentFolder[]): Map<string, string> {
  const [branches, setBranches] = useState(new Map<string, string>())
  useEffect(() => {
    let live = true
    void Promise.all(
      recent.map(async (r) => {
        const head = await Bun.file(join(r.path, ".git", "HEAD"))
          .text()
          .catch(() => null)
        const ref = head && /^ref: refs\/heads\/(.+)$/m.exec(head)?.[1]
        return [r.path, ref ?? (head ? head.trim().slice(0, 7) : null)] as const
      }),
    ).then((list) => {
      if (live) setBranches(new Map(list.filter((e): e is readonly [string, string] => !!e[1])))
    })
    return () => {
      live = false
    }
  }, [recent])
  return branches
}

/** The folders in a folder, sorted, or why it can't be read. */
async function listFolders(dir: string): Promise<string[] | string> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const out: string[] = []
    for (const e of entries) {
      if (e.isDirectory()) out.push(e.name)
      else if (e.isSymbolicLink()) {
        const st = await Bun.file(join(dir, e.name))
          .stat()
          .catch(() => null)
        if (st?.isDirectory()) out.push(e.name)
      }
    }
    return out.sort((a, b) => a.localeCompare(b))
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return code === "ENOENT" ? `No such folder: ${tildify(dir)}` : code === "ENOTDIR" ? `Not a folder: ${tildify(dir)}` : `Can't read ${tildify(dir)}`
  }
}

/** A typed path: `~` is home, a relative one starts at `base`. */
function expand(text: string, base: string): string {
  const t = text.trim()
  if (t === "~" || t.startsWith("~/")) return resolve(join(homedir(), t.slice(1)))
  return resolve(base, t)
}

const withSlash = (p: string) => (p.endsWith("/") ? p : p + "/")

/** "2h ago" for a time in the past. */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 14) return `${d}d ago`
  if (d < 60) return `${Math.round(d / 7)}w ago`
  return `${Math.round(d / 30)}mo ago`
}
