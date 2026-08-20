// utils/userData.js
// ----------------------------------------------------------------------------
// Server-side persistence for per-user, per-site app state.
//
// Replaces direct localStorage reads/writes. localStorage is kept as a
// write-through cache for instant UI response, but Supabase (via the worker)
// is the source of truth.
//
// Two public functions:
//   - loadUserData(site, type)        → async, reads from server, falls back to localStorage on failure
//   - saveUserData(site, type, value) → debounced write (500ms per key)
//
// One React hook:
//   - useRemoteState(site, type, fallback)
//     Like useState, but persists to server. Returns [value, setValue, status].
//     status is 'loading' | 'ready' | 'error'.
//
// Cross-cutting concerns:
//   - Debounce: 500ms per (site, type) key — typing into a field doesn't
//     hammer the worker; only the last write in a burst is sent.
//   - Offline tolerance: if a write fails (network blip, worker error), the
//     value stays in localStorage and is retried on the next save attempt.
//     Reads fall back to localStorage if the server is unreachable.
//   - localStorage key naming preserves the existing `ra_${type}_${site}`
//     scheme so a frontend rollback (revert to localStorage-only) still works.
// ----------------------------------------------------------------------------

const WORKER_URL = import.meta.env.VITE_WORKER_URL || 'https://api.rankactions.com';

// Token getter. App.jsx wires this in a useEffect, but that effect runs AFTER
// our first hook mount, which races with the initial load. So we default to
// reading from window.Clerk directly — App.jsx's wiring then overrides this
// with the precise useClerk() session reference if available.
let _getToken = async () => {
  try {
    if (typeof window !== 'undefined' && window.Clerk?.session?.getToken) {
      return await window.Clerk.session.getToken();
    }
  } catch {}
  return null;
};
export function setUserDataTokenGetter(fn) { _getToken = fn; }

// Allowed types — must match the worker's USERDATA_ALLOWED_TYPES set.
// Catches typos at the call site.
const ALLOWED_TYPES = new Set([
  'strategy',
  'strategy_history',
  'done',
  'prospects',
  'content_history',
  'link_history',
  'starting_out',
  'kw_enrich',
  'hidden_kw',
  'assist_done',
  'assist_visited',
]);

// ── localStorage key (matches existing convention used pre-migration) ──
const localKey = (site, type) => {
  // Existing convention is `ra_${type}_${site}`. Two slightly different
  // type names exist in the wild — handle them so the cache still hits:
  //   - 'strategy_history' was 'ra_strategy_history_<site>'
  //   - 'kw_enrich' was 'ra_kw_enrich_<site>'
  return `ra_${type}_${site}`;
};

// ── Cache for in-flight loads so concurrent callers share one request ──
const inflightLoads = new Map(); // key: `${site}|${type}` → Promise

// ── Per-key debounce timers ──
const writeTimers = new Map(); // key: `${site}|${type}` → timeoutId
const writeQueue  = new Map(); // key: `${site}|${type}` → latest value
const DEBOUNCE_MS = 500;

/**
 * Load a single user-data record for the current user.
 * Returns the parsed payload, or `null` if no record exists.
 *
 * Resolution order:
 *   1. Try the server. If 2xx, write-through to localStorage and return.
 *   2. If the server errors (network, 5xx, etc), fall back to localStorage.
 *   3. If localStorage is empty too, return null.
 */
