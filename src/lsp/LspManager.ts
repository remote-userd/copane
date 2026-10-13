import type { BufferStore } from "../editor/BufferStore"
import { RpcConnection } from "./rpc"
import { basename } from "node:path"
import { installHint, serverFor, type LspOverrides, type ServerSpec } from "./servers"
import { workspaceEditFiles, type TextEdit } from "./edits"

export interface Position {
  line: number
  /** UTF-16 code units, which is also the JS string index within the line. */
  character: number
}
export interface Range {
  start: Position
  end: Position
}
export interface Diagnostic {
  range: Range
  /** 1 error, 2 warning, 3 info, 4 hint. */
  severity?: number
  message: string
  source?: string
  code?: string | number
}
export interface CompletionItem {
  label: string
  kind?: number
  detail?: string
  sortText?: string
  filterText?: string
  insertText?: string
  textEdit?: { range?: Range; insert?: Range; replace?: Range; newText: string }
  labelDetails?: { detail?: string; description?: string }
}
export interface SymbolEntry {
  name: string
  /** LSP SymbolKind. */
  kind: number
  path: string
  line: number
  /** UTF-16 index within the line. */
  character: number
  container: string
}

export interface SignatureInfo {
  label: string
  /** Start/end of the active parameter within `label`. */
  active: [number, number] | null
  doc: string | null
  count: number
}
/** An LSP CodeAction (or a bare Command, which has `command` as a string). */
export interface CodeAction {
  title: string
  kind?: string
  isPreferred?: boolean
  diagnostics?: Diagnostic[]
  disabled?: { reason: string }
  edit?: Parameters<typeof workspaceEditFiles>[0]
  command?: LspCommand | string
  arguments?: unknown[]
  data?: unknown
}
export interface LspCommand {
  title?: string
  command: string
  arguments?: unknown[]
}

export interface Location {
  path: string
  range: Range
}

type Listener = () => void

const uriOf = (path: string) => Bun.pathToFileURL(path).href
const pathOf = (uri: string) => {
  try {
    return Bun.fileURLToPath(uri)
  } catch {
    return uri
  }
}

/** One running language server. */
class Client {
  rpc: RpcConnection | null = null
  ready: Promise<boolean>
  caps: Record<string, unknown> = {}
  state: "starting" | "ready" | "failed" = "starting"
  pullTimer: ReturnType<typeof setTimeout> | null = null
  pullOthersTimer: ReturnType<typeof setTimeout> | null = null
  lastPullOthers = 0
  /** Set while no document is open: the server is stopped when it fires. */
  idleTimer: ReturnType<typeof setTimeout> | null = null
  /** Documents changed since their diagnostics were last pulled. */
  readonly pullNow = new Set<string>()
  private proc: { kill(signal?: number | NodeJS.Signals): void; exitCode: number | null } | null = null
  private stopping = false

  constructor(
    readonly spec: ServerSpec,
    root: string,
    onDiagnostics: (path: string, diags: Diagnostic[], version?: number) => void,
    onState: () => void,
    private onApplyEdit: (files: Map<string, TextEdit[]>) => void = () => {},
    /** The server went away on its own (crashed, or closed its output). */
    private onDied: () => void = () => {},
  ) {
    this.ready = this.start(root, onDiagnostics).then(
      (ok) => {
        this.state = ok ? "ready" : "failed"
        onState()
        return ok
      },
      () => {
        this.state = "failed"
        onState()
        return false
      },
    )
  }

