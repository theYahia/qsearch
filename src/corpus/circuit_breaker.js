// Circuit breaker for corpus backends. The 30s health poll is coarse: between polls, a flapping or
// slow Qdrant makes EVERY corpus search pay its full timeout before falling back. This bounds that —
// after N consecutive failures (or timeouts) a backend's circuit OPENS and is skipped instantly for a
// cooldown, then HALF-OPENS to probe once. Net effect: a dead Qdrant degrades to Meilisearch-only in
// milliseconds, and recovers on its own. Pure, clock-injectable, no deps.

/** Race a promise against a timeout. ms<=0 disables. onTimeout (if given) RESOLVES with its value
 *  instead of rejecting — used to fall back fast without throwing. */
export function withTimeout (promise, ms, onTimeout) {
  if (!ms || ms <= 0) return Promise.resolve(promise)
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { onTimeout ? resolve(onTimeout()) : reject(new Error(`timeout after ${ms}ms`)) }, ms)
    Promise.resolve(promise).then(
      v => { clearTimeout(t); resolve(v) },
      e => { clearTimeout(t); reject(e) }
    )
  })
}

export class CircuitBreaker {
  /** @param {{failureThreshold?:number, cooldownMs?:number, timeoutMs?:number, name?:string, now?:()=>number}} [o] */
  constructor ({ failureThreshold = 3, cooldownMs = 15000, timeoutMs = 0, name = 'cb', now = Date.now } = {}) {
    this.failureThreshold = failureThreshold
    this.cooldownMs = cooldownMs
    this.timeoutMs = timeoutMs
    this.name = name
    this._now = now
    this.failures = 0
    this.state = 'closed' // 'closed' | 'open' | 'half-open'
    this.openedAt = 0
    this.trips = 0 // observability: total times the circuit has opened
  }

  _trip () { this.state = 'open'; this.openedAt = this._now(); this.trips++ }
  _reset () { this.failures = 0; this.state = 'closed' }

  /**
   * Run fn under the breaker. On an OPEN circuit (within cooldown) or on failure/timeout, returns the
   * fallback (a value, or a thunk that produces one) instead of throwing — callers never see backend errors.
   */
  async run (fn, fallback) {
    const fb = () => (typeof fallback === 'function' ? fallback() : fallback)
    if (this.state === 'open') {
      if (this._now() - this.openedAt < this.cooldownMs) return fb() // skip instantly
      this.state = 'half-open' // cooldown elapsed → allow exactly one probe
    }
    try {
      const r = await withTimeout(Promise.resolve().then(fn), this.timeoutMs)
      this._reset() // success (incl. a successful half-open probe) closes the circuit
      return r
    } catch {
      this.failures++
      // a failed probe re-opens immediately; otherwise open once the threshold is reached
      if (this.state === 'half-open' || this.failures >= this.failureThreshold) this._trip()
      return fb()
    }
  }

  /** True unless the circuit is open and still cooling down (for /health reporting). */
  get healthy () { return this.state !== 'open' || (this._now() - this.openedAt >= this.cooldownMs) }
  snapshot () { return { name: this.name, state: this.state, failures: this.failures, trips: this.trips } }
}
