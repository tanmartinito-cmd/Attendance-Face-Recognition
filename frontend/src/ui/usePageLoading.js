import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeCacheUpdates } from '../apiCache';

/**
 * Drop-in replacement for `const [loading, setLoading] = useState(true)` in pages.
 *
 *   const [loading, setLoading] = usePageLoading(() => loadData());
 *
 * When a silent background refresh (expired cache) brings new data, `reload` runs
 * again SILENTLY: its `setLoading(true)` is ignored, so the table stays on screen
 * and just updates in place. Normal loads (first visit, after a data change)
 * behave exactly as before.
 */
export default function usePageLoading(reload, initial = true) {
  const [loading, setLoadingState] = useState(initial);
  const silentRef = useRef(false);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  const setLoading = useCallback((value) => {
    if (value && silentRef.current) return; // silent refresh: keep the current data visible
    setLoadingState(value);
  }, []);

  useEffect(() => {
    let timer = null;
    const unsubscribe = subscribeCacheUpdates(() => {
      if (!reloadRef.current) return;
      // Several endpoints may refresh together; re-read once.
      clearTimeout(timer);
      timer = setTimeout(() => {
        silentRef.current = true;
        Promise.resolve()
          .then(() => reloadRef.current?.())
          .catch(() => {})
          .finally(() => { silentRef.current = false; });
      }, 50);
    });
    return () => { clearTimeout(timer); unsubscribe(); };
  }, []);

  return [loading, setLoading];
}