  private async start(root: string, onDiagnostics: (path: string, diags: Diagnostic[], version?: number) => void): Promise<boolean> {
    let proc
    try {
      proc = Bun.spawn(this.spec.command, { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "ignore" })
    } catch {
      return false
    }
    this.proc = proc
    const rpc = new RpcConnection(proc as never, (method, params) => {
      // Defaults everywhere, except: renaming a symbol renames it (not just a local import alias).
      if (method === "workspace/configuration")
        return ((params as { items?: { section?: string }[] })?.items ?? []).map((item) =>
          /^(typescript|javascript|js\/ts)$/.test(item.section ?? "") ? { preferences: { useAliasesForRenames: false } } : null,
        )
      // A command (from a code action) asks us to change files.
      if (method === "workspace/applyEdit") {
        const edit = (params as { edit?: Parameters<typeof workspaceEditFiles>[0] })?.edit
        if (edit) this.onApplyEdit(new Map([...workspaceEditFiles(edit)].map(([uri, edits]) => [pathOf(uri), edits])))
        return { applied: true }
      }
      return null
    })
    rpc.onClose = () => {
      this.state = "failed"
      if (this.stopping) return
      // It closed its output but may still run (hung): make sure it's gone, then let the manager
      // restart it (on a later tick: this can run inside the constructor, when the server dies at once).
      this.kill()
      setTimeout(() => this.onDied(), 0)
    }
    this.rpc = rpc
    rpc.on("textDocument/publishDiagnostics", (p) => {
      const { uri, diagnostics, version } = p as { uri: string; diagnostics: Diagnostic[]; version?: number }
      onDiagnostics(pathOf(uri), diagnostics ?? [], version)
    })
    const rootUri = uriOf(root)
    const init = await rpc.request<{ capabilities: Record<string, unknown> }>(
      "initialize",
      {
        processId: process.pid,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: basename(root) || "workspace" }],
        ...(this.spec.initializationOptions ? { initializationOptions: this.spec.initializationOptions } : {}),
        capabilities: {
          general: { positionEncodings: ["utf-16"] },
          workspace: { workspaceFolders: true, configuration: true, symbol: {}, applyEdit: true, workspaceEdit: { documentChanges: true } },
          textDocument: {
            synchronization: { didSave: false, dynamicRegistration: false },
            publishDiagnostics: { relatedInformation: false },
            diagnostic: { dynamicRegistration: false },
            completion: { completionItem: { snippetSupport: false, labelDetailsSupport: true } },
            hover: { contentFormat: ["plaintext", "markdown"] },
            definition: {},
            references: {},
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            signatureHelp: { signatureInformation: { parameterInformation: { labelOffsetSupport: true } } },
            rename: { prepareSupport: false },
            formatting: {},
            codeAction: {
              codeActionLiteralSupport: {
                codeActionKind: { valueSet: ["quickfix", "refactor", "refactor.extract", "refactor.inline", "refactor.rewrite", "source", "source.organizeImports", "source.fixAll"] },
              },
              isPreferredSupport: true,
              disabledSupport: true,
              dataSupport: true,
              resolveSupport: { properties: ["edit"] },
            },
          },
        },
      },
      30_000,
    )
    this.caps = init?.capabilities ?? {}
    rpc.notify("initialized", {})
    return true
  }

  get pullsDiagnostics(): boolean {
    return !!this.caps.diagnosticProvider
  }

  stop(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (this.pullTimer) clearTimeout(this.pullTimer)
    if (this.pullOthersTimer) clearTimeout(this.pullOthersTimer)
    this.stopping = true
    const rpc = this.rpc
    if (!rpc || rpc.isClosed) return this.kill()
    void rpc
      .request("shutdown", null, 1000)
      .catch(() => null)
      .then(() => {
        rpc.notify("exit", null)
        rpc.close()
        // A server that ignores "exit" (busy, hung) would run on with no one to talk to.
        setTimeout(() => this.kill(), 2000).unref?.()
      })
  }

  private kill(): void {
    if (this.proc && this.proc.exitCode === null) {
      try {
        this.proc.kill("SIGKILL")
      } catch {
        // already gone
      }
    }
  }
}

interface OpenDoc {
  client: Client
  version: number
  languageId: string
  changeTimer: ReturnType<typeof setTimeout> | null
  /** Current text, for sending a pending change right away. */
  text: (() => string) | null
  /** Last documentSymbol answer, for the version it was asked at. */
  symbols?: { version: number; symbols: Promise<unknown[] | null> }
}

/** One client per server, project (package) and command: a monorepo gets one per package. */
const clientKey = (spec: ServerSpec) => `${spec.key}\0${spec.root ?? ""}\0${spec.command.join(" ")}`

