import { useCallback, useEffect, useRef, useState } from 'react';
import { Api } from '../../api';
import { GUIDANCE_MESSAGES } from './useFaceGuidance';
import { grabFrame } from '../../utils/faceCapture';

/**
 * Hands-free face capture, no countdown (like e-wallet selfie verification):
 *
 *   collecting -> whenever the face sits well in the oval, a frame is grabbed and
 *                 checked by the server (eyes open, head straight, sharp, lit, live).
 *                 Good frames fill the progress ring (1/3, 2/3, 3/3); a rejected frame
 *                 just shows the reason ("Keep your eyes open") and the next one is tried.
 *                 Moving never throws away progress.
 *   processing -> the good frames are sent to be enrolled as ONE face identity
 *   done | error
 *
 * The student experiences one capture. Behind the scenes the 3 frames let the server
 * average out noise, confirm it is the same live person, and reject a still image.
 * Only the face inside the oval is used; people in the background are ignored.
 */

export const FRAME_COUNT = 3;
const POLL_MS = 100;        // Check faster: 100ms (was 150ms)
const MIN_GAP_MS = 300;     // Faster capture: 300ms between frames (was 500ms)
const HINT_MS = 2000;       // Show hints shorter: 2s (was 2.5s)
const RETRY_MS = 1500;      // Retry faster: 1.5s (was 2.5s)
const MAX_AUTO_RETRIES = 3;

// Short on-camera prompts. The full server message is returned as `message`
// so the view can show it in the side panel.
export const AUTO_MESSAGES = {
  collecting: 'Hold still',
  processing: 'Processing',
  done: 'Face enrolled',
  retrying: 'Retrying…',
  failed: 'Not enrolled',
  offline: 'Reconnecting…',
};

/** Face well placed (or detector unavailable: the server still validates every frame). */
export function isFaceGood(guidance) {
  return guidance?.status === 'ready' || guidance?.status === 'unavailable';
}

// Server reasons -> 2-3 word labels for the camera view (first match wins).
const SHORT_REASONS = [
  [/real face|photo or screen/i, 'Use your real face'],
  [/blurry|not clear/i, 'Hold still'],
  [/eyes open/i, 'Open your eyes'],
  [/head level/i, 'Keep head level'],
  [/look straight|face the camera/i, 'Look straight'],
  [/too dark/i, 'Too dark'],
  [/too bright/i, 'Too bright'],
  [/move closer/i, 'Move closer'],
  [/only the student|one person/i, 'One person only'],
  [/no face/i, 'No face detected'],
  [/center/i, 'Center your face'],
];

/** Server reasons are sentences; the camera view shows only a 2-3 word label. */
export function shortReason(message) {
  const text = String(message || '').trim();
  if (!text) return '';
  const known = SHORT_REASONS.find(([pattern]) => pattern.test(text));
  if (known) return known[1];
  const first = text.split(/(?<=[.!?])\s/)[0].replace(/\s*\([^)]*\)/g, '').replace(/[.!]$/, '');
  return first.length > 28 ? `${first.slice(0, 26).trimEnd()}…` : first;
}

/** Errors that repeat on every attempt and need someone to act (no auto-retry). */
function needsPerson(error) {
  return Boolean(error?.code) || error?.name === 'AbortError';
}

