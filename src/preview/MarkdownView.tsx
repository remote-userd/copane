/**
 * Renders Markdown as terminal layout, the way GitHub shows a README: headings with rules, lists
 * with bullets and checkboxes, quotes and alerts, highlighted code blocks, aligned tables, local
 * images, footnotes, and the common HTML in READMEs (centred blocks, <b>, <br>, <img>, <details>).
 * Parsed with `marked` (GitHub-flavoured), the parser OpenTUI's own markdown element uses.
 */
// readFileSync: images are sized while rendering, which is synchronous; Bun has no sync read.
import { readFileSync } from "node:fs"
import type { ReactNode } from "react"
import { Lexer, type Token, type Tokens } from "marked"
import { imageInfo, pathToFiletype, TextAttributes, type ImageRenderProtocol } from "@opentui/core"
import { ui as colors } from "../config/theme"
import { getSyntaxStyle } from "../editor/syntaxStyle"
import { AnimatedImage } from "./AnimatedImage"
import { imageCells, localImagePath } from "./images"

const { BOLD, ITALIC, UNDERLINE, STRIKETHROUGH, DIM } = TextAttributes
const MAX_IMAGE_ROWS = 20

export interface MdContext {
  /** The Markdown file, for resolving relative image paths. */
  path: string
  /** Columns available, for images, tables and rules. */
  width: number
  protocol: ImageRenderProtocol
  /** Play animated GIFs (while the preview is visible). */
  animate: boolean
}

// ---- inline text ----

interface Style {
  fg?: string
  bg?: string
  attr: number
  link?: string
}
interface Chunk extends Style {
  text: string
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", mdash: "—", ndash: "–", hellip: "…" }
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** Inline HTML tags mapped to styles; anything else is dropped and its text kept. */
const TAG_STYLE: Record<string, Partial<Style>> = {
  b: { attr: BOLD },
  strong: { attr: BOLD },
  i: { attr: ITALIC },
  em: { attr: ITALIC },
  u: { attr: UNDERLINE },
  ins: { attr: UNDERLINE },
  s: { attr: STRIKETHROUGH },
  del: { attr: STRIKETHROUGH },
  strike: { attr: STRIKETHROUGH },
  code: { fg: colors.mdCode, bg: colors.mdCodeBg },
  kbd: { fg: colors.text, bg: colors.segmentBg },
  mark: { fg: colors.bg, bg: colors.mdWarning },
  sup: { fg: colors.accent },
  sub: { fg: colors.dim },
  small: { attr: DIM },
}

const attrOf = (name: string, tag: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))?.slice(2).find((v) => v !== undefined)

class InlineWriter {
  chunks: Chunk[] = []
  /** Open inline HTML tags (<b>…</b> spans several tokens). */
  private tags: { name: string; style: Partial<Style> }[] = []

  constructor(private base: Style) {}

  private style(extra: Style): Style {
    let s: Style = { ...this.base, attr: this.base.attr | extra.attr }
    for (const t of this.tags) s = { ...s, ...t.style, attr: s.attr | (t.style.attr ?? 0) }
    return { ...s, ...(extra.fg ? { fg: extra.fg } : {}), ...(extra.bg ? { bg: extra.bg } : {}), ...(extra.link ? { link: extra.link } : {}), attr: s.attr | extra.attr }
  }

  push(text: string, extra: Style = { attr: 0 }): void {
    if (text) this.chunks.push({ text, ...this.style(extra) })
  }

  html(raw: string, extra: Style): void {
    for (const part of raw.split(/(<[^>]+>)/)) {
      if (!part) continue
      const tag = part.match(/^<(\/?)([a-z][a-z0-9-]*)([^>]*)>$/i)
      if (part.startsWith("<!--")) continue
      if (!tag) {
        this.push(decodeEntities(part), extra)
        continue
      }
      const [, close, rawName] = tag
      const name = rawName!.toLowerCase()
      if (name === "br") this.push("\n", extra)
      else if (name === "img") this.push(`🖼 ${attrOf("alt", part) || "image"}`, { ...extra, fg: colors.mdLink })
      else if (close) {
        const i = this.tags.findLastIndex((t) => t.name === name)
        if (i >= 0) this.tags.splice(i, 1)
      } else if (!part.endsWith("/>")) {
        const href = name === "a" ? attrOf("href", part) : undefined
        this.tags.push({ name, style: href ? { fg: colors.mdLink, attr: UNDERLINE, link: href } : (TAG_STYLE[name] ?? {}) })
      }
    }
  }

