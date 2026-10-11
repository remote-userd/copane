# Changelog

All notable changes to copane are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.0] - 2026-10-11

### Added
- Alerts when the AI finishes or waits for your answer while you're not looking: a notice, the terminal bell, and ✓ done / ⚠ needs you in the AI header and status bar. `ai.notify: "desktop"` adds a system notification (Windows toast on WSL, macOS Notification Center, notify-send); `"off"` disables them.
- Double-click a pane divider to reset that pane to its default width.

### Fixed
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

[Unreleased]: https://github.com/sevheng/copane/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/sevheng/copane/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/sevheng/copane/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/sevheng/copane/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/sevheng/copane/releases/tag/v0.1.0
