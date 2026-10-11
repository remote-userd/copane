# Records docs/demo.gif. Run from the repo root: vhs scripts/demo/demo.tape
# Needs vhs, ttyd, ffmpeg, `ce` and `claude` (logged in) on PATH, and the Nerd Font
# installed for Linux (`ce --install-font`). See scripts/demo/README.md.

Output docs/demo.gif

Require ce
Require claude

Set Shell bash
Set FontFamily "CaskaydiaMono Nerd Font"
Set FontSize 16
Set Width 1600
Set Height 900
Set Padding 16
Set Theme "Catppuccin Mocha"
Set WindowBar Colorful
Set TypingSpeed 60ms

# Copy the sample project to a scratch git repo, so the recording never edits the repo itself.
Hide
# Recorded from inside a Claude Code session, its variables would reach the demo's Claude.
Type `unset CLAUDECODE CLAUDE_PID CLAUDE_EFFORT $(env | sed -n 's/^\(CLAUDE_CODE_[A-Z_]*\)=.*/\1/p')`
Enter
Type "export XDG_CONFIG_HOME=$PWD/scripts/demo/home/config XDG_STATE_HOME=$PWD/scripts/demo/home/state"
Enter
Type "rm -rf /tmp/copane-demo && cp -r scripts/demo/project /tmp/copane-demo && cd /tmp/copane-demo"
Enter
Type "git init -q -b main && git add . && git -c user.name=demo -c user.email=demo@example.com commit -qm init"
Enter
# Claude asks whether to trust a new folder, defaulting to "No, exit": answer it once here.
# Once trusted, these keys only send an empty prompt and /exit.
Type "claude"
Enter
Sleep 8s
Down
Enter
Sleep 3s
Type "/exit"
Sleep 500ms
Enter
Sleep 2s
Type "clear"
Enter
Show

Type "ce ."
Sleep 500ms
Enter
Wait+Screen@30s /ready/
Sleep 1.5s

# Open a file with Ctrl+P.
Ctrl+P
Sleep 500ms
Type "cart"
Sleep 800ms
Enter
Sleep 2s

# Send the whole file to the AI (Ctrl+L with nothing selected), then ask.
Ctrl+L
Sleep 1.5s
Type "the total is wrong, fix it"
Sleep 500ms
Enter

# Claude edits the file: the buffer reloads, changed lines flash, the gutter marks them.
Wait+Screen@120s /Reloaded/
Sleep 4s

# Review every change with its diff.
Ctrl+Alt+D
Sleep 4s
Escape
Sleep 1s

# Quit (the AI pane stops with the editor).
Ctrl+Q
Sleep 1s