  tokens(tokens: Token[] | undefined, extra: Style = { attr: 0 }): void {
    for (const t of tokens ?? []) this.token(t, extra)
  }

  token(t: Token, extra: Style): void {
    switch (t.type) {
      case "text":
        if ("tokens" in t && t.tokens?.length) this.tokens(t.tokens, extra)
        // A line break inside a paragraph is a space, as on GitHub.
        else this.push(decodeEntities(t.text).replace(/\n/g, " "), extra)
        break
      case "escape":
        this.push(decodeEntities(t.text), extra)
        break
      case "strong":
        this.tokens(t.tokens, { ...extra, attr: extra.attr | BOLD })
        break
      case "em":
        this.tokens(t.tokens, { ...extra, attr: extra.attr | ITALIC })
        break
      case "del":
        this.tokens(t.tokens, { ...extra, attr: extra.attr | STRIKETHROUGH })
        break
      case "codespan":
        this.push(decodeEntities(t.text), { ...extra, fg: colors.mdCode, bg: colors.mdCodeBg })
        break
      case "br":
        this.push("\n", extra)
        break
      case "link":
        this.tokens(t.tokens, { ...extra, fg: colors.mdLink, attr: extra.attr | UNDERLINE, link: t.href })
        break
      case "image":
        this.push(`🖼 ${t.text || "image"}`, { ...extra, fg: colors.mdLink, link: extra.link ?? t.href })
        break
      case "html":
        this.html(t.raw, extra)
        break
      case "checkbox":
        break // drawn as the list marker
      default:
        if ("tokens" in t && Array.isArray(t.tokens)) this.tokens(t.tokens, extra)
        else if ("text" in t && typeof t.text === "string") this.push(t.text, extra)
    }
  }
}

function Inline({ tokens, base = { attr: 0 }, align }: { tokens: Token[] | undefined; base?: Style; align?: "left" | "center" | "right" }) {
  const w = new InlineWriter(base)
  w.tokens(tokens)
  // Trailing line breaks (from <br> at the end) would add empty rows.
  while (w.chunks.length && /^\n+$/.test(w.chunks.at(-1)!.text)) w.chunks.pop()
  if (!w.chunks.length) return null
  return (
    <text fg={base.fg ?? colors.text} wrapMode="word" {...(align && align !== "left" ? { alignSelf: align === "center" ? "center" : "flex-end" } : {})}>
      {w.chunks.map((c, i) => (
        <span key={i} fg={c.fg} bg={c.bg} attributes={c.attr} {...(c.link ? { link: { url: c.link } } : {})}>
          {c.text}
        </span>
      ))}
    </text>
  )
}

export function plainText(tokens: Token[] | undefined): string {
  const w = new InlineWriter({ attr: 0 })
  w.tokens(tokens)
  return w.chunks.map((c) => c.text).join("")
}

// ---- footnotes ----

/** Pulls `[^id]: text` definitions out and numbers the `[^id]` references, which marked doesn't know. */
export function extractFootnotes(src: string): { src: string; notes: { n: number; text: string }[] } {
  const defs = new Map<string, string>()
  const body = src.replace(/^\[\^([^\]\s]+)\]:[ \t]*(.*)$/gm, (_m, id: string, text: string) => {
    defs.set(id, text)
    return ""
  })
  const order: string[] = []
  const out = body.replace(/\[\^([^\]\s]+)\](?!:)/g, (m, id: string) => {
    if (!defs.has(id)) return m
    if (!order.includes(id)) order.push(id)
    return `<sup>[${order.indexOf(id) + 1}]</sup>`
  })
  return { src: out, notes: order.map((id, i) => ({ n: i + 1, text: defs.get(id)! })) }
}

// ---- blocks ----