/**
 * Language servers for the workspace: starts one per language and project (each package of a
 * monorepo) on first use, keeps open buffers in sync, collects diagnostics (pushed or pulled),
 * and answers editor requests.
 */
export class LspManager {
  private clients = new Map<string, Client>()
  private docs = new Map<string, OpenDoc>()
  private diags = new Map<string, Diagnostic[]>()
  /** Applies edits a server asks for (workspace/applyEdit, from code action commands). */
  onApplyEdit: ((files: Map<string, TextEdit[]>) => void | Promise<unknown>) | null = null
  private listeners = new Set<Listener>()
  private snapshot = 0
  private unsubs: (() => void)[] = []
  private stopped = false
  /** Recent crashes per server: a server that keeps dying is left stopped. */
  private crashes = new Map<string, number[]>()
  private resync: (() => void) | null = null
  /** Paths whose server is still being looked up (so a second sync does not open them twice). */
  private opening = new Set<string>()
  /** Files whose language has no server (looked up once). */
  private noServer = new Set<string>()
  /** A file's language has no server installed: told once per language, with what to install. */
  onMissing: ((filetype: string, hint: string) => void) | null = null
  private told = new Set<string>()
  /** A server with no open documents is stopped after this long (they can hold a lot of memory). */
  idleStopMs = 60_000
  private buffers: BufferStore | null = null

  constructor(
    readonly root: string,
    private overrides: LspOverrides = {},
    private resolve: (filetype: string | undefined, path: string) => ServerSpec | null | Promise<ServerSpec | null> = (ft, path) => serverFor(ft, root, overrides, path),
  ) {}

  subscribe = (l: Listener) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  getSnapshot = () => this.snapshot
  private emit() {
    this.snapshot++
    for (const l of this.listeners) l()
  }

  /** Follow the buffer store: open, change, rename and close documents. */
  attach(buffers: BufferStore): void {
    this.buffers = buffers
    const sync = () => {
      const open = new Map(buffers.list().map((b) => [b.path, b]))
      for (const path of [...this.docs.keys()]) if (!open.has(path)) this.close(path)
      for (const b of open.values()) if (!this.docs.has(b.path)) this.open(b.path, b.filetype, () => buffers.textOf(b))
    }
    this.resync = sync
    this.unsubs.push(buffers.subscribe(sync))
    this.unsubs.push(
      buffers.onText((id) => {
        const b = buffers.byId(id)
        if (b) this.change(b.path, () => buffers.textOf(b))
      }),
    )
    sync()
  }

  private open(path: string, filetype: string | undefined, text: () => string): void {
    if (this.stopped || this.opening.has(path) || this.noServer.has(path)) return
    this.opening.add(path)
    void Promise.resolve(this.resolve(filetype, path)).then((spec) => {
      this.opening.delete(path)
      if (!spec) this.noServer.add(path)
      if (!spec && filetype && !this.stopped) this.missing(filetype)
      // The buffer may have been closed (or opened elsewhere) while looking up its server.
      if (!spec || !filetype || this.stopped || this.docs.has(path) || (this.buffers && !this.buffers.byPath(path))) return
      this.start(path, filetype, spec, text)
    })
  }

  private missing(filetype: string): void {
    const hint = this.overrides[filetype] === undefined ? installHint(filetype) : null
    if (!hint || this.told.has(hint)) return
    this.told.add(hint)
    this.onMissing?.(filetype, hint)
  }

