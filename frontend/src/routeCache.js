/**
 * Lightweight in-memory stale-while-revalidate cache & route prefetcher for SPA navigation.
 *
 * - Purely in-memory (never persisted to localStorage/sessionStorage for security).
 * - Cleared immediately on logout or 401.
 * - Automatically invalidated on mutating API calls.
 */

const MAX_ENTRIES = 40;
const DEFAULT_TTL_MS = 120_000;
const SESSION_TTL_MS = 300_000;

const cache = new Map();
const inflight = new Map();
const prefetchedChunks = new Set();
let cachedSession = null;
let cachedSessionAt = 0;

if (typeof window !== 'undefined') {
  window.addEventListener('primus:logout', () => {
    clearAllCache();
  });
}

export function getCached(key, maxAgeMs = DEFAULT_TTL_MS) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > maxAgeMs) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function setCached(key, value) {
  if (value === undefined) return;
  if (!cache.has(key) && cache.size >= MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { value, at: Date.now() });
}

export function invalidateCache(prefix) {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function clearAllCache() {
  cache.clear();
  inflight.clear();
  cachedSession = null;
  cachedSessionAt = 0;
}

export function getCachedSession() {
  if (!cachedSession) return null;
  if (Date.now() - cachedSessionAt > SESSION_TTL_MS) {
    cachedSession = null;
    cachedSessionAt = 0;
    return null;
  }
  return cachedSession;
}

export function setCachedSession(session) {
  if (session?.authenticated) {
    cachedSession = session;
    cachedSessionAt = Date.now();
  } else {
    cachedSession = null;
    cachedSessionAt = 0;
  }
}

/**
 * Warm a GET endpoint once (deduplicating concurrent prefetch calls).
 */
export function warmApi(apiFn, path, maxAgeMs = 45_000) {
  if (getCached(path, maxAgeMs) !== null) return;
  if (inflight.has(path)) return;
  const task = apiFn(path, { silent401: true })
    .then((data) => {
      setCached(path, data);
      return data;
    })
    .catch(() => null)
    .finally(() => {
      inflight.delete(path);
    });
  inflight.set(path, task);
}

/**
 * Prefetch the lazy JS chunk (and primary API data when already signed in)
 * when the user hovers or focuses a navigation link.
 */
export function prefetchRoute(href, apiFn) {
  if (!href) return;
  const path = href.split('?')[0].split('#')[0];
  const signedIn = Boolean(getCachedSession()?.authenticated);

  const loadChunk = (key, loader) => {
    if (prefetchedChunks.has(key)) return;
    prefetchedChunks.add(key);
    loader().catch(() => {
      prefetchedChunks.delete(key);
    });
  };

  if (path === '/lab' || path.startsWith('/lab/')) {
    loadChunk('lab', () => import('./App'));
    if (signedIn && apiFn) warmApi(apiFn, '/metadata');
  } else if (path === '/journal' || path.startsWith('/journal/')) {
    loadChunk('journal', () => import('./JournalPage'));
    if (signedIn && apiFn) {
      warmApi(apiFn, '/journal');
      warmApi(apiFn, '/metadata');
      warmApi(apiFn, '/journal-accounts');
    }
  } else if (path === '/mindset') {
    loadChunk('mindset', () => import('./MindsetPage'));
    if (signedIn && apiFn) warmApi(apiFn, '/mindset/warmup');
  } else if (path === '/backtesting') {
    loadChunk('backtesting', () => import('./BacktestingPage'));
    if (signedIn && apiFn) warmApi(apiFn, '/backtesting/sessions');
  } else if (path === '/learn') {
    loadChunk('learn', () => import('./LearnPage'));
  } else if (path === '/matrix') {
    loadChunk('matrix', () => import('./MatrixPage'));
    if (apiFn) warmApi(apiFn, '/matrix/snapshot', 60_000);
  }
}
