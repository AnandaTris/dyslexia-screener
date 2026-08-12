// Fixed-window rate limiting, per key, in this process.
//
// What it protects: `/api/chat` and `/api/journey` each hand work to a local
// CPU-bound model that occupies the machine for tens of seconds — 16-20 s for a
// warm grounded answer, 72-122 s for a journey (README, "Known limitations").
// Every other endpoint is a database read. So the budget that matters is how
// often one account may *start* one of those, not how many bytes it sends.
//
// In-process and in-memory on purpose. The thing being protected is one
// machine's CPU, and the app runs as a single Next.js server beside a single
// uvicorn worker (WORKFLOW.md). Two consequences worth knowing before this
// moves anywhere else:
//
//   - Counters reset when the server restarts. Acceptable here: a restart also
//     clears the work the limit exists to protect.
//   - Behind more than one instance, each holds its own counter and the real
//     limit is the per-instance one multiplied by the instance count. That is
//     the point at which this needs shared state (Redis) rather than a Map.

const windows = new Map();

// Expired entries are only removed on access, so a burst of one-off keys would
// otherwise sit in the Map until restart. Sweeping every N calls keeps that
// bounded without paying a full scan per request.
const SWEEP_EVERY = 256;
let callsSinceSweep = 0;

function sweep(now) {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

/**
 * Records one attempt against `key` and says whether it is allowed.
 *
 * `now` is injectable so the tests can advance time without fake timers.
 *
 * @returns {{allowed: boolean, remaining: number, retryAfterSeconds: number}}
 */
export function rateLimit(key, { limit, windowMs }, now = Date.now()) {
  if (++callsSinceSweep >= SWEEP_EVERY) {
    callsSinceSweep = 0;
    sweep(now);
  }

  const current = windows.get(key);

  // No window, or the previous one has run out: this attempt opens a new one.
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (current.count >= limit) {
    // Deliberately does not extend the window. Punishing a caller for retrying
    // turns a brief overshoot into a lockout that outlasts the load it caused.
    return {
      allowed: false,
      remaining: 0,
      // Round up, and never report 0 — a `Retry-After: 0` invites an immediate
      // retry that is certain to fail again.
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  return { allowed: true, remaining: limit - current.count, retryAfterSeconds: 0 };
}

/** Clears every window. For tests — module state otherwise leaks between them. */
export function resetRateLimits() {
  windows.clear();
  callsSinceSweep = 0;
}
