# Demo recording

`demo.tape` records `docs/demo.gif`, the animation at the top of the README, with
[vhs](https://github.com/charmbracelet/vhs). It drives the real editor and the real Claude Code,
so every take is a little different.

## Setup (once)

- **vhs, ttyd and ffmpeg** on your PATH. See [vhs's install guide](https://github.com/charmbracelet/vhs#installation). ttyd is a single binary from its [releases](https://github.com/tsl0922/ttyd/releases).
- **`ce`** installed (`bun run install:cli`, or the release installer).
- **`claude`** installed and logged in. The demo runs it with `--permission-mode acceptEdits`, so edits go through without prompts.
- **The Nerd Font, installed for Linux:** vhs renders in a headless browser that uses the system's fonts. On macOS and Linux, `ce --install-font` covers it. On WSL that command installs the font for Windows only, so copy it yourself:
  ```sh
  mkdir -p ~/.local/share/fonts && cp assets/fonts/*.ttf ~/.local/share/fonts/ && fc-cache -f
  ```

## Record

From the repo root:

```sh
vhs scripts/demo/demo.tape
```

The sample project in `project/` is copied to `/tmp/copane-demo` first, so the recording never changes the repo. The config and pane widths come from `home/`, not yours. Check the GIF, then commit `docs/demo.gif`. If Claude's answer took too long or went off track, record again.
