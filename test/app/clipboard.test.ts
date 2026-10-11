import { expect, test } from "bun:test"
import { createClipboard, detectClipboardTool } from "../../src/app/clipboard"

test("copy prefers the system tool and remembers text for paste fallback", async () => {
  const calls: { cmd: string[]; stdin?: string }[] = []
  const cb = createClipboard({
    tool: { name: "fake", copy: ["fake-copy"], paste: ["fake-paste"] },
    run: async (cmd, stdin) => {
      calls.push({ cmd, stdin })
      return cmd[0] === "fake-copy" ? "" : "from system"
    },
    osc52: () => true,
  })
  expect(await cb.copy("hello")).toBe("system")
  expect(calls[0]).toEqual({ cmd: ["fake-copy"], stdin: "hello" })
  expect(await cb.paste()).toBe("from system")
})

test("without a tool, copy uses OSC 52 and paste returns the last copied text", async () => {
  let osc = ""
  const cb = createClipboard({ tool: null, osc52: (t) => ((osc = t), true) })
  expect(await cb.copy("abc")).toBe("terminal")
  expect(osc).toBe("abc")
  expect(await cb.paste()).toBe("abc")
})

test("a failing tool falls back to the internal register", async () => {
  const cb = createClipboard({ tool: { name: "x", copy: ["x"], paste: ["y"] }, run: async () => null, osc52: () => false })
  expect(await cb.copy("kept")).toBe("internal")
  expect(await cb.paste()).toBe("kept")
})

test("PowerShell output is normalised to LF without the trailing newline", async () => {
  const cb = createClipboard({ tool: { name: "powershell", paste: ["ps"] }, run: async () => "a\r\nb\r\n" })
  expect(await cb.paste()).toBe("a\nb")
})

test("tool detection follows availability", () => {
  const only = (names: string[]) => (c: string) => (names.includes(c) ? `/usr/bin/${c}` : null)
  if (process.platform === "linux" && !process.env.WSL_DISTRO_NAME) {
    expect(detectClipboardTool(only(["xclip"]))?.name).toBe("xclip")
    expect(detectClipboardTool(only([]))).toBeNull()
  } else {
    expect(detectClipboardTool(only([]))).toBeNull()
  }
})