function LocalImages({ images, ctx }: { images: { path: string; w: number; h: number }[]; ctx: MdContext }) {
  return (
    <box flexDirection="row" gap={1} flexWrap="wrap">
      {images.map((img, i) => (
        <AnimatedImage key={i} path={img.path} protocol={ctx.protocol} playing={ctx.animate} {...imageCells(img.w, img.h, ctx.width, MAX_IMAGE_ROWS)} />
      ))}
    </box>
  )
}

/** Local images of a paragraph made only of images (and links around them), or null. */
function paragraphImages(tokens: Token[], ctx: MdContext): { path: string; w: number; h: number }[] | null {
  const found: { path: string; w: number; h: number }[] = []
  const visit = (list: Token[]): boolean =>
    list.every((t) => {
      if (t.type === "text" && !t.raw.trim()) return true
      if (t.type === "br") return true
      if (t.type === "link") return visit(t.tokens ?? [])
      if (t.type === "html") {
        const src = /^<img\b/i.test(t.raw) ? attrOf("src", t.raw) : undefined
        if (/^<\/?(a|p|br)\b[^>]*>$/i.test(t.raw.trim())) return true
        return src ? add(src) : false
      }
      return t.type === "image" ? add(t.href) : false
    })
  const add = (href: string): boolean => {
    const path = localImagePath(href, ctx.path)
    if (!path) return false
    try {
      const info = imageInfo(readFileSync(path))
      found.push({ path, w: info.width, h: info.height })
      return true
    } catch {
      return false
    }
  }
  return visit(tokens) && found.length ? found : null
}

const ALERTS: Record<string, { icon: string; label: string; color: string }> = {
  NOTE: { icon: "ℹ", label: "Note", color: colors.mdNote },
  TIP: { icon: "✦", label: "Tip", color: colors.mdTip },
  IMPORTANT: { icon: "❢", label: "Important", color: colors.mdImportant },
  WARNING: { icon: "⚠", label: "Warning", color: colors.mdWarning },
  CAUTION: { icon: "⛔", label: "Caution", color: colors.mdCaution },
}

function Blockquote({ token, ctx }: { token: Tokens.Blockquote; ctx: MdContext }) {
  const alert = token.text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i)
  const kind = alert ? ALERTS[alert[1]!.toUpperCase()]! : null
  const tokens = kind ? new Lexer({ gfm: true }).lex(token.text.slice(alert![0].length)) : token.tokens
  return (
    <box border={["left"]} borderColor={kind?.color ?? colors.mdRule} paddingLeft={1} flexDirection="column">
      {kind ? (
        <text fg={kind.color} attributes={BOLD}>
          {`${kind.icon} ${kind.label}`}
        </text>
      ) : null}
      <Blocks tokens={tokens} ctx={{ ...ctx, width: ctx.width - 2 }} base={{ fg: kind ? colors.text : colors.dim, attr: 0 }} />
    </box>
  )
}

const BULLETS = ["•", "◦", "▪"]

function List({ token, ctx, depth, base }: { token: Tokens.List; ctx: MdContext; depth: number; base: Style }) {
  const start = typeof token.start === "number" ? token.start : 1
  const markers = token.items.map((item, i) => (item.task ? (item.checked ? "☑" : "☐") : token.ordered ? `${start + i}.` : BULLETS[depth % BULLETS.length]!))
  const markerWidth = Math.max(...markers.map((m) => Bun.stringWidth(m))) + 1
  return (
    <box flexDirection="column" gap={token.loose ? 1 : 0}>
      {token.items.map((item, i) => (
        <box key={i} flexDirection="row">
          <box width={markerWidth} flexShrink={0}>
            <text fg={item.task ? (item.checked ? colors.ok : colors.dim) : colors.mdSubheading}>{markers[i]}</text>
          </box>
          <box flexGrow={1} flexDirection="column" gap={token.loose ? 1 : 0}>
            <Blocks
              tokens={item.tokens}
              ctx={{ ...ctx, width: ctx.width - markerWidth }}
              depth={depth + 1}
              tight={!token.loose}
              base={base}
            />
          </box>
        </box>
      ))}
    </box>
  )
}

