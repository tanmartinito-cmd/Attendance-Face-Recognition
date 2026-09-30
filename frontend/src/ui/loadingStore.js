/**
 * Global loading store.
 *
 * Every API request registers itself here so the app can show one consistent
 * loading experience:
 *  - a thin progress bar at the top of the screen for any foreground request
 *  - an automatic spinner on the button that triggered the request
 *
 * Requests flagged as `background` (e.g. the live face-recognition loop) are
 * tracked but never shown, so polling does not make the UI flicker.
 */

const INTERACTION_WINDOW_MS = 800; // a request started this soon after a click belongs to that click
const CHAIN_WINDOW_MS = 150; // follow-up requests (e.g. reload after save) keep the same button busy
const RELEASE_DELAY_MS = 120;

let nextId = 1;
const pending = new Map(); // id -> { background, button }
const listeners = new Set();

let lastInteraction = null; // { button, at }
const buttonCounts = new Map(); // button element -> active request count
const releaseTimers = new Map();
const lastReleased = new Map(); // button element -> timestamp of last request end

function emit() {
  const snapshot = getSnapshot();
  listeners.forEach((listener) => listener(snapshot));
}

export function getSnapshot() {
  let foreground = 0;
  let unattributed = 0;
  pending.forEach((entry) => {
    if (entry.background) return;
    foreground += 1;
    if (!entry.button) unattributed += 1;
  });
  return { foreground, unattributed };
}

export function subscribe(listener) {
  listeners.add(listener);
  listener(getSnapshot());
  return () => listeners.delete(listener);
}

function setButtonBusy(button, busy) {
  if (!button || typeof button.setAttribute !== 'function') return;
  // Buttons that render their own "Starting…" state still own the request
  // (so no global bar), but must not get a second, automatic spinner.
  if (button.hasAttribute?.('data-self-loading')) return;
  if (busy) {
    button.setAttribute('data-loading', 'true');
    button.setAttribute('aria-busy', 'true');
  } else {
    button.removeAttribute('data-loading');
    button.removeAttribute('aria-busy');
  }
}

function resolveButton() {
  const now = Date.now();
  if (lastInteraction && now - lastInteraction.at <= INTERACTION_WINDOW_MS && lastInteraction.button?.isConnected) {
    return lastInteraction.button;
  }
  // Chained request right after a previous one on the same button finished.
  for (const [button, endedAt] of lastReleased) {
    if (now - endedAt <= CHAIN_WINDOW_MS && button.isConnected) return button;
  }
  return null;
}

/** Record which button the user just activated. Called by GlobalLoader. */
export function recordInteraction(button) {
  lastInteraction = button ? { button, at: Date.now() } : null;
}

/** Register a request. Returns a function that must be called when it settles. */
export function beginRequest({ background = false } = {}) {
  const id = nextId++;
  const button = background ? null : resolveButton();
  pending.set(id, { background, button });

  if (button) {
    clearTimeout(releaseTimers.get(button));
    releaseTimers.delete(button);
    buttonCounts.set(button, (buttonCounts.get(button) || 0) + 1);
    setButtonBusy(button, true);
  }
  emit();

  let done = false;
  return function endRequest() {
    if (done) return;
    done = true;
    pending.delete(id);
    if (button) {
      const remaining = (buttonCounts.get(button) || 1) - 1;
      if (remaining <= 0) {
        buttonCounts.delete(button);
        lastReleased.set(button, Date.now());
        releaseTimers.set(button, setTimeout(() => {
          releaseTimers.delete(button);
          lastReleased.delete(button);
          if (!buttonCounts.has(button)) setButtonBusy(button, false);
        }, RELEASE_DELAY_MS));
      } else {
        buttonCounts.set(button, remaining);
      }
    }
    emit();
  };
}

/** Wrap any promise-returning work so it participates in the global loader. */
export async function trackLoading(work, options) {
  const end = beginRequest(options);
  try {
    return await work();
  } finally {
    end();
  }
}
