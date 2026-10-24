import type { Config } from "../config/schema"

/** Mac keys (Cmd shortcuts, Option/Cmd text navigation, ⌘ labels): config.keyStyle, "auto" = on macOS. */
export function macKeys(config: Pick<Config, "keyStyle">): boolean {
  return config.keyStyle === "mac" || (config.keyStyle === "auto" && process.platform === "darwin")
}

/**
 * Whether Cmd reaches us: only terminals speaking the kitty keyboard protocol send it (Ghostty,
 * kitty, WezTerm, iTerm2 with CSI u). Labels show ⌃ instead of ⌘ while it doesn't.
 */
let cmdReachable = false

export function setCmdReachable(on: boolean): void {
  cmdReachable = on
}

export function isCmdReachable(): boolean {
  return cmdReachable
}

/** What labels need: Mac symbols, and whether Cmd can stand in for Ctrl. */
export function keyStyleOf(config: Pick<Config, "keyStyle">): { mac: boolean; cmd: boolean } {
  return { mac: macKeys(config), cmd: cmdReachable }
}

export function resetKeyPlatform(): void {
  cmdReachable = false
}
