import { expect, test } from "bun:test"
import { RpcConnection } from "../../src/lsp/rpc"

// A fake server: answers each request with a body of the requested size, written in uneven chunks.
const SERVER = `
const enc = new TextEncoder()
const frame = (msg) => {
  const body = enc.encode(JSON.stringify(msg))
  const out = enc.encode("Content-Length: " + body.length + "\\r\\n\\r\\n")
  const all = new Uint8Array(out.length + body.length)
  all.set(out); all.set(body, out.length)
  return all
}
let buf = ""
for await (const chunk of Bun.stdin.stream()) {
  buf += new TextDecoder().decode(chunk)
  for (;;) {
    const m = /Content-Length: (\\d+)\\r\\n\\r\\n/.exec(buf)
    if (!m || buf.length < m.index + m[0].length + Number(m[1])) break
    const msg = JSON.parse(buf.slice(m.index + m[0].length, m.index + m[0].length + Number(m[1])))
    buf = buf.slice(m.index + m[0].length + Number(m[1]))
    const bytes = new Uint8Array([...frame({ jsonrpc: "2.0", method: "note", params: { n: msg.id } }), ...frame({ jsonrpc: "2.0", id: msg.id, result: "é".repeat(msg.params.size) })])
    for (let i = 0, step = 7; i < bytes.length; i += step, step = step === 7 ? 65_521 : 7) {
      await Bun.write(Bun.stdout, bytes.subarray(i, i + step))
    }
  }
}
`

test("messages split across chunks, big and multi-byte, arrive whole", async () => {
  const proc = Bun.spawn(["bun", "-e", SERVER], { stdin: "pipe", stdout: "pipe", stderr: "ignore" })
  const rpc = new RpcConnection(proc)
  const notes: unknown[] = []
  rpc.on("note", (p) => notes.push(p))
  expect(await rpc.request<string>("x", { size: 10 })).toBe("é".repeat(10))
  expect(await rpc.request<string>("x", { size: 1_500_000 })).toBe("é".repeat(1_500_000)) // 3 MB of UTF-8
  expect(await rpc.request<string>("x", { size: 3 })).toBe("ééé")
  expect(notes).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
  rpc.close()
  proc.kill()
}, 20_000)