  private start(path: string, filetype: string, spec: ServerSpec, text: () => string): void {
    const key = clientKey(spec)
    let client = this.clients.get(key)
    if (!client && this.gaveUp(key)) return
    if (!client) {
      client = new Client(
        spec,
        spec.root ?? this.root,
        (p, d, version) => {
          // Diagnostics for a version the editor has since changed are stale: newer ones follow.
          const doc = this.docs.get(p)
          if (version === undefined || !doc || version >= doc.version) this.setDiagnostics(p, d)
        },
        () => this.emit(),
        (files) => this.onApplyEdit?.(files),
        () => this.died(key, created),
      )
      const created: Client = client
      this.clients.set(key, client)
      this.emit()
    }
    if (client.idleTimer) clearTimeout(client.idleTimer)
    client.idleTimer = null
    const doc: OpenDoc = { client, version: 1, languageId: spec.languages[filetype] ?? filetype, changeTimer: null, text: null }
    this.docs.set(path, doc)
    void client.ready.then((ok) => {
      if (!ok || this.docs.get(path) !== doc) return
      client.rpc!.notify("textDocument/didOpen", { textDocument: { uri: uriOf(path), languageId: doc.languageId, version: doc.version, text: text() } })
      this.schedulePull(client, path)
    })
  }

  /**
   * A server crashed: forget its documents and their (now stale) diagnostics, and start it again
   * for the open files. One that dies 3 times in 5 minutes stays stopped (its state says failed).
   */
  private died(key: string, client: Client): void {
    if (this.stopped || this.clients.get(key) !== client) return
    this.clients.delete(key)
    for (const [path, doc] of [...this.docs]) {
      if (doc.client !== client) continue
      if (doc.changeTimer) clearTimeout(doc.changeTimer)
      this.docs.delete(path)
      this.diags.delete(path)
    }
    this.crashes.set(key, [...(this.crashes.get(key) ?? []), Date.now()])
    this.emit()
    // A moment's pause, so a server that dies at start can't spin.
    if (!this.gaveUp(key)) setTimeout(() => !this.stopped && this.resync?.(), 500).unref?.()
  }

  /** Crashed 3 times in the last 5 minutes: not started again for now. */
  private gaveUp(key: string): boolean {
    const now = Date.now()
    const recent = (this.crashes.get(key) ?? []).filter((t) => now - t < 5 * 60_000)
    this.crashes.set(key, recent)
    return recent.length >= 3
  }

  private change(path: string, text: () => string): void {
    const doc = this.docs.get(path)
    if (!doc) return
    doc.text = text
    if (doc.changeTimer) clearTimeout(doc.changeTimer)
    doc.changeTimer = setTimeout(() => {
      doc.changeTimer = null
      void doc.client.ready.then((ok) => {
        if (!ok || this.docs.get(path) !== doc) return
        doc.version++
        doc.client.rpc!.notify("textDocument/didChange", {
          textDocument: { uri: uriOf(path), version: doc.version },
          contentChanges: [{ text: text() }],
        })
        this.schedulePull(doc.client, path)
      })
    }, 120)
  }

  private close(path: string): void {
    const doc = this.docs.get(path)
    if (!doc) return
    if (doc.changeTimer) clearTimeout(doc.changeTimer)
    this.docs.delete(path)
    this.pulls.delete(path)
    if (this.diags.delete(path)) this.emit()
    void doc.client.ready.then((ok) => ok && doc.client.rpc!.notify("textDocument/didClose", { textDocument: { uri: uriOf(path) } }))
    if (![...this.docs.values()].some((d) => d.client === doc.client)) this.stopWhenIdle(doc.client)
  }

  /** The server's last document closed: stop it unless another opens soon. */
  private stopWhenIdle(client: Client): void {
    if (client.idleTimer) clearTimeout(client.idleTimer)
    client.idleTimer = setTimeout(() => {
      client.idleTimer = null
      const key = clientKey(client.spec)
      if (this.clients.get(key) !== client || [...this.docs.values()].some((d) => d.client === client)) return
      this.clients.delete(key)
      client.stop()
      this.emit()
    }, this.idleStopMs)
    client.idleTimer.unref?.()
  }

