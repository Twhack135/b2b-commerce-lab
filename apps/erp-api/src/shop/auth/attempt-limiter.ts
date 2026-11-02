// Counts attempts per key (e.g. an e-mail address or a client address)
// within a fixed time window. When the limit is reached, further attempts
// are refused until the window has passed.
//
// An attempt is counted BEFORE it is checked (acquire): checking and
// counting happen in one synchronous step, so concurrent requests cannot
// all pass before the first failure is recorded. A successful attempt
// gives its slot back (release) or clears the key (reset).
//
// DEVELOPMENT ONLY (docs/adr/0003, 0006): the counters live in the memory
// of one ERP process. They start again after a restart and are not shared
// between processes, so they are no durable or distributed rate limit. The
// number of keys is capped, so many different keys cannot exhaust memory.

const MAX_KEYS = 10_000;

export class AttemptLimiter {
  private readonly windows = new Map<
    string,
    { count: number; start: number }
  >();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  /** True while the key has reached the limit in its current window */
  isBlocked(key: string): boolean {
    const window = this.current(key);
    return window !== undefined && window.count >= this.limit;
  }

  /**
   * Counts one attempt and answers true, or answers false (and counts
   * nothing) if the key is blocked
   */
  acquire(key: string): boolean {
    if (this.isBlocked(key)) return false;
    const window = this.current(key);
    if (window) {
      window.count += 1;
      return true;
    }
    if (this.windows.size >= MAX_KEYS) this.evictExpired();
    if (this.windows.size >= MAX_KEYS) {
      // Still full: forget the oldest window (Map keeps insertion order)
      const oldest = this.windows.keys().next().value;
      if (oldest !== undefined) this.windows.delete(oldest);
    }
    this.windows.set(key, { count: 1, start: this.now() });
    return true;
  }

  /** Gives back the slot of a successful attempt */
  release(key: string): void {
    const window = this.current(key);
    if (window && --window.count <= 0) this.windows.delete(key);
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  private current(key: string) {
    const window = this.windows.get(key);
    if (window && this.now() - window.start >= this.windowMs) {
      this.windows.delete(key);
      return undefined;
    }
    return window;
  }

  private evictExpired() {
    const now = this.now();
    for (const [key, window] of this.windows) {
      if (now - window.start >= this.windowMs) this.windows.delete(key);
    }
  }
}
