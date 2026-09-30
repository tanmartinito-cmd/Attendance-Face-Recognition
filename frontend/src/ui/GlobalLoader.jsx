import React, { useEffect, useState } from 'react';
import { recordInteraction, subscribe } from './loadingStore';

const BAR_DELAY_MS = 150; // skip the bar for instant responses

/**
 * Mounted once at the app root. One rule for the whole app: every request has
 * exactly ONE loading indicator.
 * - Started by a button  -> that button shows the spinner (nothing global).
 * - Module-owned work (camera processing, recognition) -> `background: true`,
 *   the module shows its own indicator (nothing global).
 * - Anything else (e.g. a silent refresh after saving) -> thin top bar only.
 * Views still render their own skeleton/table loaders for first loads.
 */
export default function GlobalLoader() {
  const [state, setState] = useState({ foreground: 0, unattributed: 0 });
  const [barReady, setBarReady] = useState(false);

  useEffect(() => subscribe(setState), []);

  useEffect(() => {
    const onClick = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest('.btn');
      recordInteraction(button && !button.disabled ? button : null);
    };
    const onSubmit = (event) => {
      const submitter = event.submitter || event.target?.querySelector?.('button[type="submit"].btn');
      if (submitter?.classList?.contains('btn')) recordInteraction(submitter);
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('submit', onSubmit, true);
    };
  }, []);

  const hasUnattributed = state.unattributed > 0;

  // Delay the bar so instant responses never flash.
  useEffect(() => {
    if (!hasUnattributed) return undefined;
    const timer = setTimeout(() => setBarReady(true), BAR_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setBarReady(false);
    };
  }, [hasUnattributed]);

  const showBar = hasUnattributed && barReady;

  return (
    <div className={`global-progress ${showBar ? 'is-active' : ''}`} aria-hidden="true">
      <div className="global-progress-bar" />
    </div>
  );
}
