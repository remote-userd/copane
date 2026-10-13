# Manual smoke checklist

Run in a real terminal, in plain mode and inside tmux.

1. `bun run dev some-file.ts` opens the file with syntax colours and line numbers.
1a. The sidebar's tab row shows the project folder name on the right, and the terminal tab is titled with it. After Ctrl+Q the shell gets its own title back.
1b. Push to an ssh remote whose key needs a passphrase (not in an agent). Source control shows an error within a few seconds; the screen is not garbled and keys still work.
1c. In a repo with `core.autocrlf=true`, change one line and stage just that hunk (gutter). Source control shows one line staged, not the whole file. Then press Space quickly on several files: no "index.lock" error.
1d. Source control: stage the middle of three changed files; the selection moves to the next one. Press → on a file with two changes, ↓, Space: only that change is staged. Right-click a file: the menu works and the panel comes back. `m` with a multi-line AI message: Ctrl+J adds lines, and the commit keeps the body.
1e. Open `ce` in a folder that is not a repo, run `git init` in another terminal, then come back to the window: the tree shows `U` marks. In a repo, run `git fetch` or `git reset --soft HEAD~1` in another terminal: the status bar and Source control update within a few seconds.
1f. In Source control press P (push), then Esc right away: the status bar shows a spinner and "Pushing…" next to the branch, and "Pushed" (or the error) comes as a notice.
1g. Put the cursor on a keyword used several times (`export`, `const`): its other uses get a background and keep their colour. Ctrl+F on it: the matches keep their colour too.
2. Type, then press Ctrl+S. The dirty dot clears and the file on disk matches.
3. Ctrl+Z after saving marks the tab dirty again.
4. Ctrl+P, type part of a path, press Enter. The file opens in a new tab and is revealed in the tree.
5. Ctrl+PageDown / Ctrl+PageUp switch tabs, and undo still works after switching.
6. Ctrl+W on a dirty tab asks to save, discard or cancel.
7. Ctrl+B focuses the tree. Arrows, Enter and Left/Right work. Ctrl+B again hides it.
8. Ctrl+J focuses the AI pane. Claude's prompt takes input, and Esc and Shift+Tab reach Claude.
9. Ask Claude to edit the open file. The buffer reloads with a "Reloaded" notice, and Ctrl+Z restores your version.
10. Make an unsaved edit, then have Claude edit the same file. The conflict bar appears. Ctrl+R takes Claude's version and Ctrl+S keeps yours.
11. Select lines with Shift+arrows and press Ctrl+L. Claude's prompt receives `@file#Lx-y` and the snippet, without submitting.
12. Resize the window. The editor and Claude both reflow.
13. Exit Claude with /exit. The pane offers a restart on Enter.
14. Ctrl+Q with unsaved changes prompts. After quitting, no `claude` process is left (`pgrep -f claude`).
15. Set `"ai": {"command": "nope"}` in the config. The pane explains the command was not found.

## Mouse

