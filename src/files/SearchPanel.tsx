import { useEffect, useMemo, useRef, useState } from "react"
import { useKeyboard } from "@opentui/react"
import type { InputRenderable } from "@opentui/core"
import { basename, dirname } from "node:path"
import { HoverBox } from "../app/Modal"
import { useUi, useWorkspace, useCursorStyle } from "../app/workspace"
import { applyToFiles } from "../app/fileEdits"
import { ui as colors } from "../config/theme"
import { openAt } from "../app/navHistory"
import { matcherFor, parseGlobs, replaceInFiles, replaceLines, searchFiles, type Hit, type MatchOptions, type SearchResult } from "./searchFiles"
import type { TreeModel } from "./TreeModel"
import { replaceSeed, selectAllSoon } from "../app/seededInput"
import { closeModal } from "../app/modalStack"

type Field = "query" | "replace" | "files"
type Row = { kind: "file"; path: string; rel: string; count: number } | { kind: "hit"; hit: Hit }

const clip = (s: string) => (s.length > 18 ? s.slice(0, 17) + "…" : s)
const hitKey = (h: Hit) => `${h.path}:${h.line}`
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/** The last search. Toggles and the files field stick; the text comes back only after a cancelled replace (popup). */
const last = { query: "", replaceWith: "", files: "", match: {} as MatchOptions }

/**
 * Keys this panel handles itself (its key handler below), plus text editing in its fields. The
 * app keymap leaves these alone while the SEARCH tab has focus, so keep them in step.
 */
export const SEARCH_PANEL_KEYS = new Set(["escape", "tab", "shift+tab", "return", "ctrl+f", "alt+c", "alt+w", "alt+r", "alt+return", "ctrl+return", "ctrl+a", "ctrl+z", "ctrl+y", "ctrl+c", "ctrl+v", "ctrl+x"])

/** Start the next search fresh (tests). */
export function forgetLastSearch(): void {
  Object.assign(last, { query: "", replaceWith: "", files: "", match: {} })
}

/** A small on/off button, like VS Code's search toggles. */
function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <HoverBox onPress={onPress} bg={on ? colors.accentDim : undefined}>
      <text selectable={false} fg={on ? colors.text : colors.dim}>
        {label}
      </text>
    </HoverBox>
  )
}

function HitText({ hit, selected, replaceWith }: { hit: Hit; selected: boolean; replaceWith: string | null }) {
  // Leading indentation dropped; long text before the match shortened so the match stays visible.
  const lead = hit.text.length - hit.text.trimStart().length
  const pre = hit.text.slice(Math.min(lead, hit.start), hit.start)
  const shown = pre.length > 16 ? "…" + pre.slice(-15) : pre
  const matched = hit.text.slice(hit.start, hit.end)
  return (
    <text selectable={false} wrapMode="none" fg={selected ? colors.text : colors.dim}>
      {"  "}
      {shown}
      {replaceWith === null ? (
        <span fg={colors.warn}>{matched}</span>
      ) : (
        <>
          <span fg={colors.error}>{matched}</span>
          <span fg={colors.accent}>{replaceWith}</span>
        </>
      )}
      {hit.text.slice(hit.end)}
    </text>
  )
}

/**
 * Project search and replace: the SEARCH tab of the left pane (Ctrl+Alt+F), or a popup when
 * the terminal is too narrow for the pane. Mouse: ▸ shows replace, Aa / ab / .* toggle, a
 * result row opens the match, and hovering a row offers ⇄ (replace it) and × (leave it out).
 */
