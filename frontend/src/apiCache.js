/**
 * In-memory GET cache for the whole app (admin, instructor, student modules).
 *
 *   1. First visit          -> normal load from the server, response kept in memory.
 *   2. Switching back       -> served from memory instantly. No request, no loader.
 *   3. Database changed     -> (live sync, see liveSync.js, or your own save) the affected
 *                              entries are re-fetched SILENTLY; pages update in place.
 *   4. TTL ran out (safety) -> saved copy shown instantly + silent background refresh.
 *
 * Identical requests in flight share one call. The cache is wiped on login/logout.
 */

const MINUTE = 60 * 1000;

// First matching prefix wins. 0 = never cached. With live sync these are only a safety net.
const TTL_RULES = [
  ['/api/auth/', 0], // always the real session and security status (me, 2fa)
  ['/api/sync/', 0], // live-sync version counters
  ['/api/students/next-id/', 0], // must be fresh for each new registration
  ['/api/attendance/', MINUTE],
  ['/api/dashboard/', MINUTE],
  ['/api/reports/', 2 * MINUTE],
  ['/api/', 5 * MINUTE], // catalog: programs, courses, sections, subjects, users...
];

// POSTs that do not need a client-side refresh:
// - the per-frame enrollment check and token refresh change nothing;
// - face/recognize runs twice a second while scanning; when it actually marks someone,
//   the server bumps the attendance version and live sync refreshes (at most every 3 s).
// - two-step sign-in settings only change the user's own security status (never cached).
const NO_INVALIDATE = ['/api/face/enroll/check/', '/api/token/refresh/', '/api/face/recognize/', '/api/auth/2fa/'];

// Mutations with a narrow effect. Anything not listed refreshes the whole cache (always safe).
const INVALIDATE_RULES = [
  ['/api/attendance/', ['/api/attendance/', '/api/dashboard/', '/api/reports/']],
];

const entries = new Map(); // endpoint -> { response, text, expires, loadSilently, waitFor? }
const inflight = new Map(); // endpoint -> Promise<Response> (foreground loads)
const refreshing = new Map(); // endpoint -> { token, promise } of the refresh allowed to win
const listeners = new Set(); // (endpoint) => void, called when a silent refresh brought new data

export function ttlFor(endpoint) {
  const rule = TTL_RULES.find(([prefix]) => endpoint.startsWith(prefix));
  return rule ? rule[1] : 0;
}

/** Subscribe to "cached data was silently updated" events. Returns an unsubscribe fn. */
export function subscribeCacheUpdates(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearApiCache() {
  entries.clear();
  inflight.clear();
  refreshing.clear();
}

const matcher = (prefixes) => {
  const list = Array.isArray(prefixes) ? prefixes : [prefixes];
  return (key) => list.some((prefix) => key.startsWith(prefix));
};

/** Drop every cached entry whose endpoint starts with one of the prefixes. */
export function invalidateApiCache(prefixes) {
  const matches = matcher(prefixes);
  [...entries.keys()].filter(matches).forEach((key) => entries.delete(key));
  [...inflight.keys()].filter(matches).forEach((key) => inflight.delete(key));
  [...refreshing.keys()].filter(matches).forEach((key) => refreshing.delete(key));
}

const cacheable = (response) => response?.ok && typeof response.clone === 'function';

async function store(endpoint, response, ttl, loadSilently) {
  const copy = response.clone();
  const text = await response.clone().text().catch(() => null);
  entries.set(endpoint, { response: copy, text, expires: Date.now() + ttl, loadSilently });
  return text;
}

/** Silent refresh (no loader). Notifies pages only if the data really changed. */
function refreshInBackground(endpoint, ttl, { restart = false } = {}) {
  const running = refreshing.get(endpoint);
  if (running && !restart) return running.promise;
  const previous = entries.get(endpoint);
  if (!previous?.loadSilently) return Promise.resolve();
  const token = Symbol(endpoint);
  const current = () => refreshing.get(endpoint)?.token === token;
  const promise = Promise.resolve()
    .then(previous.loadSilently)
    .then(async (response) => {
      // A newer refresh (newer change) or an invalidation took over: that state wins.
      if (!current() || entries.get(endpoint) !== previous) return;
      if (!cacheable(response)) { if (previous.waitFor) entries.delete(endpoint); return; }
      const text = await store(endpoint, response, ttl, previous.loadSilently);
      if (text !== previous.text) listeners.forEach((listener) => listener(endpoint));
    })
    .catch(() => {
      // Offline: keep the saved copy, unless someone is waiting for fresh data.
      if (current() && previous.waitFor && entries.get(endpoint) === previous) entries.delete(endpoint);
    })
    .finally(() => { if (current()) refreshing.delete(endpoint); });
  refreshing.set(endpoint, { token, promise });
  return promise;
}

/**
 * Data changed: silently re-fetch every cached entry under these prefixes.
 * - wait: false (another user's change, via live sync): the old copy stays on screen
 *   until the new one arrives, then pages update in place.
 * - wait: true (your own save): reads wait for the fresh copy, so the page you are on
 *   never shows pre-save data. Other pages are already fresh when you switch to them.
 */
export function revalidateApiCache(prefixes, { wait = false } = {}) {
  const matches = matcher(prefixes);
  [...inflight.keys()].filter(matches).forEach((key) => inflight.delete(key)); // may be pre-change
  for (const [endpoint, entry] of entries) {
    if (!matches(endpoint)) continue;
    entry.expires = 0;
    const promise = refreshInBackground(endpoint, ttlFor(endpoint), { restart: true });
    if (wait) entry.waitFor = promise;
  }
}

/** Called after YOUR successful save/delete. */
export function invalidateAfterMutation(endpoint) {
  if (NO_INVALIDATE.some((prefix) => endpoint.startsWith(prefix))) return;
  const rule = INVALIDATE_RULES.find(([prefix]) => endpoint.startsWith(prefix));
  revalidateApiCache(rule ? rule[1] : ['/api/'], { wait: true });
}

/**
 * Serve a GET from memory, or load it once and keep it.
 * `load` is the normal request (shows loaders); `loadSilently` is used for
 * background refreshes (no loader). Every caller gets its own clone.
 */
export async function cachedGet(endpoint, load, loadSilently = load) {
  const ttl = ttlFor(endpoint);
  if (ttl <= 0) return load();

  // After your own save, wait for the fresh copy instead of showing the old one.
  for (let i = 0; i < 3; i += 1) {
    const waiting = entries.get(endpoint)?.waitFor;
    if (!waiting) break;
    await waiting.catch(() => {});
    const after = entries.get(endpoint);
    if (after?.waitFor === waiting) { delete after.waitFor; break; }
  }

  const hit = entries.get(endpoint);
  if (hit) {
    if (hit.expires <= Date.now()) refreshInBackground(endpoint, ttl);
    return hit.response.clone(); // instant
  }

  let pending = inflight.get(endpoint);
  if (!pending) {
    pending = Promise.resolve().then(load);
    inflight.set(endpoint, pending);
    pending
      .then((response) => {
        // Skip if a data change invalidated this load while it was running.
        if (inflight.get(endpoint) === pending && cacheable(response)) return store(endpoint, response, ttl, loadSilently);
        return null;
      })
      .catch(() => {})
      .finally(() => { if (inflight.get(endpoint) === pending) inflight.delete(endpoint); });
  }
  const response = await pending;
  return cacheable(response) ? response.clone() : response;
}