16. Click in the editor: the cursor moves and the status bar shows the new line and column.
17. Wheel over the editor: the view scrolls and the cursor stays put. Typing jumps back to it.
18. Click the editor while the tree is focused, then type: the text goes into the editor.
19. Click a line number, then drag down the gutter: whole lines are selected.
20. Drag the border between the tree and the editor, and between the editor and the AI pane: both resize.
21. Tabs: × closes, middle-click closes, a dirty tab asks first, and the wheel over the tab bar cycles.
22. Right-click inside a selection, choose Copy, and paste in another app: the text matches, including non-ASCII.
23. Ctrl+V pastes text copied in another app.
24. Select text in the AI pane with the mouse: a "Copied" notice appears and the clipboard holds it.
25. Ctrl+P, then hover, wheel and click in the list. Clicking outside the dialog closes it.
26. Tree: right-click a row, New File, type `x/y.ts`: folder and file appear and the file opens.
27. Tree: rename an open file with `r`: the tab name follows. Delete it with Delete: confirm, the tab closes.
28. In a git repo: save an edit to a tracked file: it shows a yellow M and its folder a •. Commit in a shell: the marks clear within ~2 s.
29. After the first `bun run install:cli` on WSL, close all Windows Terminal windows, reopen, and run `ce .`: tree rows show file-type icons, not boxes. TS is blue, JSON is yellow, folders show a folder icon. Set `tree.icons` to `"simple"` and restart (Ctrl+Alt+R): coloured symbols instead.
30. Ask Claude to change a file: the changed lines flash, and the line numbers show ▎ markers. Ctrl+Alt+D lists the file with its diff. `r` then `y` reverts it.
31. Type in a file, then ask Claude to change a different line: the bar offers "Merge both". Merging keeps both edits, and Ctrl+Z undoes the merge.
32. Ctrl+F `total` shows n/m and highlights, Enter cycles through matches, Ctrl+F again shows replace. Ctrl+G `10:3` jumps there. Ctrl+Alt+F `qty` lists matches in all files.
33. F1, type `maxim`, Enter: the editor fills the window. Ctrl+Alt+M restores it. Ctrl+Alt+J hides and shows the AI pane.
34. Type in a file, then press Ctrl+J: a notice says the file was saved so the AI sees it.
35. In a TypeScript project, open a file with a type error: a red ● and underline appear, and the status bar shows ✖ 1. F8 jumps to the error and shows its message.
36. Type `.` after a string variable: suggestions appear. Typing filters them, and Tab inserts one. F12 on an imported function opens its file at the definition.
37. Alt+Z on a file with long lines: they wrap, line numbers stay correct, and clicking a wrapped row puts the cursor in the right place.
38. F2 on an imported function: give it a new name. Its definition file and all uses change. Shift+F12 lists references. Ctrl+Alt+L tidies spacing.
39. Type `greet(` in a TypeScript file: the signature appears above the cursor, and it closes after `)`.
40. Ctrl+D three times on a variable name, type a new name: all three change, and a longer name containing it does not. Esc ends.
41. Layout: no boxes, single dividers between panes, and they drag to resize. Tabs show icons, and the active one is accent-coloured when the editor has focus. Breadcrumbs show folder › file › symbol. The status bar shows the branch on the left and the AI on the right.
42. Put the cursor on a `(`: it and its partner are highlighted. On an identifier, other uses get a subtle background. The current line is slightly lighter. Indented blocks show faint guides.
43. Edit two places in a tracked file. Alt+H on one, then `s`: only that change is staged (Ctrl+Alt+D shows it under Staged and the other under Changes).
44. In Source Control, `m` fills an AI commit message. Enter commits, and `P` pushes (or offers to publish the branch).
45. The status bar shows blame for the cursor line. Ctrl+Alt+G lists the file's commits with diffs.
46. Ctrl+Alt+B, type a new name, Enter: the branch is created and checked out. Merge a conflicting branch, open the file, and Alt+3 keeps both sides.
47. In a big repo: the first Ctrl+P opens instantly. Empty, it shows recent files. `@` lists this file's symbols (test files list describe/it blocks), and `:500` jumps.
48. F12 or a search result, then Ctrl+Alt+← returns to where you were, and Ctrl+Alt+→ goes forward again.
49. Typing in a 10,000-line file feels immediate (CE_PERF log under ~50 ms per key). Colours, the ● dirty dot, git change markers and breadcrumbs still follow the edits, and undoing back to the saved text clears the dot.

## Markdown and images