function CodeBlock({ token }: { token: Tokens.Code }) {
  const lang = token.lang?.split(/\s/)[0] ?? ""
  const filetype = lang ? (pathToFiletype(`x.${lang}`) ?? lang) : undefined
  return (
    <box backgroundColor={colors.mdCodeBg} paddingLeft={1} paddingRight={1} flexDirection="column">
      {lang ? (
        <box height={1} justifyContent="flex-end" flexDirection="row">
          <text fg={colors.dim}>{lang}</text>
        </box>
      ) : null}
      <code content={token.text} filetype={filetype} syntaxStyle={getSyntaxStyle()} fg={colors.text} />
    </box>
  )
}

function Table({ token, ctx }: { token: Tokens.Table; ctx: MdContext }) {
  const n = token.header.length
  const natural = Array.from({ length: n }, (_, c) =>
    Math.max(3, ...[token.header[c]!, ...token.rows.map((r) => r[c]!)].filter(Boolean).map((cell) => Bun.stringWidth(plainText(cell.tokens)))),
  )
  // Cells get a space either side; shrink the widest columns until the table fits.
  const widths = natural.map((w) => w + 2)
  const room = ctx.width - (n + 1)
  while (widths.reduce((a, b) => a + b, 0) > room) {
    const i = widths.indexOf(Math.max(...widths))
    if (widths[i]! <= 5) break
    widths[i]!--
  }
  const rule = (l: string, m: string, r: string) => l + widths.map((w) => "─".repeat(w)).join(m) + r
  const align = (c: number) => token.align[c] ?? "left"
  const row = (cells: Tokens.TableCell[], header: boolean, key: string) => (
    <box key={key} flexDirection="row">
      {cells.map((cell, c) => (
        <box
          key={c}
          width={widths[c]! + (c === n - 1 ? 2 : 1)}
          border={c === n - 1 ? ["left", "right"] : ["left"]}
          borderColor={colors.mdRule}
          paddingLeft={1}
          paddingRight={1}
          flexDirection="column"
        >
          <Inline tokens={cell.tokens} base={header ? { fg: colors.mdHeading, attr: BOLD } : { attr: 0 }} align={align(c)} />
        </box>
      ))}
    </box>
  )
  return (
    <box flexDirection="column">
      <text fg={colors.mdRule}>{rule("┌", "┬", "┐")}</text>
      {row(token.header, true, "h")}
      <text fg={colors.mdRule}>{rule("├", "┼", "┤")}</text>
      {token.rows.map((r, i) => row(r, false, `r${i}`))}
      <text fg={colors.mdRule}>{rule("└", "┴", "┘")}</text>
    </box>
  )
}

function Heading({ token }: { token: Tokens.Heading }) {
  const d = token.depth
  const base: Style = { fg: d <= 2 ? colors.mdHeading : d === 3 ? colors.mdSubheading : colors.text, attr: BOLD | (d >= 5 ? DIM : 0) }
  // h1 and h2 get a rule underneath, as on GitHub.
  return (
    <box flexDirection="column" {...(d <= 2 ? { border: ["bottom"] as "bottom"[], borderColor: colors.mdRule, borderStyle: d === 1 ? ("heavy" as const) : ("single" as const) } : {})}>
      <Inline tokens={token.tokens} base={base} />
    </box>
  )
}

/** HTML blocks: centring wrappers, <details>, images and line breaks; other tags are dropped. */
function HtmlBlock({ raw, ctx, base }: { raw: string; ctx: MdContext; base: Style }) {
  const text = raw.replace(/<!--[\s\S]*?-->/g, "").trim()
  if (!text) return null
  const imgs = paragraphImages(Lexer.lexInline(text), ctx)
  if (imgs) return <LocalImages images={imgs} ctx={ctx} />
  const summary = text.match(/<summary>([\s\S]*?)<\/summary>/i)
  const inner = (summary ? text.replace(summary[0], "") : text).replace(/<\/?(details|div|p|center|picture|source)\b[^>]*>/gi, "").trim()
  return (
    <box flexDirection="column">
      {summary ? <Inline tokens={Lexer.lexInline(`▸ ${summary[1]!.trim()}`)} base={{ ...base, attr: base.attr | BOLD }} /> : null}
      {inner ? <Blocks tokens={new Lexer({ gfm: true }).lex(inner)} ctx={ctx} base={base} /> : null}
    </box>
  )
}

