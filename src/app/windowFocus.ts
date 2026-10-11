import { Store } from "./store"

/**
 * Whether the terminal window has focus (the renderer's focus/blur events, set in main.tsx).
 * Polling and animations pause while you're in another app; it starts focused, so tests and
 * terminals without focus reporting behave as before.
 */
export const windowFocus = new Store<{ focused: boolean }>({ focused: true })
export const windowFocused = () => windowFocus.get().focused