  /**
   * Servers with pull diagnostics: re-ask for the changed document soon, and for the server's
   * other open documents (an edit can fix or break them too) once typing has been quiet a while.
   * Asking for every document after each pause kept the server busy re-checking them all.
   */
  private schedulePull(client: Client, changed: string): void {
    if (!client.pullsDiagnostics) return
    client.pullNow.add(changed)
    if (client.pullTimer) clearTimeout(client.pullTimer)
    client.pullTimer = setTimeout(() => {
      client.pullTimer = null
      const paths = [...client.pullNow]
      client.pullNow.clear()
      for (const path of paths) this.pull(client, path)
    }, 250)
    // Other open files may be affected too (an export renamed): re-check them after a pause, but
    // at most every 10 s, or an agent editing all day keeps the server re-checking everything.
    if (client.pullOthersTimer) clearTimeout(client.pullOthersTimer)
    const wait = Math.max(2000, client.lastPullOthers + 10_000 - Date.now())
    client.pullOthersTimer = setTimeout(() => {
      client.pullOthersTimer = null
      client.lastPullOthers = Date.now()
      for (const [path, doc] of this.docs) if (doc.client === client && path !== changed) this.pull(client, path)
    }, wait)
  }

  /** The latest diagnostics request per path: a slow answer to an older one must not overwrite it. */
  private pulls = new Map<string, number>()
  private pullSeq = 0

  private pull(client: Client, path: string): void {
    if (!this.docs.has(path)) return
    const seq = ++this.pullSeq
    this.pulls.set(path, seq)
    void client
      .rpc!.request<{ kind?: string; items?: Diagnostic[] }>("textDocument/diagnostic", { textDocument: { uri: uriOf(path) } })
      .then((r) => {
        if (this.pulls.get(path) !== seq) return
        this.pulls.delete(path)
        if (r?.kind === "full" && this.docs.has(path)) this.setDiagnostics(path, r.items ?? [])
      })
      .catch(() => null)
  }

  private setDiagnostics(path: string, diags: Diagnostic[]): void {
    // Only keep diagnostics for open files; the tree and editor show those.
    if (!this.docs.has(path)) return
    // Hints (severity 4, e.g. "declared but never used") are not problems; leave them out.
    const next = diags.filter((d) => (d.severity ?? 1) < 4)
    // Servers often send the same list again; nothing to redraw then.
    if (Bun.deepEquals(this.diags.get(path) ?? [], next)) return
    this.diags.set(path, next)
    this.emit()
  }

  diagnostics(path: string): Diagnostic[] {
    return this.diags.get(path) ?? []
  }

  /** Every diagnostic in open files, errors first. */
  allDiagnostics(): { path: string; diag: Diagnostic }[] {
    const out: { path: string; diag: Diagnostic }[] = []
    for (const [path, list] of this.diags) for (const diag of list) out.push({ path, diag })
    return out.sort((a, b) => (a.diag.severity ?? 1) - (b.diag.severity ?? 1) || a.path.localeCompare(b.path) || a.diag.range.start.line - b.diag.range.start.line)
  }

  counts(): { errors: number; warnings: number } {
    let errors = 0
    let warnings = 0
    for (const list of this.diags.values())
      for (const d of list) {
        if ((d.severity ?? 1) === 1) errors++
        else if (d.severity === 2) warnings++
      }
    return { errors, warnings }
  }

  /** Short status for the status bar: which servers run, or failed. */
  status(): string {
    const parts: string[] = []
    // A package's server says which package: "typescript:backend".
    const label = (spec: ServerSpec) => (spec.root && spec.root !== this.root ? `${spec.key}:${basename(spec.root)}` : spec.key)
    for (const c of this.clients.values()) parts.push(c.state === "ready" ? label(c.spec) : c.state === "starting" ? `${label(c.spec)}…` : `${label(c.spec)} ✗`)
    for (const key of this.crashes.keys()) if (!this.clients.has(key) && this.gaveUp(key)) parts.push(`${key.split("\0")[0]} ✗`)
    return parts.join(" ")
  }

  hasServer(path: string): boolean {
    return this.docs.has(path)
  }

  /** Make sure the server has the latest text before asking it something. */
  private async flush(path: string): Promise<OpenDoc | null> {
    const doc = this.docs.get(path)
    if (!doc) return null
    if (!(await doc.client.ready)) return null
    if (doc.changeTimer && doc.text) {
      clearTimeout(doc.changeTimer)
      doc.changeTimer = null
      doc.version++
      doc.client.rpc!.notify("textDocument/didChange", { textDocument: { uri: uriOf(path), version: doc.version }, contentChanges: [{ text: doc.text() }] })
      this.schedulePull(doc.client, path)
    }
    return doc
  }