/** A block-level `<div align="center">` (or <p>, <center>): opens a centred run until its closing tag. */
const CENTER_OPEN = /^<(div|p|center|h[1-6])\b[^>]*(align\s*=\s*["']?center|^<center)[^>]*>\s*$/i
const centerOpen = (raw: string) => CENTER_OPEN.test(raw.trim()) || /^<center>\s*$/i.test(raw.trim())
const blockClose = (raw: string) => /^<\/(div|p|center|h[1-6])>\s*$/i.test(raw.trim())

function Block({ token, ctx, depth, tight, base }: { token: Token; ctx: MdContext; depth: number; tight: boolean; base: Style }): ReactNode {
  switch (token.type) {
    case "heading":
      return <Heading token={token as Tokens.Heading} />
    case "paragraph":
    case "text": {
      const tokens = "tokens" in token && token.tokens ? token.tokens : Lexer.lexInline(token.text)
      const imgs = paragraphImages(tokens, ctx)
      if (imgs) return <LocalImages images={imgs} ctx={ctx} />
      return <Inline tokens={tokens} base={base} />
    }
    case "blockquote":
      return <Blockquote token={token as Tokens.Blockquote} ctx={ctx} />
    case "list":
      return <List token={token as Tokens.List} ctx={ctx} depth={depth} base={base} />
    case "code":
      return <CodeBlock token={token as Tokens.Code} />
    case "table":
      return <Table token={token as Tokens.Table} ctx={ctx} />
    case "hr":
      return <box border={["top"]} borderColor={colors.mdRule} height={1} />
    case "html":
      return <HtmlBlock raw={token.raw} ctx={ctx} base={base} />
    default:
      return null // space, link definitions
  }
}

/**
 * A run of blocks. Blank lines separate them (none inside tight list items), and HTML centring
 * wrappers centre the blocks between their tags.
 */
function Blocks({ tokens, ctx, depth = 0, tight = false, base = { attr: 0 } }: { tokens: Token[]; ctx: MdContext; depth?: number; tight?: boolean; base?: Style }) {
  const groups: { center: boolean; tokens: Token[] }[] = [{ center: false, tokens: [] }]
  let centred = 0
  for (const t of tokens) {
    if (t.type === "space" || t.type === "def") continue
    if (t.type === "html" && centerOpen(t.raw)) {
      centred++
      groups.push({ center: true, tokens: [] })
      continue
    }
    if (t.type === "html" && blockClose(t.raw) && centred) {
      centred--
      groups.push({ center: centred > 0, tokens: [] })
      continue
    }
    groups.at(-1)!.tokens.push(t)
  }
  return (
    <>
      {groups
        .filter((g) => g.tokens.length)
        .map((g, gi) => (
          <box key={gi} flexDirection="column" gap={tight ? 0 : 1} alignItems={g.center ? "center" : "stretch"}>
            {g.tokens.map((t, i) => (
              <Block key={i} token={t} ctx={ctx} depth={depth} tight={tight} base={base} />
            ))}
          </box>
        ))}
    </>
  )
}

export function MarkdownView({ text, ctx }: { text: string; ctx: MdContext }) {
  const { src, notes } = extractFootnotes(text)
  const tokens = new Lexer({ gfm: true }).lex(src)
  return (
    <box flexDirection="column" gap={1}>
      <Blocks tokens={tokens} ctx={ctx} />
      {notes.length ? (
        <box flexDirection="column" border={["top"]} borderColor={colors.mdRule}>
          {notes.map((note) => (
            <box key={note.n} flexDirection="row">
              <box width={String(note.n).length + 3} flexShrink={0}>
                <text fg={colors.accent}>{`[${note.n}]`}</text>
              </box>
              <Inline tokens={Lexer.lexInline(note.text)} base={{ fg: colors.dim, attr: 0 }} />
            </box>
          ))}
        </box>
      ) : null}
    </box>
  )
}
