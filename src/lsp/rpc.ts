import type { Subprocess } from "bun"

/** JSON-RPC 2.0 over a language server's stdio (LSP base protocol: Content-Length framing). */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Position of the blank line (\r\n\r\n) that ends an LSP header, or -1. */
function indexOfHeaderEnd(b: Uint8Array): number {
  for (let i = 0; i + 3 < b.length; i++) if (b[i] === 13 && b[i + 1] === 10 && b[i + 2] === 13 && b[i + 3] === 10) return i
  return -1
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

export class RpcConnection {
  private nextId = 1
  private pending = new Map<number, Pending>()
  private notificationHandlers = new Map<string, (params: unknown) => void>()
  /** Bytes received but not yet parsed: data[head..tail). Grows by doubling, so a big response isn't copied per chunk. */
  private data = new Uint8Array(64 * 1024)
  private head = 0
  private tail = 0
  private closed = false
  /** Called once when the process exits or the stream ends. */
  onClose: (() => void) | null = null

  constructor(
    private proc: Subprocess<"pipe", "pipe", "pipe" | "ignore">,
    /** Server-to-client requests (e.g. client/registerCapability): return the result. */
    private onRequest: (method: string, params: unknown) => unknown = () => null,
  ) {
    void this.read()
  }

  private async read(): Promise<void> {
    try {
      for await (const chunk of this.proc.stdout) {
        this.append(chunk)
        this.drain()
      }
    } catch {
      // stream closed
    }
    this.close()
  }

  private append(chunk: Uint8Array): void {
    if (this.tail + chunk.length > this.data.length) {
      const used = this.tail - this.head
      const need = used + chunk.length
      // Move the unparsed bytes to the front; double the buffer when that isn't room enough.
      if (need <= this.data.length) this.data.copyWithin(0, this.head, this.tail)
      else {
        const next = new Uint8Array(Math.max(need, this.data.length * 2))
        next.set(this.data.subarray(this.head, this.tail))
        this.data = next
      }
      this.head = 0
      this.tail = used
    }
    this.data.set(chunk, this.tail)
    this.tail += chunk.length
  }

  /** Parse every complete message in the buffer. Lengths are in bytes, so work on bytes. */
  private drain(): void {
    for (;;) {
      const pending = this.data.subarray(this.head, this.tail)
      const headerEnd = indexOfHeaderEnd(pending)
      if (headerEnd < 0) return
      const m = /content-length:\s*(\d+)/i.exec(decoder.decode(pending.subarray(0, headerEnd)))
      if (!m) {
        this.consume(headerEnd + 4)
        continue
      }
      const len = Number(m[1])
      const start = headerEnd + 4
      if (pending.length < start + len) return
      const body = decoder.decode(pending.subarray(start, start + len))
      this.consume(start + len)
      try {
        this.dispatch(JSON.parse(body))
      } catch {
        // ignore a malformed message
      }
    }
  }

  private consume(n: number): void {
    this.head += n
    if (this.head !== this.tail) return
    this.head = this.tail = 0
    // One huge answer (workspace symbols, references) grew the buffer: don't keep that for good.
    if (this.data.length > 1024 * 1024) this.data = new Uint8Array(64 * 1024)
  }

  private dispatch(msg: {
    id?: number | string
    method?: string
    params?: unknown
    result?: unknown
    error?: { message: string }
  }): void {
    if (msg.method !== undefined && msg.id !== undefined) {
      let result: unknown = null
      try {
        result = this.onRequest(msg.method, msg.params)
      } catch {
        result = null
      }
      this.write({ jsonrpc: "2.0", id: msg.id, result: result ?? null })
      return
    }
    if (msg.method !== undefined) {
      this.notificationHandlers.get(msg.method)?.(msg.params)
      return
    }
    const p = typeof msg.id === "number" ? this.pending.get(msg.id) : undefined
    if (!p) return
    this.pending.delete(msg.id as number)
    clearTimeout(p.timer)
    if (msg.error) p.reject(new Error(msg.error.message))
    else p.resolve(msg.result)
  }

  private write(msg: object): void {
    if (this.closed) return
    const body = encoder.encode(JSON.stringify(msg))
    try {
      this.proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
      this.proc.stdin.write(body)
      this.proc.stdin.flush()
    } catch {
      this.close()
    }
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = 10_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error("language server stopped"))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      this.write({ jsonrpc: "2.0", id, method, params })
    })
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params })
  }

  on(method: string, handler: (params: unknown) => void): void {
    this.notificationHandlers.set(method, handler)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error("language server stopped"))
    }
    this.pending.clear()
    this.onClose?.()
  }

  get isClosed(): boolean {
    return this.closed
  }
}