  async completion(path: string, pos: Position): Promise<CompletionItem[]> {
    // flush sends the pending edit (the character just typed) once; the text is read only then.
    const doc = await this.flush(path)
    if (!doc) return []
    try {
      const r = await doc.client.rpc!.request<CompletionItem[] | { items: CompletionItem[] } | null>("textDocument/completion", {
        textDocument: { uri: uriOf(path) },
        position: pos,
      })
      return Array.isArray(r) ? r : (r?.items ?? [])
    } catch {
      return []
    }
  }

  async hover(path: string, pos: Position): Promise<string | null> {
    const doc = await this.flush(path)
    if (!doc) return null
    try {
      const r = await doc.client.rpc!.request<{ contents: unknown } | null>("textDocument/hover", { textDocument: { uri: uriOf(path) }, position: pos })
      return r ? hoverText(r.contents) : null
    } catch {
      return null
    }
  }

  async definition(path: string, pos: Position): Promise<Location | null> {
    const doc = await this.flush(path)
    if (!doc) return null
    try {
      type Loc = { uri?: string; range?: Range; targetUri?: string; targetSelectionRange?: Range }
      const r = await doc.client.rpc!.request<Loc | Loc[] | null>("textDocument/definition", { textDocument: { uri: uriOf(path) }, position: pos })
      const first = Array.isArray(r) ? r[0] : r
      if (!first) return null
      const uri = first.targetUri ?? first.uri
      const range = first.targetSelectionRange ?? first.range
      return uri && range ? { path: pathOf(uri), range } : null
    } catch {
      return null
    }
  }

  /** Every symbol in a file, flattened (classes and their members), in file order. */
  async documentSymbols(path: string): Promise<SymbolEntry[]> {
    const doc = await this.flush(path)
    if (!doc) return []
    try {
      type DocSym = { name: string; kind: number; range: Range; selectionRange?: Range; children?: DocSym[] }
      type SymInfo = { name: string; kind: number; location: { range: Range }; containerName?: string }
      const r = await doc.client.rpc!.request<(DocSym | SymInfo)[] | null>("textDocument/documentSymbol", { textDocument: { uri: uriOf(path) } })
      const out: SymbolEntry[] = []
      const walk = (list: DocSym[], container: string) => {
        for (const s of list) {
          const at = (s.selectionRange ?? s.range).start
          out.push({ name: s.name, kind: s.kind, path, line: at.line, character: at.character, container })
          if (s.children) walk(s.children, container ? `${container}.${s.name}` : s.name)
        }
      }
      if (r?.length && "location" in (r[0] as object))
        for (const s of r as SymInfo[]) out.push({ name: s.name, kind: s.kind, path, line: s.location.range.start.line, character: s.location.range.start.character, container: s.containerName ?? "" })
      else walk((r ?? []) as DocSym[], "")
      return out.sort((a, b) => a.line - b.line)
    } catch {
      return []
    }
  }

  /** Symbols across the project matching `query` (through the server of an open file). */
  async workspaceSymbols(query: string, viaPath: string): Promise<SymbolEntry[]> {
    const doc = await this.flush(viaPath)
    if (!doc) return []
    try {
      type SymInfo = { name: string; kind: number; location: { uri: string; range?: Range }; containerName?: string }
      const r = await doc.client.rpc!.request<SymInfo[] | null>("workspace/symbol", { query }, 15_000)
      return (r ?? []).slice(0, 300).map((s) => ({
        name: s.name,
        kind: s.kind,
        path: pathOf(s.location.uri),
        line: s.location.range?.start.line ?? 0,
        character: s.location.range?.start.character ?? 0,
        container: s.containerName ?? "",
      }))
    } catch {
      return []
    }
  }

