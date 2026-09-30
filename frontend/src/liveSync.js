/**
 * Live sync: keeps every open screen equal to the database, with no manual refresh.
 *
 *   database write (any user, any device)
 *     -> server signal bumps the data-group version and drops its own cache
 *     -> this poller sees the new version (every 3 s, only while the tab is visible)
 *     -> the matching browser-cache entries are re-fetched SILENTLY
 *     -> pages whose data really changed update in place (usePageLoading)
 *
 * The poll is a tiny counters-only request, never shows a loader, and is paused
 * while the tab is hidden (checked again the moment you come back).
 */
import { apiRequest } from './api';
import { revalidateApiCache } from './apiCache';

export const POLL_MS = 3000;

// Server data group -> browser cache prefixes that hold data from that group.
export const GROUP_PREFIXES = {
  academic: ['/api/programs/', '/api/courses/', '/api/program-sections/', '/api/subjects/', '/api/sections/', '/api/schedules/'],
  people: ['/api/users/', '/api/students/', '/api/sections/'],
  attendance: ['/api/attendance/'],
  dashboard: ['/api/dashboard/'],
  reports: ['/api/reports/', '/api/attendance/student/'],
};

let timer = null;
let running = false;
let known = null; // last versions seen
let polling = false;

/** Compare version maps; returns the browser-cache prefixes that are now outdated. */
export function changedPrefixes(previous, next) {
  if (!previous || !next) return [];
  const prefixes = new Set();
  Object.keys(next).forEach((group) => {
    if (previous[group] !== next[group]) (GROUP_PREFIXES[group] || []).forEach((p) => prefixes.add(p));
  });
  return [...prefixes];
}

export async function pollOnce() {
  if (polling) return;
  polling = true;
  try {
    const res = await apiRequest('/api/sync/versions/', { background: true });
    if (!res?.ok) return;
    const { versions } = await res.json();
    const outdated = changedPrefixes(known, versions);
    known = versions;
    if (outdated.length) revalidateApiCache(outdated);
  } catch {
    // offline / server restarting: try again on the next tick
  } finally {
    polling = false;
  }
}

function schedule() {
  clearTimeout(timer);
  if (!running) return;
  timer = setTimeout(async () => {
    if (document.visibilityState !== 'hidden') await pollOnce();
    schedule();
  }, POLL_MS);
}

const onVisible = () => {
  if (running && document.visibilityState === 'visible') { pollOnce(); schedule(); }
};

export function startLiveSync() {
  if (running) return;
  running = true;
  known = null;
  pollOnce(); // learn the current versions
  schedule();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
}

export function stopLiveSync() {
  running = false;
  known = null;
  clearTimeout(timer);
  document.removeEventListener('visibilitychange', onVisible);
  window.removeEventListener('focus', onVisible);
}
