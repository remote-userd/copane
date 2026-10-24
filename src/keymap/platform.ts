import type { Config } from "../config/schema"

let autoMac = process.platform === "darwin"

/** Mac keys (Cmd shortcuts, Option/Cmd text navigation, ⌘ labels): config.keyStyle, "auto" = on macOS. */
export function macKeys(config: Pick<Config, "keyStyle">): boolean {
  return config.keyStyle === "mac" || (config.keyStyle === "auto" && autoMac)
}

/** Tests: what "auto" means, so they see the same keys on a Mac as on Linux. */
export function setAutoMac(on: boolean): void {
  autoMac = on
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