export function SearchPanel({ tree, height, mode }: { tree: TreeModel; height: number; mode: "sidebar" | "popup" }) {
  const cursorStyle = useCursorStyle()
  const ws = useWorkspace()
  const ui = useUi()
  const popup = mode === "popup"
  const restore = popup && ui.modal?.kind === "search" && !!ui.modal.restore
  const active = popup ? ui.modal?.kind === "search" : ui.focus === "tree" && ui.sidebar === "search" && !ui.modal
  const [query, setQuery] = useState(restore ? last.query : "")
  const [replaceWith, setReplaceWith] = useState(restore ? last.replaceWith : "")
  const [filesField, setFilesField] = useState(last.files)
  const [match, setMatch] = useState<MatchOptions>(last.match)
  const [showReplace, setShowReplace] = useState(popup && ui.modal?.kind === "search" && !!ui.modal.replace)
  const [field, setField] = useState<Field>("query")
  const [result, setResult] = useState<SearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState(0)
  /** Hits dismissed with ×: hidden, and left alone by Replace all. */
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  /** Bumped after a replace, to search again. */
  const [version, setVersion] = useState(0)
  const queryInput = useRef<InputRenderable | null>(null)
  /** Remounts the query input when a seed sets its text. */
  const [inputKey, setInputKey] = useState(0)
  /**
   * After a seed the query is shown selected, but the renderer's one selection can't be the
   * input's, so the first key typed does the replacing (as in the find bar).
   */
  const fresh = useRef(false)

  Object.assign(last, { query, replaceWith, files: filesField, match })
  const globs = useMemo(() => parseGlobs(filesField), [filesField])
  const matcher = useMemo(() => (query ? matcherFor(query, match) : null), [query, match])
  const badRegex = typeof matcher === "string" ? matcher : null

  // Ctrl+Alt+F: focus the search field, seeded with the selection; everything in it selected.
  const seed = ui.searchSeed
  useEffect(() => {
    if (!seed || popup) return
    if (seed.replace) setShowReplace(true)
    if (seed.text) {
      setQuery(seed.text)
      setInputKey((k) => k + 1)
    }
    fresh.current = !!(seed.text || query)
    setField("query")
    return selectAllSoon(queryInput)
    // Only on each new seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.n])

  useEffect(() => setDismissed(new Set()), [query, match, globs])

  useEffect(() => {
    if (query.trim().length < 2 || badRegex) {
      setResult(null)
      return
    }
    const ac = new AbortController()
    const t = setTimeout(
      async () => {
        setBusy(true)
        const files = async () => (await tree.files()).files
        const r = await searchFiles(ws.root, query, { signal: ac.signal, files, match, globs })
        if (ac.signal.aborted) return
        setResult(r)
        if (!version) setSel(0)
        setBusy(false)
      },
      version ? 0 : 200,
    )
    return () => {
      clearTimeout(t)
      ac.abort()
    }
    // version: search again after a replace, keeping the selection where it was.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, match, globs, badRegex, ws, tree, version])

  const hits = useMemo(() => (result?.hits ?? []).filter((h) => !dismissed.has(hitKey(h))), [result, dismissed])
  // Grouped by file, like VS Code: a header per file, then its matches (unless collapsed).
  const rows = useMemo(() => {
    const out: Row[] = []
    let i = 0
    while (i < hits.length) {
      const first = hits[i]!
      let j = i
      while (j < hits.length && hits[j]!.path === first.path) j++
      out.push({ kind: "file", path: first.path, rel: first.rel, count: j - i })
      if (!collapsed.has(first.path)) for (let k = i; k < j; k++) out.push({ kind: "hit", hit: hits[k]! })
      i = j
    }
    return out
  }, [hits, collapsed])
  const files = rows.filter((r) => r.kind === "file").length

  const headerRows = 4 + (showReplace ? 1 : 0)
  const listH = Math.max(1, height - headerRows)
  const curSel = Math.min(sel, Math.max(0, rows.length - 1))
  const start = Math.max(0, Math.min(curSel - listH + 1, rows.length - listH))
  const visible = rows.slice(start, start + listH)
  const fields: Field[] = showReplace ? ["query", "replace", "files"] : ["query", "files"]

  const leave = () => (popup ? closeModal(ws) : ws.ui.set({ focus: "editor" }))
  const focusHere = () => !popup && ws.ui.set({ focus: "tree", sidebar: "search" })
  const toggle = (k: keyof MatchOptions) => setMatch((m) => ({ ...m, [k]: k === "caseSensitive" ? (m.caseSensitive ? undefined : true) : !m[k] }))
  /** Ctrl+F keeps the cursor where it is; clicking ▸ puts it in the replace field. */
  const toggleReplace = (focusIt = false) => {
    setShowReplace((r) => !r)
    setField((f) => (showReplace ? (f === "replace" ? "query" : f) : focusIt ? "replace" : f))
  }
  const toggleFile = (path: string) =>
    setCollapsed((c) => {
      const next = new Set(c)
      if (!next.delete(path)) next.add(path)
      return next
    })

  /** Open a match. In the pane the keyboard stays here, so ↓ Enter walks the results. */
  const open = (h: Hit) => {
    void openAt(ws, h.path, h.line, h.startCol, h.endCol).then(() => {
      if (!popup) ws.ui.set({ focus: "tree", sidebar: "search" })
    })
  }
  const choose = (r: Row | undefined) => (r?.kind === "file" ? toggleFile(r.path) : r ? open(r.hit) : undefined)

  /** Preview of the replacement for one hit (regex groups expanded), or null when not replacing. */
  const preview = (h: Hit): string | null => {
    if (!showReplace || typeof matcher !== "object" || !matcher) return null
    if (!match.regex) return replaceWith
    return h.text.slice(h.start, h.end).replace(new RegExp(matcher.source, matcher.flags.replace("g", "")), replaceWith)
  }

  const skipFor = (path: string) => new Set((result?.hits ?? []).filter((h) => h.path === path && dismissed.has(hitKey(h))).map((h) => h.line))

  /** ⇄ on a match: replace just it. ⇄ on a file: every match in it but the dismissed ones. */
  const replaceRow = async (r: Row) => {
    if (typeof matcher !== "object" || !matcher) return
    const re = matcher
    const regex = !!match.regex
    const path = r.kind === "file" ? r.path : r.hit.path
    const change =
      r.kind === "file"
        ? (text: string) => replaceLines(text, re, replaceWith, regex, { skip: skipFor(path) }).text
        : (text: string) => replaceLines(text, re, replaceWith, regex, { only: r.hit.line }).text
    const n = await applyToFiles(ws, new Map([[path, change]]))
    const where = r.kind === "file" ? r.rel : `${r.hit.rel}:${r.hit.line + 1}`
    if (n) ws.notify(`Replaced in ${where}${ws.buffers.byPath(path) ? " (Ctrl+Z undoes)" : ""}`)
    setVersion((v) => v + 1)
  }

  const dismiss = (r: Row) =>
    setDismissed((d) => {
      const next = new Set(d)
      for (const h of r.kind === "file" ? hits.filter((h) => h.path === r.path) : [r.hit]) next.add(hitKey(h))
      return next
    })

  const replaceAll = async () => {
    if (!showReplace || !hits.length || badRegex) return
    const files = async () => (await tree.files()).files
    const skip = new Map<string, Set<number>>()
    for (const h of result?.hits ?? []) if (dismissed.has(hitKey(h))) skip.set(h.path, (skip.get(h.path) ?? new Set()).add(h.line))
    const plan = await replaceInFiles(ws.root, query, replaceWith, { files, match, globs, skip })
    if (typeof plan === "string") return ws.notify(plan, "error")
    if (!plan.size) return ws.notify("Nothing to replace")
    ws.ui.set({
      modal: {
        // From the popup: Escape or Cancel bring it back with its fields.
        ...(popup ? { back: { kind: "search", replace: true, restore: true } } : {}),
        kind: "confirm",
        title: "Replace in files",
        body: `${plural(plan.size, "file")}: "${clip(query)}" → "${clip(replaceWith)}"${dismissed.size ? ` (${dismissed.size} skipped)` : ""}`,
        options: [
          {
            key: "y",
            label: "Replace all",
            run: async () => {
              ws.ui.set({ modal: null })
              const n = await applyToFiles(ws, plan)
              ws.notify(`Replaced in ${plural(n, "file")} (open files: Ctrl+Z undoes)`)
              setVersion((v) => v + 1)
            },
          },
          { key: "n", label: "Cancel", run: () => closeModal(ws) },
        ],
      },
    })
  }

  useKeyboard((key) => {
    if (!active) return
    if (fresh.current && field === "query") {
      fresh.current = false
      if (replaceSeed(key, queryInput.current, () => setQuery(""))) return
    }
    let handled = true
    if (key.name === "escape") leave()
    else if (key.ctrl && key.name === "f") toggleReplace()
    else if (key.meta && key.name === "c") toggle("caseSensitive")
    else if (key.meta && key.name === "w") toggle("wholeWord")
    else if (key.meta && key.name === "r") toggle("regex")
    else if (key.name === "tab") {
      const i = fields.indexOf(field)
      setField(fields[(i + (key.shift ? fields.length - 1 : 1)) % fields.length]!)
    } else if (key.name === "return" && (key.meta || key.ctrl)) void replaceAll()
    else if (key.name === "return") choose(rows[curSel])
    else if (key.name === "down") setSel(Math.min(rows.length - 1, curSel + 1))
    else if (key.name === "up") setSel(Math.max(0, curSel - 1))
    else if (key.name === "pagedown") setSel(Math.min(rows.length - 1, curSel + listH))
    else if (key.name === "pageup") setSel(Math.max(0, curSel - listH))
    else handled = false
    if (handled) {
      key.preventDefault()
      key.stopPropagation()
    }
  })

  const more = result?.truncated ? "+" : ""
  const slow = result?.engine === "builtin" ? " (install ripgrep for speed)" : ""
  const status = badRegex
    ? `Invalid regex: ${badRegex}`
    : query.trim().length < 2
      ? popup
        ? "Type at least 2 characters"
        : "Type to search all files"
      : busy && !result
        ? "Searching…"
        : popup
          ? `${hits.length}${more} result${hits.length === 1 ? "" : "s"} in ${plural(files, "file")}${dismissed.size ? `, ${dismissed.size} dismissed` : ""}${slow}`
          : // The pane is narrow: short form.
            `${hits.length}${more} in ${plural(files, "file")}${dismissed.size ? ` · ${dismissed.size} hidden` : ""}${slow}`

  const input = (f: Field, placeholder: string, value: string, onInput: (v: string) => void, ref?: typeof queryInput, key?: number) => (
    <box
      flexGrow={1}
      flexShrink={1}
      height={1}
      onMouseDown={() => {
        setField(f)
        focusHere()
      }}
    >
      <input
        cursorStyle={cursorStyle}
        key={key}
        ref={ref}
        focused={active && field === f}
        value={value}
        placeholder={placeholder}
        backgroundColor={colors.bg}
        focusedBackgroundColor={colors.bg}
        textColor={colors.text}
        onInput={onInput}
      />
    </box>
  )

  const rowButtons = (r: Row) => (
    <>
      {showReplace ? (
        <HoverBox onPress={() => void replaceRow(r)} paddingX={1} hoverBg={colors.accentDim}>
          <text selectable={false} fg={colors.accent}>
            ⇄
          </text>
        </HoverBox>
      ) : null}
      <HoverBox onPress={() => dismiss(r)} paddingX={1} hoverBg={colors.accentDim}>
        <text selectable={false} fg={colors.dim}>
          ×
        </text>
      </HoverBox>
    </>
  )

  return (
    <box flexDirection="column" flexGrow={1} overflow="hidden" onMouseDown={focusHere}>
      <box height={1} flexDirection="row" gap={1}>
        <Toggle label={showReplace ? "▾" : "▸"} on={false} onPress={() => toggleReplace(true)} />
        {input("query", popup ? "Search text in all files…" : "Search", query, setQuery, queryInput, inputKey)}
        <box flexDirection="row" flexShrink={0} gap={1}>
          <Toggle label="Aa" on={!!match.caseSensitive} onPress={() => toggle("caseSensitive")} />
          <Toggle label="ab" on={!!match.wholeWord} onPress={() => toggle("wholeWord")} />
          <Toggle label=".*" on={!!match.regex} onPress={() => toggle("regex")} />
        </box>
      </box>
      {showReplace ? (
        <box height={1} flexDirection="row" gap={1}>
          <box width={1} flexShrink={0} />
          {input("replace", "Replace with…", replaceWith, setReplaceWith)}
          <HoverBox onPress={() => void replaceAll()} paddingX={popup ? 1 : 0} bg={hits.length ? colors.accentDim : undefined}>
            <text selectable={false} fg={hits.length ? colors.text : colors.dim}>
              {popup ? "Replace all" : "⇄ All"}
            </text>
          </HoverBox>
        </box>
      ) : null}
      <box height={1} flexDirection="row" gap={1}>
        <box width={1} flexShrink={0} />
        {input("files", popup ? "Files to include, e.g. src/**, !*.test.ts" : "files: src/**, !*.test.ts", filesField, setFilesField)}
      </box>
      <box height={1} overflow="hidden">
        <text selectable={false} wrapMode="none" fg={badRegex ? colors.error : colors.dim}>
          {status}
        </text>
      </box>
      <box
        flexDirection="column"
        flexGrow={1}
        overflow="hidden"
        onMouseScroll={(e) => {
          e.stopPropagation()
          const d = e.scroll?.direction === "up" ? -1 : 1
          setSel(Math.max(0, Math.min(rows.length - 1, curSel + d)))
        }}
      >
        {visible.map((r, i) => {
          const idx = start + i
          const selected = idx === curSel
          const isFile = r.kind === "file"
          return (
            <box
              key={isFile ? r.path : hitKey(r.hit)}
              height={1}
              flexDirection="row"
              overflow="hidden"
              backgroundColor={selected ? (active ? colors.selectionBg : colors.tabActiveBg) : undefined}
              onMouseOver={() => setSel(idx)}
            >
              <box
                flexGrow={1}
                flexShrink={1}
                overflow="hidden"
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  focusHere()
                  choose(r)
                }}
              >
                {isFile ? (
                  <text selectable={false} wrapMode="none" fg={colors.text}>
                    <span fg={colors.dim}>{collapsed.has(r.path) ? "▸ " : "▾ "}</span>
                    {basename(r.rel)}
                    <span fg={colors.dim}> {dirname(r.rel) === "." ? "" : dirname(r.rel)}</span>
                  </text>
                ) : (
                  <HitText hit={r.hit} selected={selected} replaceWith={preview(r.hit)} />
                )}
              </box>
              {selected ? rowButtons(r) : isFile ? (
                <box flexShrink={0} paddingRight={1}>
                  <text selectable={false} fg={colors.dim}>
                    {r.count}
                  </text>
                </box>
              ) : null}
            </box>
          )
        })}
      </box>
    </box>
  )
}
