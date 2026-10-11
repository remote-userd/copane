type Listener = () => void

/** Minimal external store for useSyncExternalStore. */
export class Store<T extends object> {
  private listeners = new Set<Listener>()
  constructor(private state: T) {}
  get = (): T => this.state
  set = (patch: Partial<T> | ((s: T) => Partial<T>)): void => {
    const next = typeof patch === "function" ? patch(this.state) : patch
    this.state = { ...this.state, ...next }
    for (const l of this.listeners) l()
  }
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
}
