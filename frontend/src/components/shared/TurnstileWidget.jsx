import React, { useEffect, useRef } from 'react';

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise = null;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(window.turnstile);
      script.onerror = () => { scriptPromise = null; reject(new Error('Turnstile could not load')); };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

/**
 * Cloudflare Turnstile "Verify you are human" check (free, no picture puzzles).
 * Renders nothing when no site key is configured on the server.
 * onToken(token) is called with a one-time token, or with '' when it expires / fails.
 * Change `resetKey` to get a fresh token (e.g. after a failed submit; tokens work once).
 */
export default function TurnstileWidget({ siteKey, onToken, resetKey = 0, onError }) {
  const containerRef = useRef(null);
  const widgetRef = useRef(null);
  const onTokenRef = useRef(onToken);
  const onErrorRef = useRef(onError);
  useEffect(() => { onTokenRef.current = onToken; onErrorRef.current = onError; }, [onToken, onError]);

  useEffect(() => {
    if (!siteKey) return undefined;
    let cancelled = false;
    loadTurnstile().then((turnstile) => {
      if (cancelled || !containerRef.current || !turnstile) return;
      widgetRef.current = turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action: 'register',
        theme: 'light',
        callback: (token) => onTokenRef.current?.(token),
        'expired-callback': () => onTokenRef.current?.(''),
        'error-callback': () => { onTokenRef.current?.(''); onErrorRef.current?.(); },
      });
    }).catch(() => onErrorRef.current?.());
    return () => {
      cancelled = true;
      if (widgetRef.current && window.turnstile) window.turnstile.remove(widgetRef.current);
      widgetRef.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetKey && widgetRef.current && window.turnstile) {
      window.turnstile.reset(widgetRef.current);
      onTokenRef.current?.('');
    }
  }, [resetKey]);

  if (!siteKey) return null;
  return <div ref={containerRef} className="turnstile-box" aria-label="Human verification" />;
}
