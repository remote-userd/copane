# copane

[![CI](https://github.com/sevheng/copane/actions/workflows/ci.yml/badge.svg)](https://github.com/sevheng/copane/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A terminal code editor with an AI coding CLI (Claude Code by default) running in a side pane.

```
┌ tree ─────┐┌ editor ──────────────────────┐┌ claude ───────────────┐
│ ▾ src     ││ a.ts ●  b.ts                 ││ > fix the bug in f    │
│   a.ts    ││ 1 export function f() {      ││ ● Edit a.ts           │
│   b.ts    ││ 2   ...                      ││                       │
└───────────┘└──────────────────────────────┘└───────────────────────┘
 ^S save  ^P files  ^B tree  ^J ai  ^L send to ai  F1 commands  ^Q quit
```

The AI pane is a real terminal running the CLI, so it keeps all of the CLI's own features: tools, approvals, slash commands, and sessions.

Built with [Bun](https://bun.sh) and [OpenTUI](https://opentui.com). Linux and macOS only, because it uses Bun's POSIX pseudo-terminal.

## Run

```sh
git clone https://github.com/sevheng/copane.git
cd copane
bun install
bun run dev                 # open the current directory
bun run dev path/to/file.ts # open a file
bun run dev path/to/project # open a directory
bun run build               # standalone binary at dist/copane
```

## Install as a command

Needs [Bun](https://bun.sh) 1.4.3 or later (`curl -fsSL https://bun.sh/install | bash`). The script installs the dependencies itself.

```sh
bun run install:cli                     # builds, installs ~/.local/bin/copane + `ce` link
PREFIX=/usr/local bun run install:cli   # or somewhere else ($PREFIX/bin)
ALIAS=cx bun run install:cli            # pick another short name (ALIAS= for none)
```

Then open things the way VS Code's `code` does:

```sh
ce .                 # this folder
ce src/main.ts       # a file (its project folder is the workspace)
ce ~/projects/app    # another folder
```

The binary is self-contained (about 110 MB): it does not need Bun or `node_modules` at run time.
It lives in `~/.local/lib/copane/`; `~/.local/bin/copane` is a small launcher script.

**Updating while it runs:** after `bun run install:cli`, every open editor shows
"⟳ Update installed: restart" in the status bar. Click it or press Ctrl+Alt+R: unsaved files
prompt first, then the editor restarts on the new version with the same folder and tabs.
Ctrl+Alt+R also restarts `bun run dev`, which picks up source changes.

`ce --version` prints the installed version.

Uninstall: `rm -r ~/.local/bin/copane ~/.local/bin/ce ~/.local/lib/copane`.

## Working with the AI

The editor is built around a loop: ask Claude, see what it changed, keep or undo it.

1. **Give context.** Select lines, or nothing for the whole file, and press **Ctrl+L**. The AI prompt gets `@path#L10-20` plus the snippet. In the tree, right-click a file or folder and choose **Send to AI**.
2. **Ask.** Ctrl+J moves you to the AI pane and back. Unsaved files are saved when you switch, so Claude reads what you see. Turn this off with `editor.saveBeforeAi: false`.
3. **See what changed.** Files Claude edits reload automatically, and the changed lines flash. The line numbers mark lines that differ from the last commit: **▎** green added, yellow changed, and a red **▁** for deleted. The tree marks changed files.
4. **Review everything.** **Ctrl+Alt+D** lists all changed files with a diff. **Enter** opens a file at the change, and **r** reverts it.
5. **Undo.** Ctrl+Z also undoes a reload, so you can step back through Claude's edit in the editor.
6. **Edits on both sides.** When Claude changes a file you have unsaved edits in, a bar offers:
   - **Merge both:** keeps your edits and Claude's. Only offered when they don't touch the same lines.
   - **Compare:** shows the two versions side by side as a diff.
   - **Use disk:** takes Claude's version.
   - **Keep mine:** keeps yours, and your next save overwrites Claude's.

**One-click requests:** right-click in the editor, or use F1, for **AI: explain this**, **AI: find and fix bugs**, or **AI: write tests**. Each sends the selection, or the whole file, together with the request, and submits it.

Run commands from the AI pane with `!`, for example `! bun test`.

## Big projects

- **Ctrl+P:** an empty query lists recently opened files first. The file index is built in the background at startup, so the first Ctrl+P is instant.
  - **`@name`:** jumps to a symbol in this file, using the language server or, without one, a pattern scan that also finds `describe`/`it` test blocks.
  - **`#name`:** searches symbols across the project, through the language server.
  - **`:120`:** goes to a line.
- **Ctrl+Alt+← / →:** back and forward through your jumps (definition, references, search results, go to line, picker).
- **Long files:** stay responsive. Syntax colours and indent guides are computed for the whole file, but only lines near the screen are drawn. An 11,000-line file takes about 30 ms per keystroke.
- **`CE_PERF=/tmp/ce-perf.log ce`:** logs how long each keypress takes to reach the screen.

## Look

- **Panes:** the panes have no boxes. A thin divider separates them, and you can drag it to resize.
- **Headers:** each pane has one. The left pane has two tabs, `FILES` (the tree) and `SEARCH` (search and replace in all files); click one to switch. The editor's header is its tab row, with icons, and the active tab is accent-coloured while the editor has focus. The AI pane shows the command and `● ready`, or a spinner while it's working.
- **Breadcrumbs:** under the tabs, `src › editor › EditorPane.tsx › BufferView` shows the folder path, the file and the symbol under the cursor. Click a folder to show it in the tree.
- **Status bar,** left to right:
  - **Git branch,** with ↑ahead / ↓behind counts. Click it to review changes.
  - **Problems.**
  - **A message or hints.**
  - **Position and selection size.** Click it to go to a line.
  - **Language, line endings and language servers.**
  - **The AI.** Click it to switch focus.
- **In the editor:**
  - The cursor's line has a slightly lighter background.
  - The bracket matching the one at the cursor is highlighted.
  - Other uses of the word under the cursor get a subtle highlight.
  - Indent levels show as faint guides.
  - Turn these off with `editor.highlightCursor` and `editor.indentGuides`.

## Git

- **Source control (Ctrl+Alt+D,** or click the branch in the status bar**):** merge conflicts, staged files and changed files, with the diff of the selected one.
  - **Staging:** Space stages or unstages, `a` stages everything, and `r` reverts (after a confirmation).
  - **Committing:** write a message and press Enter (or Alt+Enter from anywhere in the panel) to commit. With nothing staged, it offers to stage everything. **Amend** rewrites the last commit.
  - **AI message (`m`):** asks `claude -p` to write a message from the staged diff. You review it before committing. Turn it off with `git.aiCommitMessage: false`.
  - **Push and pull (`P` / `U`):** show progress. A branch without an upstream gets offered "publish". With no remote, it says so.
- **Changes in the editor:**
  - **Markers:** the `▎` markers compare with what's staged, so staged lines lose theirs.
  - **Peek:** **Alt+H**, or a click on a marker, shows the change inline. `s` stages just that change, and `r` reverts it (Ctrl+Z undoes).
  - **Navigation:** **Alt+F5 / Shift+Alt+F5** jump to the next / previous change, as in VS Code.
- **Blame:** the status bar shows who last changed the cursor's line, for example `Ann · 3 days ago · Fix totals`. Lines you haven't committed show `Not committed yet`. Click it for the commit. Turn it off with `git.blame: false`.
- **Ctrl+Alt+G, file history:** the file's commits, with each commit's changes. `y` copies a commit id.
- **Ctrl+Alt+B, branches:** switch with fuzzy search, or type a new name to create a branch. It offers to save unsaved files first, and shows git's own error if the switch fails.
- **Merge conflicts:** your side is tinted green and the incoming side blue. A bar shows the count and **Accept current / incoming / both** (Alt+1 / Alt+2 / Alt+3 while the cursor is in a conflict), and Alt+F5 goes to the next conflict. When you're done, save and stage the file.

## Code intelligence

The editor talks to language servers for errors, autocomplete, type info and go-to-definition.

**Servers:**
- **TypeScript and JavaScript:** the project's own TypeScript 7 (`tsc --lsp`) when it's installed, otherwise `typescript-language-server`.
- **Others:** `rust-analyzer`, `gopls`, `pyright-langserver` (or `pylsp`), `zls` and `clangd`, whenever they're on your PATH.
- **When they run:** a server starts the first time you open a file of its language, and stops when you quit.

**Features:**
- **Errors and warnings:** a ● before the line number, red for errors and yellow for warnings. The text is underlined.
  - **Status bar:** shows `✖ 2 ⚠ 1`; click it for the Problems list.
  - **Cursor line:** with the cursor on a line that has a problem, the status bar shows the message.
- **F8:** next problem. **Ctrl+Alt+E:** all problems in open files.
- **Autocomplete:**
  - **When it appears:** suggestions show after `.`, or once you've typed two letters. Ctrl+Space asks for them anytime.
  - **Picking one:** ↑↓ to choose, Enter or Tab to accept, Esc to close.
  - **Turning it off:** set `editor.autocomplete: false`.
- **Ctrl+Alt+I:** type info and docs for the symbol under the cursor, plus any problem on that line.
- **F12 or Ctrl+click:** go to definition, across files (Alt+click also works, for terminals that keep Ctrl+click). Ctrl+Alt+← comes back. **Shift+F12:** all references.
- **F2:** rename the symbol under the cursor in every file. Open files change in place, and Ctrl+Z undoes it. Closed files are saved directly.
- **Shift+Alt+F** (or Ctrl+Alt+L): format the file. Projects with Prettier (in `node_modules`, or a Prettier config and `prettier` on PATH) use Prettier, as VS Code's Prettier extension does. Other files use the language server. `editor.formatter` forces one (`"prettier"` or `"lsp"`), and `editor.formatOnSave: true` formats on Ctrl+S.
- **Parameter hints:** while you type arguments in a call, its signature shows above the cursor, with the current parameter highlighted. Turn this off with `editor.parameterHints: false`.

Use another server, or turn one off, in the config: `{ "lsp": { "python": { "command": ["pylsp"] }, "go": false } }`.

## Coming from VS Code

Most VS Code keys work as you expect: Ctrl+P, Ctrl+Shift+P (or F1), Ctrl+S, Ctrl+F, Ctrl+G, Ctrl+D, Ctrl+/, F2, F12, Shift+F12, Shift+Alt+F, Alt+↑/↓ to move lines, Shift+Alt+↑/↓ to copy them, Alt+←/→ back and forward, Alt+1–9 for tabs, Home/End, and the common Ctrl+K chords (Ctrl+K Ctrl+C, Ctrl+K Ctrl+U, Ctrl+K Ctrl+S, Ctrl+K Z, Ctrl+K S).

Terminals can't send some Ctrl+Shift keys (they arrive as the plain Ctrl key), so those have stand-ins:

| VS Code | Here | Why |
| --- | --- | --- |
| Ctrl+Shift+K (delete line) | Alt+Shift+K | Ctrl+Shift+K arrives as Ctrl+K, which starts a chord |
| Ctrl+Shift+L (select all occurrences) | Ctrl+Alt+A | Ctrl+L sends the file to the AI |
| Ctrl+H (replace) | Ctrl+F twice, or Ctrl+Shift+H | Ctrl+H is Backspace in terminals |
| Ctrl+Shift+F (search files) | Ctrl+Alt+F | Works as Ctrl+Shift+F only in terminals that send it |
| Ctrl+Shift+H (replace in files) | Ctrl+Alt+F, then Ctrl+F | Ctrl+Shift+H arrives as Backspace. Alt+Enter replaces all; Alt+C / Alt+W / Alt+R toggle case, whole word, regex |
| Ctrl+. (quick fix) | Alt+. | Most terminals send Ctrl+. as a plain `.`. Shift+Alt+O organizes imports, as in VS Code |
| Ctrl+Shift+E / Ctrl+Shift+G | Ctrl+B / Ctrl+Alt+D | File tree / source control |
| Ctrl+Shift+T (reopen tab) | Ctrl+Alt+T | Ctrl+T is "go to symbol in project", as in VS Code |
| Ctrl+Tab | Ctrl+PageDown, Alt+1–9 | Terminals don't send Ctrl+Tab |
| Ctrl+` (terminal) | Ctrl+J, then `!command` | The side pane is the AI CLI. Claude Code runs shell commands that start with `!` |
| Ctrl+Alt+↑/↓ (add cursor) | Ctrl+D | Multi-cursor here is by occurrence. Ctrl+Alt+↑/↓ copy lines |
| Alt+F5 (next change) | Alt+F5 | Same key. Alt+H shows the change |

Settings that match VS Code's: `editor.wordWrap` (Alt+Z toggles it), `editor.formatOnSave`, `editor.autoClosingBrackets`. **Import VS Code settings** in the palette (F1) copies yours into the config (it finds VS Code's settings on Linux, macOS, Windows, and Windows from WSL). Ctrl+F starts with the selection or the word under the cursor, and typing replaces it.

Rebind anything in `~/.config/copane/config.json` under `keys` (command names are in `src/keymap/commands.ts`), including two-key chords: `{ "keys": { "editor": { "ctrl+k ctrl+w": "buffer.close" } } }`.

## Keys

Press **F1** for the command palette: every command, searchable, with its shortcut. Press **Ctrl+Alt+K** for a grouped cheat sheet.

| Key | Action |
| --- | --- |
| Ctrl+S | Save |
| Ctrl+Q | Quit, with a prompt if there are unsaved changes |
| F1 (also Ctrl+Shift+P, Ctrl+Alt+P) | Command palette |
| Ctrl+P | Go to file (fuzzy, recent files first); `@` symbols in this file, `:` line, `#` project symbols. Works from the AI pane too |
| Ctrl+T / Ctrl+Shift+O | Go to symbol in the project / in this file (Ctrl+P with `#` / `@`) |
| Alt+← / → (or Ctrl+Alt+← / →) | Back / forward through jumps (definition, search results, go to line, opened files) |
| Ctrl+F | Find in the file. Press it again for replace |
| Ctrl+G | Go to line[:column] |
| Ctrl+Alt+F (or Ctrl+Shift+F) | Search in all files: the left pane's SEARCH tab, seeded with the selection or the word under the cursor (ripgrep when installed; a popup in terminals under 100 columns). Results are grouped by file; Enter or a click opens one and keeps you in the list, Esc goes back to the editor. ▸ (or Ctrl+F) adds a replace row with ⇄ All (or Alt+Enter, after a confirm). Aa / ab / .* (or Alt+C / Alt+W / Alt+R) toggle case, whole word, regex. On a hovered result or file, ⇄ replaces just that and × hides it (Replace all then skips it). The files field takes globs (`src/**, !*.test.ts`) |
| Ctrl+Alt+D | Source control: stage, commit, push |
| Alt+H / Alt+F5 / Shift+Alt+F5 | Show the change at the cursor / next / previous change |
| Ctrl+Alt+G / Ctrl+Alt+B | File history / switch branch |
| Ctrl+Space | Autocomplete |
| F12 / Shift+F12 / Ctrl+Alt+I | Go to definition / references / type info under the cursor |
| F2 / Shift+Alt+F | Rename symbol everywhere / format document (also Ctrl+Alt+L) |
| Alt+. (or Ctrl+.) / Shift+Alt+O | Quick fix: code actions at the cursor (add import, fix, refactor) / organize imports |
| F8 / Ctrl+Alt+E | Next problem / all problems |
| Alt+Z | Toggle word wrap (`editor.wordWrap` sets the default) |
| Ctrl+/ | Toggle line comment on the line or selected lines (Ctrl+K Ctrl+C adds, Ctrl+K Ctrl+U removes) |
| Alt+↑ / Alt+↓ | Move the line or selected lines up / down |
| Shift+Alt+↑ / Shift+Alt+↓ | Copy the line or selected lines up / down (also Ctrl+Alt+↑ / ↓) |
| Alt+Shift+K | Delete the line or selected lines |
| Tab / Shift+Tab | Indent / outdent (Tab with no selection inserts spaces, or a tab in tab-indented files). Ctrl+] indents the line |
| Home / End | First character of the line (again: column 0) / end of the line. Ctrl+Home / Ctrl+End: start / end of the file |
| Ctrl+← / → , Ctrl+Backspace / Ctrl+Delete | Move by word, delete a word |
| Ctrl+K Ctrl+X / Ctrl+K S / Ctrl+K Z | Trim trailing whitespace / save all / maximize the editor |
| Ctrl+D / Ctrl+Alt+A | Multi-cursor: add the next occurrence / all occurrences of the word or selection |
| Ctrl+B | Focus or hide the file tree (from the SEARCH tab: back to FILES) |
| Ctrl+E | Focus the editor |
| Ctrl+J | Focus the AI pane, or back to the editor from it |
| Ctrl+Alt+J | Show or hide the AI pane |
| Ctrl+Alt+M | Maximize the editor, and press again to restore |
| Ctrl+L | Send the current file, or the selected lines, to the AI prompt |
| Ctrl+W / Ctrl+Alt+T | Close tab / reopen the last closed tab (also Ctrl+Shift+T where the terminal sends it) |
| Ctrl+PageUp / Ctrl+PageDown | Previous or next tab |
| Alt+1 … Alt+9 | Go to tab 1–8, Alt+9 the last |
| Ctrl+C / Ctrl+X / Ctrl+V | Copy, cut, paste. Without a selection, copy and cut take the whole line |
| Ctrl+A | Select all |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+R | Reload a file that changed on disk, dropping local edits |
| Ctrl+Alt+R | Restart (loads a newly installed version), keeping open tabs |

**Typing:** Enter keeps the line's indent, one level more after `{`, `(` or `[`, and between a pair like `{}` the closer goes to its own line. Brackets and quotes close themselves, typing the closer steps over it, and Backspace between an empty pair deletes both. A bracket or quote typed over a selection wraps it. Turn these off with `editor.autoIndent: false` and `editor.autoClosingBrackets: false`.

**Multi-cursor (Ctrl+D):**
- **Selecting:** the first press selects the word under the cursor, and each press adds the next occurrence. Ctrl+Alt+A takes all of them.
- **Editing:** typing, Backspace and Ctrl+V change every occurrence at once. The status bar shows how many are active.
- **Leaving:** Esc, an arrow key or a click ends it.
- **Matching:** starting from a word matches whole words only. Starting from a selection matches the exact text.

**Find bar:**
- Enter or ↓ goes to the next match, ↑ to the previous, and Esc closes the bar.
- Search ignores case unless your text has a capital letter.
- In the replace field, Enter replaces one match and Alt+Enter replaces all. Each replace is a single undo step.

While the AI pane has focus, every key goes to the CLI except Ctrl+Q, Ctrl+B, Ctrl+E, Ctrl+J, Ctrl+P, F1, Ctrl+Alt+J, Ctrl+Alt+D and Ctrl+Alt+R. Esc, Ctrl+C and Shift+Tab therefore work in Claude Code as usual.

Dragged pane widths are remembered in `~/.local/state/copane/layout.json`.

## File tree

With the tree focused (Ctrl+B), or from the right-click menu on a row:

| Key | Action |
| --- | --- |
| a | New file next to the selection (`lib/x.ts` creates folders too) |
| Shift+A | New folder |
| r / F2 | Rename (the cursor starts before the extension) |
| Delete | Delete permanently, after a confirmation |

The menu also has Copy Path, Copy Relative Path and Send to AI (types `@path` into the AI prompt). Right-click empty space to create at the project root. Open tabs follow renames; deleting closes their tabs unless they have unsaved changes.

In a git repository the tree shows status: **M** modified (yellow), **U** untracked, **A** added, **R** renamed (green), **!** conflict (red). A folder shows • in the colour of the most important change inside it. Marks update when files change and when you stage or commit.

## Icons

The tree shows file-type icons. Set the style in the config: `{ "tree": { "icons": "nerd" } }`.

| Style | Looks like | Needs |
| --- | --- | --- |
| `nerd` | VS Code-style icons for TS, React, JSON, git, npm and more | a Nerd Font in your terminal |
| `simple` (default) | coloured symbols: ◆ TS, { JSON, ¶ Markdown, ± git | any font |
| `none` | no icons | |

`bun run install:cli` sets this up. It installs the bundled **CaskaydiaMono Nerd Font**, which is Cascadia Mono plus icons, from `assets/fonts/`. It works offline. It is the non-Mono variant, so icons are drawn full size instead of squeezed into one letter's width.

- **WSL with Windows Terminal:**
  - **Font:** installed for your Windows user, with no admin needed.
  - **Windows Terminal:** the font becomes its default. This only happens when no font is chosen there yet, or when an earlier install set "CaskaydiaMono Nerd Font Mono", which is switched to the new face. `settings.json` is backed up next to itself first.
  - **Editor:** `tree.icons` is set to `"nerd"`, unless you already set it.
  - Close every Windows Terminal window and open it again, once, to load the font. A new tab or a `ce` restart is not enough, because Windows Terminal reads fonts only when it starts.
- **macOS and Linux:** the font is copied to `~/Library/Fonts` or `~/.local/share/fonts`. Choose "CaskaydiaMono Nerd Font" in your terminal, then set `tree.icons` to `"nerd"`.
- **Skip it:** use `FONT=0 bun run install:cli`. Once the font is set up, later installs skip this step; `FONT=force bun run install:cli` redoes it.
- **Undo:** set `tree.icons` to `"simple"`, or restore the `settings.json.bak-…` file in Windows Terminal's settings folder.

If icons show as boxes, your terminal isn't using a Nerd Font yet. On Windows, fully close and reopen Windows Terminal.

## Mouse

- **Editor:** click to place the cursor, drag to select, double-click selects a word. The wheel scrolls without moving the cursor, and Shift+wheel scrolls sideways.
- **Line numbers:** click a number to select that line, drag to select several.
- **Ctrl+click** (or Alt+click) a name to go to its definition.
- **Right-click:** a menu with Go to definition, Find all references, Cut, Copy, Paste, Select all and Send to AI. In the AI pane it offers Copy, Paste and Restart.
- **Panes:** clicking a pane focuses it. Drag the border between panes to resize them for this session.
- **Tree and picker:** the wheel scrolls, rows highlight on hover, and a click opens the file or toggles the folder. Right-click a tree row for file actions.
- **Tabs:** click to switch, click × or middle-click to close, wheel over the tab bar to cycle.
- **Status bar:** the key hints are buttons, and clicking the AI status switches focus.
- **Dialogs:** buttons are clickable, and clicking outside closes them.
- **AI pane:** select text with the mouse to copy it. Ctrl+C stays with the CLI.

While the editor captures the mouse, most terminals use Shift+drag for their own text selection.

Copying goes to the system clipboard through the terminal (OSC 52) and through `powershell.exe` on WSL, `pbcopy` on macOS, or `wl-copy`, `xclip` or `xsel` on Linux. Pasting with Ctrl+V reads the clipboard through the same tools. Your terminal's own paste shortcut also works. Inside tmux, enable `set -g mouse on` and `set -g set-clipboard on`.

## Config

Optional file at `~/.config/copane/config.json`. **Open settings (JSON)** in the palette (F1) opens it and creates it if needed. Comments and trailing commas are allowed, as in VS Code.

```json
{
  "ai": { "command": "claude", "args": [], "startHidden": false },
  "editor": { "highlightMaxBytes": 1000000, "copyOnSelect": false, "saveBeforeAi": true, "autocomplete": true, "wordWrap": false, "highlightCursor": true, "indentGuides": true, "autoIndent": true, "autoClosingBrackets": true, "formatter": "auto", "formatOnSave": false },
  "lsp": { "python": { "command": ["pylsp"] } },
  "tree": { "icons": "simple" },
  "keys": { "global": { "ctrl+o": "file.picker", "ctrl+l": null } }
}
```

`ai.command` can be any terminal program, for example `codex`, `opencode`, `gemini` or your shell. Key overrides map a key to a command name from `src/keymap/commands.ts`, and `null` removes a binding. The command palette (F1) shows every command.

## Syntax highlighting

Highlighting uses Tree-sitter through OpenTUI. The bundled grammars cover JavaScript, TypeScript, TSX, Markdown and Zig. You can register more grammars with `getTreeSitterClient().addFiletypeParser(...)`.

## Development

```sh
bun test           # unit and render tests
bun run typecheck
```

`scripts/smoke.md` is the manual checklist for things the tests cannot cover.

## Contributing

Issues and pull requests are welcome. Before opening a PR, run `bun run typecheck` and `bun test`,
and walk through the parts of `scripts/smoke.md` your change touches. `CLAUDE.md` lists the
project conventions (Bun APIs first, terminal key gotchas).

## License

[MIT](LICENSE). The bundled CaskaydiaMono Nerd Font is under the SIL Open Font License 1.1
(`assets/fonts/LICENSE-OFL.txt`).