export async function loadUserData(site, type) {
  if (!ALLOWED_TYPES.has(type)) {
    console.warn(`[userData] Invalid type: ${type}`);
    return null;
  }
  if (!site) return null;

  const key = `${site}|${type}`;

  // Dedup concurrent loads for the same key — common in React strict mode
  // and when multiple components ask for the same data on mount.
  if (inflightLoads.has(key)) return inflightLoads.get(key);

  const promise = (async () => {
    try {
      // Wait for a real token. On first app mount, the React hook for
      // top-level state slots (`done`, `prospects`) can race ahead of Clerk's
      // session initialisation — `_getToken()` returns null and we'd silently
      // fall back to localStorage forever. Short retry loop (up to ~2.5s)
      // gives Clerk time to come up.
      let token = await _getToken();
      let attempts = 0;
      while (!token && attempts < 10) {
        await new Promise(r => setTimeout(r, 250));
        token = await _getToken();
        attempts++;
      }
      if (!token) return readLocal(site, type);

      const res = await fetch(
        `${WORKER_URL}/api/userdata/${type}?site=${encodeURIComponent(site)}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );

      if (!res.ok) {
        // 403 = site not in profile (legit). 401 = auth issue. Other = transient.
        // For 403 we don't want to return localStorage data — the user shouldn't
        // see another user's data even if it's somehow cached locally.
        if (res.status === 403 || res.status === 401) return null;
        return readLocal(site, type);
      }

      const { payload } = await res.json();
      // Write-through to localStorage so a subsequent reload without network
      // still has the data.
      if (payload != null) writeLocal(site, type, payload);
      return payload;
    } catch (err) {
      // Network failure — fall back to local cache rather than losing the UI.
      console.warn(`[userData] load ${type} fell back to localStorage:`, err.message);
      return readLocal(site, type);
    } finally {
      // Clear the inflight entry on next tick so subsequent calls re-fetch.
      setTimeout(() => inflightLoads.delete(key), 0);
    }
  })();

  inflightLoads.set(key, promise);
  return promise;
}

/**
 * Save a user-data record. Debounced 500ms per (site, type) key so that
 * rapid changes (e.g. typing into a strategy field) result in one server
 * write at the end of the burst, not one per keystroke.
 *
 * localStorage is updated immediately (no debounce) so the data is durable
 * across page reloads even before the debounced server write fires.
 *
 * Returns a Promise that resolves when the debounced write completes.
 * Most callers won't await this — fire-and-forget is fine.
 */
export function saveUserData(site, type, value) {
  if (!ALLOWED_TYPES.has(type)) {
    console.warn(`[userData] Invalid type: ${type}`);
    return Promise.resolve({ ok: false, error: 'invalid_type' });
  }
  if (!site) return Promise.resolve({ ok: false, error: 'no_site' });

  // Immediate local write — guarantees no data loss if the page reloads
  // before the debounced server write fires.
  writeLocal(site, type, value);

  const key = `${site}|${type}`;
  writeQueue.set(key, value);

  // Clear any pending timer for this key and schedule a fresh one.
  if (writeTimers.has(key)) clearTimeout(writeTimers.get(key));

  return new Promise((resolve) => {
    const timer = setTimeout(async () => {
      writeTimers.delete(key);
      const valueToSend = writeQueue.get(key);
      writeQueue.delete(key);
      const result = await sendWrite(site, type, valueToSend);
      resolve(result);
    }, DEBOUNCE_MS);
    writeTimers.set(key, timer);
  });
}

/**
 * Force-flush any pending debounced writes for a key. Useful before
 * navigation away from a page that has unsaved changes.
 */
export async function flushUserData(site, type) {
  const key = `${site}|${type}`;
  if (!writeTimers.has(key)) return { ok: true, nothing: true };
  clearTimeout(writeTimers.get(key));
  writeTimers.delete(key);
  const valueToSend = writeQueue.get(key);
  writeQueue.delete(key);
  return sendWrite(site, type, valueToSend);
}

// ── Internal helpers ──

async function sendWrite(site, type, value) {
  try {
    const token = await _getToken();
    if (!token) return { ok: false, error: 'no_token' };

    const res = await fetch(
      `${WORKER_URL}/api/userdata/${type}?site=${encodeURIComponent(site)}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify(value),
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[userData] save ${type} failed (${res.status}): ${text}`);
      return { ok: false, error: `http_${res.status}` };
    }

    const data = await res.json();
    return { ok: true, updatedAt: data.updatedAt };
  } catch (err) {
    console.warn(`[userData] save ${type} threw:`, err.message);
    return { ok: false, error: 'network' };
  }
}

function readLocal(site, type) {
  try {
    const raw = localStorage.getItem(localKey(site, type));
    if (raw == null || raw === 'null' || raw === '') return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeLocal(site, type, value) {
  try {
    if (value == null) {
      localStorage.removeItem(localKey(site, type));
    } else {
      localStorage.setItem(localKey(site, type), JSON.stringify(value));
    }
  } catch {
    // Quota exceeded etc — non-fatal, server is source of truth.
  }
}

// ── React hook ──
// Drop-in-like replacement for `useState` that reads from server on mount
// and persists changes (debounced) to server. Returns [value, setValue, status].
//
// `status` lets the UI show a loading state on first render before the server
// read returns. Pass `fallback` to use as the initial value while loading.
//
// Re-loads when `site` or `type` changes — same site-switch semantics as
// before, but server-backed.
//
// Usage:
//   const [strategy, setStrategy, status] = useRemoteState(selectedSite, 'strategy', null);
//   if (status === 'loading') return <Skeleton/>;
import { useEffect, useMemo, useRef, useState } from 'react';

export function useRemoteState(site, type, fallback = null) {
  const [value, setValue] = useState(fallback);
  const [status, setStatus] = useState('loading');
  // Tracks the most recent (site, type) we asked to load. When a load promise
  // resolves, we drop its result if a newer load has been issued in the
  // meantime. This handles site-switch races without needing a mount tracker.
  const lastLoadKeyRef = useRef(null);

  useEffect(() => {
    if (!site) {
      setStatus('ready');
      return;
    }

    const loadKey = `${site}|${type}`;
    lastLoadKeyRef.current = loadKey;

    setStatus('loading');
    loadUserData(site, type)
      .then((data) => {
        // Drop stale results from older site/type combinations.
        if (lastLoadKeyRef.current !== loadKey) return;
        setValue(data == null ? fallback : data);
        setStatus('ready');
      })
      .catch((err) => {
        if (lastLoadKeyRef.current !== loadKey) return;
        console.warn(`[useRemoteState] ${type} load error:`, err);
        setStatus('error');
      });
    // fallback intentionally NOT in deps — it's an initial value, not a reset trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, type]);

  const update = (next) => {
    // Allow function form, matching useState API
    setValue((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      // Fire-and-forget server write (with internal debounce + local cache).
      if (site) saveUserData(site, type, resolved);
      return resolved;
    });
  };

  return [value, update, status];
}

/**
 * useRemoteState wrapper for Set-typed values.
 *
 * Sets aren't JSON-serializable directly, so the wire format stays as an array
 * and we convert at the boundary. Returns [Set, setSet(setterAcceptsSetOrArray), status].
 *
 * Used by completed-actions (`done`) state — the existing code treats it as
 * a Set everywhere, so this keeps the call sites identical.
 */
export function useRemoteStateSet(site, type) {
  const [arr, setArr, status] = useRemoteState(site, type, []);

  // Memoise the Set so React-equality checks don't see a new Set every render.
  // The Set is rebuilt only when the underlying array reference changes.
  const setValue = useMemo(
    () => new Set(Array.isArray(arr) ? arr : []),
    [arr]
  );

  const update = (next) => {
    setArr((prevArr) => {
      const prevSet = new Set(Array.isArray(prevArr) ? prevArr : []);
      const resolved = typeof next === 'function' ? next(prevSet) : next;
      // Accept either a Set or an array from the caller, store as array.
      return resolved instanceof Set ? [...resolved] : Array.isArray(resolved) ? resolved : [];
    });
  };

  return [setValue, update, status];
}
