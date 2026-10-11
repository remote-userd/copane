/**
 * Smooth scrolling: spread a scroll of some lines over a few frames, fast first and slowing at
 * the end (a third of what's left each frame: about 50 ms for a wheel step, 150 ms for a page).
 * A scroll that arrives mid-glide in the same direction adds to it, so a fast wheel spin stays
 * fluid; one the other way starts over.
 */
export class Glide {
  private remaining = 0
  private move: ((k: number) => void) | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  /** Whether to glide at all; off, `by` moves at once. */
  constructor(public enabled = true, private frameMs = 16) {}

  get active(): boolean {
    return this.timer !== null
  }

  /** Move `total` lines in steps; `move` is called with each step's lines. */
  by(total: number, move: (k: number) => void): void {
    if (!total) return
    if (!this.enabled) return move(total)
    if (this.timer && Math.sign(this.remaining) === Math.sign(total)) {
      this.remaining += total
      this.move = move
      return
    }
    this.stop()
    this.remaining = total
    this.move = move
    this.timer = setInterval(() => this.step(), this.frameMs)
    this.step()
  }

  /** End the glide where it is. */
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.remaining = 0
    this.move = null
  }

  private step(): void {
    const left = this.remaining
    const move = this.move
    if (!left || !move) return this.stop()
    const k = Math.sign(left) * Math.max(1, Math.ceil(Math.abs(left) / 3))
    this.remaining -= k
    move(k)
    if (this.remaining === 0) this.stop()
  }
}