  /** Names of the symbols (outermost first) that contain `pos`, e.g. ["Cart", "total"]. */
  async symbolPath(path: string, pos: Position): Promise<string[]> {
    const doc = await this.flush(path)
    if (!doc) return []
    try {
      type DocSym = { name: string; range: Range; children?: DocSym[] }
      type SymInfo = { name: string; location: { range: Range }; containerName?: string }
      // Breadcrumbs ask each time the cursor settles; the symbols only change with the text.
      if (doc.symbols?.version !== doc.version) {
        const symbols = doc.client.rpc!.request<(DocSym | SymInfo)[] | null>("textDocument/documentSymbol", { textDocument: { uri: uriOf(path) } })
        doc.symbols = { version: doc.version, symbols }
        // A failed request is asked again next time.
        symbols.catch(() => {
          if (doc.symbols?.symbols === symbols) doc.symbols = undefined
        })
      }
      return symbolPathAt((await doc.symbols.symbols) ?? [], pos)
    } catch {
      return []
    }
  }

  /** The call signature around the cursor: label, the active parameter's span within it, and docs. */
  async signatureHelp(path: string, pos: Position): Promise<SignatureInfo | null> {
    const doc = await this.flush(path)
    if (!doc) return null
    try {
      type Param = { label: string | [number, number] }
      type Sig = { label: string; parameters?: Param[]; documentation?: unknown; activeParameter?: number }
      const r = await doc.client.rpc!.request<{ signatures: Sig[]; activeSignature?: number; activeParameter?: number } | null>(
        "textDocument/signatureHelp",
        { textDocument: { uri: uriOf(path) }, position: pos },
      )
      const sig = r?.signatures?.[r.activeSignature ?? 0]
      if (!sig) return null
      const active = sig.activeParameter ?? r?.activeParameter ?? 0
      const param = sig.parameters?.[active]
      let span: [number, number] | null = null
      if (Array.isArray(param?.label)) span = param.label
      else if (typeof param?.label === "string") {
        const i = sig.label.indexOf(param.label)
        if (i >= 0) span = [i, i + param.label.length]
      }
      const docText = hoverText(sig.documentation)
      return { label: sig.label, active: span, doc: docText, count: r!.signatures.length }
    } catch {
      return null
    }
  }

  async references(path: string, pos: Position): Promise<Location[]> {
    const doc = await this.flush(path)
    if (!doc) return []
    try {
      const r = await doc.client.rpc!.request<{ uri: string; range: Range }[] | null>("textDocument/references", {
        textDocument: { uri: uriOf(path) },
        position: pos,
        context: { includeDeclaration: true },
      })
      return (r ?? []).map((l) => ({ path: pathOf(l.uri), range: l.range }))
    } catch {
      return []
    }
  }

  /** Edits per file path for renaming the symbol at `pos`, or an error message. */
  async rename(path: string, pos: Position, newName: string): Promise<Map<string, TextEdit[]> | string> {
    const doc = await this.flush(path)
    if (!doc) return "No language server for this file"
    try {
      const r = await doc.client.rpc!.request<Parameters<typeof workspaceEditFiles>[0] | null>("textDocument/rename", {
        textDocument: { uri: uriOf(path) },
        position: pos,
        newName,
      })
      if (!r) return "Nothing to rename here"
      return new Map([...workspaceEditFiles(r)].map(([uri, edits]) => [pathOf(uri), edits]))
    } catch (err) {
      return (err as Error).message
    }
  }

  async format(path: string, tabSize = 2): Promise<TextEdit[] | null> {
    const doc = await this.flush(path)
    if (!doc) return null
    try {
      return (
        (await doc.client.rpc!.request<TextEdit[] | null>("textDocument/formatting", {
          textDocument: { uri: uriOf(path) },
          options: { tabSize, insertSpaces: true },
        })) ?? []
      )
    } catch {
      return null
    }
  }