export default function useAutoFaceCapture({
  active, guidance, videoRef, canvasRef, onSubmit, onFlash, onCheck = Api.checkEnrollFrame,
}) {
  const [phase, setPhase] = useState('collecting');
  const [collected, setCollected] = useState(0);
  const [hint, setHint] = useState('');
  const [message, setMessage] = useState('');
  const guidanceRef = useRef(guidance);
  const framesRef = useRef([]);
  const checkingRef = useRef(false);
  const lastGrabRef = useRef(0);
  const hintTimerRef = useRef(null);
  const retriesRef = useRef(0);
  const autoRetryRef = useRef(false);
  const onSubmitRef = useRef(onSubmit);
  const onFlashRef = useRef(onFlash);
  const onCheckRef = useRef(onCheck);

  useEffect(() => { guidanceRef.current = guidance; }, [guidance]);
  useEffect(() => { onSubmitRef.current = onSubmit; }, [onSubmit]);
  useEffect(() => { onFlashRef.current = onFlash; }, [onFlash]);
  useEffect(() => { onCheckRef.current = onCheck; }, [onCheck]);
  useEffect(() => () => clearTimeout(hintTimerRef.current), []);

  const showHint = useCallback((text) => {
    clearTimeout(hintTimerRef.current);
    setHint(text);
    if (text) hintTimerRef.current = setTimeout(() => setHint(''), HINT_MS);
  }, []);

  const restart = useCallback(() => {
    framesRef.current = [];
    lastGrabRef.current = 0;
    setCollected(0);
    setPhase('collecting');
  }, []);

  // Every camera start is a brand-new capture (re-enrolling never shows the old "done").
  useEffect(() => {
    if (!active) return;
    setPhase('collecting');
    framesRef.current = [];
    lastGrabRef.current = 0;
    retriesRef.current = 0;
    setCollected(0);
    setMessage('');
    showHint('');
  }, [active, showHint]);

  // collecting: grab + check a frame whenever the face is well placed.
  useEffect(() => {
    if (!active || phase !== 'collecting') return undefined;
    let cancelled = false;
    const timer = setInterval(() => {
      if (checkingRef.current || framesRef.current.length >= FRAME_COUNT) return;
      if (!isFaceGood(guidanceRef.current)) return;
      if (Date.now() - lastGrabRef.current < MIN_GAP_MS) return;
      const video = videoRef.current;
      if (!video) return;
      const frame = grabFrame(video, canvasRef?.current);
      lastGrabRef.current = Date.now();
      checkingRef.current = true;
      Promise.resolve()
        .then(() => onCheckRef.current(frame))
        .then((result) => {
          if (cancelled) return;
          if (!result?.ok) { showHint(shortReason(result?.message) || 'Hold still'); return; }
          framesRef.current.push(frame);
          const count = framesRef.current.length;
          setCollected(count);
          showHint('');
          if (count >= FRAME_COUNT) {
            onFlashRef.current?.();
            setPhase('processing');
          }
        })
        .catch(() => { if (!cancelled) showHint(AUTO_MESSAGES.offline); })
        .finally(() => { checkingRef.current = false; });
    }, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); checkingRef.current = false; };
  }, [active, phase, videoRef, canvasRef, showHint]);

  // processing: enroll the collected frames once.
  useEffect(() => {
    if (phase !== 'processing') return undefined;
    let cancelled = false;
    const frames = framesRef.current.slice();
    Promise.resolve()
      .then(() => onSubmitRef.current?.(frames))
      .then((result) => {
        if (cancelled) return;
        retriesRef.current = 0;
        setMessage(result?.message || AUTO_MESSAGES.done);
        setPhase('done');
      })
      .catch((error) => {
        if (cancelled) return;
        autoRetryRef.current = !needsPerson(error) && retriesRef.current < MAX_AUTO_RETRIES;
        if (autoRetryRef.current) retriesRef.current += 1;
        setMessage(error?.message || 'Enrollment failed. Please try again.');
        setPhase('error');
      });
    return () => { cancelled = true; };
  }, [phase]);

  // error: fixable problems collect again by themselves; others wait for "Try again".
  useEffect(() => {
    if (!active || phase !== 'error' || !autoRetryRef.current) return undefined;
    const timer = setTimeout(restart, RETRY_MS);
    return () => clearTimeout(timer);
  }, [active, phase, restart]);

  const retry = useCallback(() => { retriesRef.current = 0; autoRetryRef.current = false; restart(); }, [restart]);

  // One short live instruction: fix position first, then the server's reason, then "Hold still".
  let prompt;
  if (phase === 'processing') prompt = AUTO_MESSAGES.processing;
  else if (phase === 'done') prompt = AUTO_MESSAGES.done;
  else if (phase === 'error') prompt = autoRetryRef.current ? AUTO_MESSAGES.retrying : AUTO_MESSAGES.failed;
  else if (!isFaceGood(guidance) && guidance?.message !== GUIDANCE_MESSAGES.holdStill) prompt = guidance?.message || '';
  else prompt = hint || AUTO_MESSAGES.collecting;

  return {
    phase,
    collected,
    total: FRAME_COUNT,
    progress: phase === 'processing' || phase === 'done' ? 1 : collected / FRAME_COUNT,
    prompt,
    message,
    retry,
    canRetry: phase === 'error',
  };
}
