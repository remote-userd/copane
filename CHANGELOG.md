# Changelog

All notable changes to copane are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.8.0] - 2026-10-11

### Added
- Report a problem (F1): the AI in the side pane gets copane's version, platform, terminal and the end of the error log (paths shortened), asks what happened, searches existing issues, and shows the drafted GitHub issue; it posts it with `gh` only after you say yes, or gives you a pre-filled link. Internal-error notices point to it.
- Automatic updates, like Claude Code's: once a day the installed binary checks GitHub and installs a new release in the background; the status bar then offers a restart, and the next start runs it anyway. `"update": "notify"` only says a release is out (a click in the status bar installs it), `"off"` never checks. If installing fails (no permission to replace the binary), it falls back to notifying.

## [0.7.0] - 2026-10-11

### Added
- Review & merge a worktree agent's work: right-click › Review & merge this agent (also in the palette, and offered when closing its tab) lists every file it changed since its branch split off, committed or not, with diffs. **m** commits its leftover edits and merges the branch into yours (conflicts get the usual conflict bar), then offers to remove the worktree, branch and tab; **d** discards it all. A worktree agent's tab shows how many files it changed.

### Changed
- Lighter all-day sessions: an agent CLI that exits on its own no longer leaks its terminal; closed agent tabs stop for good; AI turns keep a hash of each file's "after" text and skip files over 1 MB; output from streaming agents is scanned once per pause instead of per chunk (about 10% less CPU while a new agent tab streams); blame no longer re-runs on every git status change; the reload flash keeps one timer; hidden tabs skip AI-marker updates until shown; language servers re-check other open files at most every 10 s, are killed if they ignore "exit", and are restarted (up to 3 times in 5 minutes) when they crash, with their stale problems cleared; a stuck `git status` or Prettier is stopped after a while; deleted folders leave nothing cached; folder change events no longer throw away the Ctrl+P file list.
- Committing accepts: once a file's content is what HEAD has (you committed it, the AI did, or it was checked out), its AI review marks clear on their own, so they never pile up. Untracked files stay marked until committed.

### Fixed
- The Markdown preview hung (using more and more memory) on an HTML `<img>` that isn't a local file, such as a README's centred logo or badge from a URL. A `%` in an image path (`50%.png`) crashed the app.
- An internal error no longer closes the editor: it shows as a notice, unsaved changes are backed up and come back on the next start (Ctrl+Z drops them), and details go to `~/.local/state/copane/errors.log`. A rendering error offers Ctrl+R to draw the editor again with every file as it was.
- Opening a binary or unreadable file from Source control, history, AI turns, search results or Ctrl+click showed nothing and could close the app; it's now a notice. The same for failing actions in menus and dialogs.
- Saving no longer overwrites a change on disk the editor didn't know about (the file watcher can miss changes on WSL drives): Ctrl+S asks to overwrite or compare, and "Save all" lists what needs a decision. Keys typed during a save keep the file marked unsaved.
- Files that aren't UTF-8 are no longer opened (saving used to corrupt their accented characters); a UTF-8 byte-order mark is kept; files with control characters (form feeds…) show a warning, and saving asks first. Project-wide replace skips files that aren't UTF-8.
- Selecting more than 1 MB (Ctrl+A in a big file) then typing a bracket or cutting dropped everything past the first megabyte.
- Formatting, renames and quick fixes are no longer applied to text that changed while the language server worked (they could garble it).
- AI turn undo keeps CRLF line endings in CRLF checkouts, never deletes a staged file in a repo without commits, and waits until the turn has finished.
- "Use disk" on a conflicted file that was deleted meanwhile keeps your version instead of closing the app. Merging a worktree agent stops its CLI first, so nothing it writes afterwards is lost.
- A new agent "in a git worktree" failed with "branch already exists" after an earlier one's worktree was removed (its branch is kept): it now skips to the next free number.

## [0.6.0] - 2026-10-11

### Added
- Review the AI's edits in the editor: lines it changed get a violet ┃ until reviewed, with a bar above the file and a count in the status bar. Alt+N jumps to the next change and shows what it replaced; **a** accepts it and moves on, **r** undoes it (one undo step), and past the last change Alt+N opens the next file. Accept file, Undo file and Accept all are on the bar and in the palette. Ctrl+Alt+V starts the review from anywhere, including the AI pane, whose header shows "✦ 2 to review" once the AI is done (and the "finished" notice says how many files). What's left to review is remembered across restarts.
- The file tree shows the AI's work: ✎ on files it is editing in the current turn, ✦ on files with unreviewed changes, and a violet dot on their folders. Clicking a ✦ file opens it at its first AI change; the right-click menu can review or accept a file's AI changes, or accept a whole folder's.

## [0.5.0] - 2026-10-11

