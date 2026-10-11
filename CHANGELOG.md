# Changelog

All notable changes to copane are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/sevheng/copane/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/sevheng/copane/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/sevheng/copane/releases/tag/v0.1.0
