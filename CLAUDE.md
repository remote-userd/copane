# copane

Terminal code editor (`ce`) with an AI CLI in a side pane. TypeScript on Bun, UI with OpenTUI (React).

## Commands

- `bun run dev [path]`: run from source
- `bun test`: all tests (they use real temp git repos and the project's TypeScript 7 `tsc --lsp`)
- `bun run typecheck`: `tsc --noEmit`
- `bun run install:cli`: build the binary and install `ce` (a running `ce` then offers a restart)

## Bun first

Use Bun's own APIs. Fall back to `node:` modules only where Bun has no equivalent.

| Need | Use | Not |
| --- | --- | --- |
| Read a file | `await Bun.file(p).text()` / `.bytes()` / `.json()` | `fs.readFile(Sync)` |
| Exists / size / mtime | `await Bun.file(p).exists()`, `.size`, `await Bun.file(p).stat()` | `fs.existsSync`, `fs.statSync` |
| Write a file (creates folders) | `await Bun.write(p, data)` (also copies: `Bun.write(dest, Bun.file(src))`) | `fs.writeFile` + `mkdir` |
| Delete a file | `await Bun.file(p).delete()` | `fs.rm` / `unlink` |
| Run a process | `Bun.spawn` / `Bun.spawnSync`; output: `await Bun.readableStreamToText(p.stdout)` | `child_process`, `new Response(stream).text()` |
| Env | `Bun.env` | `process.env` |
| file:// URLs | `Bun.fileURLToPath` / `Bun.pathToFileURL` | `node:url` |
| Bytes | `Uint8Array`, `TextEncoder`/`TextDecoder`, `.toBase64()` | `Buffer` |
| Other built-ins | `Bun.which`, `Bun.sleep`, `Bun.hash`, `Bun.stringWidth` | hand-rolled versions |
| Tests | `bun:test` | jest/vitest |

Still on `node:`, because Bun has no API for them:
- `node:path`.
- `node:os` (`homedir`, `tmpdir`).
- `fs.watch` (`files/watcher.ts`).
- `readdir`, `mkdir`, `rename` (`files/walk.ts`, `files/fileOps.ts`, `ai/AgentProcess.ts`).
- The synchronous `.gitignore` read in `files/ignore.ts`, which sits inside a sync matcher.

## Terminal key gotchas

These apply to legacy terminal input, which is what most users have:
- **Ctrl+H** is Backspace.
- **Ctrl+Shift+letter** arrives as Ctrl+letter.
- **Shift+Enter** is Enter.
- **Alt+Shift+F** parses as Alt+→ (it is `ESC F`); `keyToString` maps it back by its raw sequence.

Use Alt or Ctrl+Alt combinations instead, and check new bindings with a quick key-parse test (see `test/` and how existing bindings were chosen).