### Added
- Smooth scrolling: the wheel and PageUp/PageDown glide (fast first, easing out) in the editor and the Markdown preview; consecutive wheel steps add up, and a key stops the motion. `editor.smoothScrolling: false` turns it off.
- Delete a branch: Shift+Delete, the × on the selected row or a right-click in the branch picker (Ctrl+Alt+B), or "Delete a branch" in the palette. Asks first, and again before deleting unmerged work; the current branch is protected.
- Several agents side by side (#18): Ctrl+Alt+N opens another CLI in an AI pane tab (`ai.agents` lists extra ones), optionally in its own git worktree on a new branch. Tabs keep running when hidden and show working / done / needs you; Ctrl+Alt+PageDown/PageUp switch, and "send to AI" goes to the visible tab. Close a tab with its ×, a middle-click or Ctrl+Alt+W; closing a worktree tab offers to remove the worktree (the branch stays).
- AI turns (Ctrl+Alt+Z, #15): every prompt that changes files becomes a turn listing the files, +/− counts and each change since before the turn. Undo the whole turn, one file or one change; files the AI created are removed. Exact even with your own uncommitted edits (a `git stash create` snapshot at the start of each turn), and works with any AI CLI.
- Markdown preview: GitHub's emoji shortcodes (`:rocket:` → 🚀, not in code) and HTML tables, rendered like Markdown tables with their alignment (#14).
- Syntax highlighting for Python, Rust, Go, C, C++, Bash, HTML, CSS, JSON/JSONC, YAML and TOML (#4, #5, #6), in the editor and in Markdown code blocks. The official Tree-sitter grammars are embedded in the binary.
- Send problems or changes to the AI in one key (#17): Ctrl+K F types the errors and warnings (`@file#L12 error: …`) with "fix these"; Ctrl+K D types your git diff with "review these". Also `f` in the Problems list, `v` in Source control, and "Ask AI to fix" in the quick-fix menu (Alt+.).

### Changed
- Less work per key, cursor move and AI output: cursor moves no longer re-render the whole UI (only the status bar and breadcrumbs follow them), tabs and the Markdown preview re-render only when their own content changes (with parsing and image sizes cached), and streaming AI output updates the pane once per stretch instead of per chunk. Polling and GIFs pause while the terminal window is in the background, and agent tabs stop ticking when idle. `CE_PERF` also logs React commits per second in `bun run dev`.
- Faster typing in big files: a key no longer reads and hashes the whole file (the dirty check compares sizes first), the syntax-colour pass after a pause blocks half as long, git change markers diff only the edited region (so files over 20,000 lines get them too), autocomplete sends the file to the language server once instead of twice, and breadcrumbs stop re-asking for symbols after every pause.

## [0.4.0] - 2026-10-11

### Added
- Alerts when the AI finishes or waits for your answer while you're not looking: a notice, the terminal bell, and ✓ done / ⚠ needs you in the AI header and status bar. `ai.notify: "desktop"` adds a system notification (Windows toast on WSL, macOS Notification Center, notify-send); `"off"` disables them.
- Double-click a pane divider to reset that pane to its default width.

### Fixed
- Commits could still fail on "index.lock" while the source control panel showed a diff: every git read copane runs now skips optional locks.
- Large dialogs (source control, history, help) fade the screen behind them, so their margins no longer show stray letters and icons from the panes (#13).
- Staging and committing no longer fail at random with "index.lock: File exists": the background git status no longer takes git's index lock.

## [0.3.0] - 2026-10-11

### Added
- Markdown preview: live beside the file (Ctrl+K V) or as a tab (Alt+Shift+V). It renders GitHub-flavoured Markdown like GitHub does: headings, strikethrough, task lists, alerts, aligned tables, footnotes, highlighted code, local images, and README HTML (centred blocks, `<b>`, `<br>`, `<img>`, `<details>`).
- Images (PNG, JPEG, WebP, GIF) open as a tab showing the picture, drawn with kitty graphics or sixel when the terminal supports them and coloured blocks otherwise. `preview.imageProtocol` overrides the choice. Animated GIFs play, in image tabs (Space pauses) and in the Markdown preview.
- Reveal in File Explorer (WSL), Reveal in Finder (macOS) or Open Containing Folder (Linux): in the file tree's right-click menu, and on Shift+Alt+R as in VS Code.

### Fixed
- After a chord like Ctrl+K Z, the "waiting for the second key" message goes away at once.

## [0.2.0] - 2026-10-11

### Added
- `copane --upgrade` installs the latest release in place; open editors offer a restart.
- `copane --install-font` installs the bundled Nerd Font for file-tree icons. The font is embedded in the binary, so release installs get it too, and `install.sh` runs it (`FONT=0` skips).
- Contributing guide, issue and pull request templates, security policy and code of conduct.
- `scripts/demo/demo.tape` records the README demo with vhs.

### Fixed
- Git marks, staging and blame work when the project path goes through a symlink (for example macOS's `/var`).

## [0.1.0] - 2026-10-11

First public release.

- Terminal editor with Claude Code (or any AI CLI) in a side pane: send selections with Ctrl+L, live reload of AI edits, diff review, and merging when you both edit a file.
- Language servers, autocomplete, go to definition, rename, multi-cursor, Tree-sitter highlighting, and project search and replace.
- Git: hunk staging, commits with AI-written messages, push and pull, blame, file history, branches and merge conflicts.
- VS Code keys and settings import.
- Release binaries for Linux and macOS (x64 and arm64), and a one-line installer.

[Unreleased]: https://github.com/sevheng/copane/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/sevheng/copane/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/sevheng/copane/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/sevheng/copane/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/sevheng/copane/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/sevheng/copane/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/sevheng/copane/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/sevheng/copane/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/sevheng/copane/releases/tag/v0.1.0
