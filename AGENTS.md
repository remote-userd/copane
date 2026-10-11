# copane: notes for AI coding agents (and humans)

Terminal code editor (`ce`) with an AI CLI in a side pane. TypeScript on Bun, UI with OpenTUI (React).
This file is the project's rules for any coding agent (Claude Code reads it through `CLAUDE.md`).
Human-facing docs: `README.md`; contribution process: `CONTRIBUTING.md`.

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
- `mkdtemp`, `chmod`, `rename`, `rm` for temp folders and replacing the binary (`setup/`).
- Synchronous reads where the caller is synchronous: the `.gitignore` read in `files/ignore.ts` (inside a sync matcher) and image sizes in `preview/MarkdownView.tsx` (during render).
- `node:zlib` in `test/support/png.ts` (PNG needs zlib-wrapped data).

## Terminal key gotchas

These apply to legacy terminal input, which is what most users have:
- **Ctrl+H** is Backspace.
- **Ctrl+Shift+letter** arrives as Ctrl+letter.
- **Shift+Enter** is Enter.
- **Alt+Shift+F** parses as Alt+→ (it is `ESC F`); `keyToString` maps it back by its raw sequence.

Use Alt or Ctrl+Alt combinations instead, and check new bindings with a quick key-parse test (see `test/` and how existing bindings were chosen).

## Where things live

| Folder | What |
| --- | --- |
| `src/main.tsx` | Startup: CLI flags, workspace, file watcher, language servers, git, restore after restart |
| `src/app/` | Layout (`App.tsx`), UI state (`state.ts`, a small `store.ts`), `workspace.ts` (the object every component gets), status bar, modals, palette, clipboard, restart/update |
| `src/editor/` | `BufferStore.ts` (open tabs: text, image and preview kinds), `EditorPane.tsx` (tabs + views), `CodeEditorRenderable.ts` (the text editor), highlighting, find, multi-cursor, line commands, merge of AI edits |
| `src/files/` | File tree (`TreeModel`, `FileTree`), watcher, `.gitignore` matching, Ctrl+P picker, project search, reveal in file manager |
| `src/git/` | `repo.ts` (git commands), source control panel, blame, history, branches, hunks, merge conflicts |
| `src/lsp/` | `LspManager.ts` (servers per language, documents, diagnostics), completion, hover, rename, references, formatting |
| `src/ai/` | The AI pane: a pseudo-terminal running the CLI (`AgentProcess`), and sending context to it |
| `src/keymap/` | `commands.ts` (every command, by id), `bindings.ts` (default keys per layer), `keys.ts` (key parsing) |
| `src/preview/` | Markdown preview (own renderer on `marked`), image tabs, GIF playback |
| `src/config/` | Config schema (zod), loading, theme colours, VS Code settings import |
| `src/setup/` | `--upgrade` and `--install-font` |
| `test/` | Mirrors `src/`; `test/helpers.tsx` has `fixture()` (temp project) and `renderApp()` (renders the app headlessly) |

Main flows:
- Opening a file: `ws.buffers.open(path)` → `BufferStore` adds a buffer → `EditorPane` renders it (`BufferView`, `ImageView` or `MarkdownPreview` by `kind`).
- The AI edits a file: `FileWatcher` → `ws.buffers.handleDiskChange(path)` → clean buffers reload (undoable), dirty ones get a conflict bar.
- A key: `useAppKeymap` looks it up in `bindings.ts` for the focused layer, then `runCommand(ws, id)` runs `commands[id]`.

## Adding a feature

- **A command:** add it to `commands.ts` with a `title` (the palette lists it automatically), and a key in `bindings.ts` if it needs one. Prefer VS Code's key; when a terminal can't send it, pick an Alt or Ctrl+Alt stand-in and add a row to the README's "Coming from VS Code" table.
- **A key:** add a raw-bytes case to `test/keymap/keys.test.ts` proving the terminal sequence reaches the command.
- **A setting:** add it to `src/config/schema.ts` with a default and a comment, and to the README's config example.
- **UI:** OpenTUI React elements (`<box>`, `<text>`, `<span>`, `<scrollbox>`, `<image>`, `<code>`). Colours come from `src/config/theme.ts`, never literals in components.

## Checking your work

1. `bun run typecheck` and `bun test` pass. Add tests next to the existing ones: unit tests for logic, and `renderApp()` + `h.frame()` for what appears on screen (see `test/preview/preview.test.tsx` for the pattern, including the `until()` helper for async rendering).
2. Walk through the items in `scripts/smoke.md` your change touches, and add an item for new behaviour.
3. To see the real UI without a terminal of your own, record it with [vhs](https://github.com/charmbracelet/vhs): a tape that runs `bun run dev <path>` and takes a `Screenshot` (see `scripts/demo/demo.tape`). Clear inherited `CLAUDE*` variables first if you run inside Claude Code.
4. User-facing changes go in the README and under `Unreleased` in `CHANGELOG.md`.

## Direction: AI-first

Most code in a copane session is written by the AI in the side pane. The editor's job is to give the AI context, show what it changed, and make reviewing, accepting and undoing that easy. Prefer features that serve that loop (reviewing changes, sending context, watching agents) over aids for typing code by hand (multi-cursor variants, folding, inlay hints and the like), which are not planned. Reading aids for reviewing AI output (syntax highlighting, Markdown preview) are in.

Also not planned: a terminal panel under the editor (the AI pane runs shell commands with `!`), and a debugger.