50. Open README.md and press Ctrl+K V: the rendered view appears beside it. Type a heading: the preview follows within a moment. Ctrl+K V again closes it.
51. Alt+Shift+V on README.md opens "Preview README.md" as a tab. Arrows and PgDn scroll it, and the wheel scrolls it. Alt+Shift+V again returns to the file.
52. In Windows Terminal (1.22+), open a PNG from the tree: a sharp picture with "PNG · w×h · size" above it. Inside tmux the same file shows as coloured blocks.
53. With an image tab showing, open F1 and a right-click menu over it, then close them: no picture fragments are left on top of the UI. Switch tabs and back: the picture redraws.
54. A Markdown file with `![x](pic.png)` next to it shows the picture in the preview, while a badge URL shows its alt text.
55. Open docs/demo.gif: it plays, and the header says "435 frames · ▶ playing". Space pauses and resumes. Switch to another tab and back: it picks up again.
56. Right-click a file in the tree, Reveal in File Explorer: Windows Explorer opens with the file selected (Finder on macOS). Shift+Alt+R does the same for the tree's selection, and for the open file from the editor. Right-click empty space in the tree: it offers revealing the project folder.
57. Ask Claude for a change, then press Ctrl+B (tree) while it works: when it finishes, a notice says "claude finished", the bell rings (Windows Terminal flashes the taskbar), and the AI header and status bar show ✓ done until Ctrl+J. With `ai.notify: "desktop"`, a Windows toast appears too.
58. Ask for something that needs approval (a shell command), and switch to the editor: "⚠ needs you" and a warning notice appear. Answer in the pane: the badge clears.
59. Drag the tree's and the AI pane's dividers, then double-click each: the pane goes back to its default width, and stays so after a restart.
60. In a TypeScript file with a type error, press Ctrl+K F: the AI prompt gets "Fix this problem…" and `@file#Lnn error: …`, not submitted. Alt+. on the error's line offers "Ask AI to fix". Ctrl+Alt+E, then `f`, sends every problem listed.
61. Change a tracked file and add a new one, then press Ctrl+K D (or `v` in Source control): the prompt gets "Review these changes…", the diff, and "New files: @…", not submitted.
62. Ask Claude to change two files (one new). When it's done, Ctrl+Alt+Z shows the turn with your prompt, both files (A for the new one) and the changes. `r` on a change reverts just it; `u` restores both files and deletes the new one; open tabs reload and Ctrl+Z brings the AI's version back.
63. Edit one of the turn's files yourself, then `u` in Ctrl+Alt+Z: it warns that the file changed since and asks before undoing.
64. Ctrl+Alt+N, "New claude": a second tab starts. Ask each tab something different; switch with Ctrl+Alt+PageDown: both keep their sessions, the hidden one's tab shows a spinner while it works and ✓ when done. Ctrl+L sends to the visible tab.
65. Ctrl+Alt+N, "New claude in a git worktree": a worktree appears beside the project (`git worktree list`) on branch copane/claude-1, and the tab shows the branch. Right-click › Close this agent › Remove worktree: the folder goes, the branch stays. Ask that agent to change two files (and commit one): its tab shows "· 2". Right-click › Review & merge this agent: both files with diffs; m merges them into your branch (`git log` shows a merge), then "Remove and close" removes the worktree, branch and tab. Repeat with d: the work is gone and nothing reaches your branch.
66. Ctrl+Alt+B, select a merged branch, Shift+Delete, y: it's gone (`git branch`). Do the same on a branch with its own commit: a second warning about unmerged commits appears, and only a second y deletes it. Shift+Delete on the current branch only explains it can't. With the mouse: hover a branch and click "× delete", or right-click it.
67. Scroll a long file with the wheel: lines glide instead of jumping, and a fast spin stays fluid. PageDown glides a screen with the cursor keeping its place. Typing mid-glide stops it at once. In the Markdown preview the wheel and PageDown glide too. With `editor.smoothScrolling: false`, both jump again.
68. Ask Claude to change two places in one file and one place in another. When it's done: violet ┃ markers on the changed lines, a "✦ 2 AI changes (+1 file)" bar, "✦ 2 to review" in the status bar. From the editor, Alt+N: the peek shows the old lines. `a` accepts (the marker goes, the text stays) and moves to the next; `r` undoes that one (Ctrl+Z brings it back). Alt+N then opens the other file; after the last `a`, "All AI changes reviewed" and the bar and count are gone. Click a violet marker: the same peek. While Claude is still working, the tree shows ✎ on the files it touched and a violet • on their folders; afterwards they show ✦ until reviewed. Clicking a ✦ file opens it at its first AI change; right-click › Accept AI Changes clears its marks. Leave one file unreviewed and restart (Ctrl+Alt+R): its ✦ and violet markers are back. Have Claude change something again and stay in the AI pane: the header shows "✦ 1 to review" and the notice mentions Ctrl+Alt+V; Ctrl+Alt+V lands in the editor on the change with the peek open. Commit one of the marked files (Ctrl+Alt+D, or `! git commit -am x` in the AI pane): its ✦, markers and bar go within a second; the uncommitted ones stay.
69. Open a file, type without saving, then change the same file from the AI pane (`! echo x >> file`) while the watcher is paused (or on a /mnt/c path): Ctrl+S asks "changed on disk": o overwrites, c compares. Save all lists the file instead of saving it.
70. Preview a Markdown file with `<p align="center"><img src="https://example.com/logo.png" alt="logo"></p>` and `![x](50%.png)`: it shows "🖼 logo" and stays responsive.
71. Open a file with a form feed (`printf 'a\fb\n' > ff.txt`): a warning bar says saving removes control characters; Ctrl+S asks first. A Latin-1 file (`printf 'caf\xe9\n' > l.txt`) is refused with a notice.
72. With an older installed release (or `"update": "notify"`), start `ce` and wait ~15 s: with "auto", a notice says the new release was installed and the status bar offers a restart; with "notify", the status bar shows "⬆ copane vX: install" and clicking it installs. `~/.local/state/copane/update.json` records the check; a second start within a day doesn't check again.
73. F1 › Report a problem: the AI pane gets a prompt with the copane version, OS, terminal and error-log tail (no /home/<you> paths). Type "the preview froze", Enter: Claude searches issues, shows a draft and asks before posting. Answer no: nothing is posted.
