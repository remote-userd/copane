/**
 * The cursor in AI pane tabs follows `editor.cursorStyle`. The emulator draws the shape its
 * program asks for (DECSCUSR, `ESC [ n SP q`); copane sets the configured one first and again
 * whenever the program goes back to the default (`ESC [ 0 SP q` or `ESC [ SP q`). A program that
 * asks for a shape of its own (vim's block in normal mode) still gets it.
 */
const SEQUENCE = { line: "\x1b[5 q", block: "\x1b[1 q", underline: "\x1b[3 q" } as const

export function cursorSequence(style: keyof typeof SEQUENCE): string {
  return SEQUENCE[style]
}

/** Whether output resets the cursor shape to the terminal's default. */
export function resetsCursorStyle(data: Uint8Array): boolean {
  for (let i = data.indexOf(0x71); i !== -1; i = data.indexOf(0x71, i + 1)) {
    if (data[i - 1] !== 0x20) continue
    const j = data[i - 2] === 0x30 ? i - 3 : i - 2
    if (data[j] === 0x5b && data[j - 1] === 0x1b) return true
  }
  return false
}