  /** Code actions (quick fixes, refactors, source actions) for a range; `only` filters by kind. */
  async codeActions(path: string, range: Range, only?: string[]): Promise<CodeAction[]> {
    const doc = await this.flush(path)
    if (!doc || !doc.client.caps.codeActionProvider) return []
    const diagnostics = this.diagnostics(path).filter((d) => overlaps(d.range, range))
    try {
      const r = await doc.client.rpc!.request<CodeAction[] | null>("textDocument/codeAction", {
        textDocument: { uri: uriOf(path) },
        range,
        context: { diagnostics, ...(only ? { only } : {}), triggerKind: 1 },
      })
      return (r ?? []).filter((a) => !a.disabled)
    } catch {
      return []
    }
  }

  /** Fill in a code action's edit when the server sends it lazily. */
  async resolveCodeAction(path: string, action: CodeAction): Promise<CodeAction> {
    const doc = await this.flush(path)
    const provider = doc?.client.caps.codeActionProvider
    if (!doc || action.edit || typeof action.command === "string" || !(provider && typeof provider === "object" && "resolveProvider" in provider && provider.resolveProvider))
      return action
    try {
      return (await doc.client.rpc!.request<CodeAction | null>("codeAction/resolve", action)) ?? action
    } catch {
      return action
    }
  }

  /** Run a server command; edits it makes arrive through onApplyEdit. */
  async executeCommand(path: string, command: LspCommand): Promise<string | null> {
    const doc = await this.flush(path)
    if (!doc) return "No language server for this file"
    try {
      await doc.client.rpc!.request("workspace/executeCommand", { command: command.command, arguments: command.arguments })
      return null
    } catch (err) {
      return (err as Error).message
    }
  }

  /** Edits per file path from a WorkspaceEdit. */
  editFiles(edit: Parameters<typeof workspaceEditFiles>[0]): Map<string, TextEdit[]> {
    return new Map([...workspaceEditFiles(edit)].map(([uri, edits]) => [pathOf(uri), edits]))
  }

  stop(): void {
    this.stopped = true
    for (const u of this.unsubs) u()
    for (const c of this.clients.values()) c.stop()
    this.clients.clear()
  }
}

const before = (a: Position, b: Position) => a.line < b.line || (a.line === b.line && a.character <= b.character)
/** Ranges touch (a cursor at the edge of a diagnostic counts). */
const overlaps = (a: Range, b: Range) => before(a.start, b.end) && before(b.start, a.end)

const contains = (r: Range, p: Position) =>
  (r.start.line < p.line || (r.start.line === p.line && r.start.character <= p.character)) &&
  (r.end.line > p.line || (r.end.line === p.line && r.end.character >= p.character))

/** Innermost chain of symbols containing `pos` (hierarchical DocumentSymbol or flat SymbolInformation). */
export function symbolPathAt(symbols: unknown[], pos: Position): string[] {
  const out: string[] = []
  type DocSym = { name: string; range: Range; children?: DocSym[] }
  type SymInfo = { name: string; location: { range: Range } }
  if (symbols.length && "location" in (symbols[0] as object)) {
    // Flat list: take every symbol containing the position, outer (larger) first.
    const hits = (symbols as SymInfo[]).filter((s) => contains(s.location.range, pos))
    hits.sort((a, b) => a.location.range.start.line - b.location.range.start.line || b.location.range.end.line - a.location.range.end.line)
    return hits.map((s) => s.name)
  }
  let level = symbols as DocSym[]
  for (;;) {
    const hit = level.find((s) => contains(s.range, pos))
    if (!hit) return out
    out.push(hit.name)
    level = hit.children ?? []
  }
}

/** Hover contents (string, MarkupContent, MarkedString or an array of those) as plain text. */
export function hoverText(contents: unknown): string | null {
  const one = (c: unknown): string => {
    if (typeof c === "string") return c
    if (c && typeof c === "object" && "value" in c) return String((c as { value: unknown }).value)
    return ""
  }
  const text = (Array.isArray(contents) ? contents.map(one) : [one(contents)]).filter(Boolean).join("\n\n")
  // Drop markdown code fences; the popup is plain text.
  const clean = text.replace(/^```\w*\n?/gm, "").replace(/\n?```$/gm, "").trim()
  return clean || null
}
