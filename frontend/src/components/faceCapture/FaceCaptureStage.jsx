import React, { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';

import { guidanceTone } from './useFaceGuidance';

/**
 * Large live camera view with an oval guide and a short live instruction
 * (plain text above the oval). The oval changes colour with the guidance state.
 *
 * The camera never starts by itself: the only "Start Camera" button is the one
 * in the centre of this view.
 */
export default function FaceCaptureStage({
  videoRef,
  canvasRef,
  cameraActive,
  flash,
  guidance,
  onStartCamera,
  showStart = true,
  offlineTitle = 'Camera is off',
  offlineHint = 'Position the face inside the oval.',
  autoCapture = null, // { phase, count, prompt } from useAutoFaceCapture
}) {
  const [starting, setStarting] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const handleStart = async () => {
    if (starting) return;
    setStarting(true);
    try {
      await onStartCamera?.();
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  };

  const autoPhase = autoCapture?.phase;
  const autoTone = { processing: 'neutral', done: 'success', error: 'danger' }[autoPhase];
  const progress = Math.max(0, Math.min(1, autoCapture?.progress || 0));
  const tone = autoTone || guidanceTone(guidance?.status);
  // Processing has exactly one indicator: the spinner in the middle of the oval.
  const promptText = autoPhase === 'processing' ? '' : autoCapture?.prompt || guidance?.message;

  return (
    <div className={`face-stage tone-${tone}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="face-stage-video"
        style={{ display: cameraActive ? 'block' : 'none' }}
      />
      {canvasRef && <canvas ref={canvasRef} style={{ display: 'none' }} />}

      {!cameraActive && (
        <div className="face-stage-offline">
          <Camera size={36} aria-hidden="true" />
          <strong>{offlineTitle}</strong>
          {offlineHint && <span>{offlineHint}</span>}
          {onStartCamera && showStart && (
            <button type="button" className="btn btn-primary" onClick={handleStart} disabled={starting} aria-busy={starting || undefined} data-self-loading="">
              {starting ? <><Loader2 size={16} className="spin" aria-hidden="true" /> Starting…</> : 'Start Camera'}
            </button>
          )}
        </div>
      )}

      {cameraActive && (
        <>
          <div className="face-stage-oval" aria-hidden="true" />
          {autoCapture && (
            <svg
              className="face-stage-progress"
              viewBox="0 0 300 400"
              role="progressbar"
              aria-label="Face capture progress"
              aria-valuemin={0}
              aria-valuemax={autoCapture.total || 3}
              aria-valuenow={autoPhase === 'processing' || autoPhase === 'done' ? autoCapture.total || 3 : autoCapture.collected || 0}
            >
              {/* Same 3:4 box as the oval (uniform scale, so pathLength stays exact).
                  Starts at the top, runs clockwise, and sits right on the oval line.
                  Progress moves the dash offset, which the GPU animates smoothly. */}
              <path
                d="M150,1.5 A148.5,198.5 0 1 1 150,398.5 A148.5,198.5 0 1 1 150,1.5"
                pathLength="100"
                strokeDasharray="100 100"
                style={{ strokeDashoffset: 100 - progress * 100, opacity: progress > 0 ? 1 : 0 }}
              />
            </svg>
          )}
          {autoPhase === 'processing' && (
            <div className="face-stage-center-icon" role="status" aria-label="Processing">
              <Loader2 size={48} className="spin" aria-hidden="true" />
            </div>
          )}
          {autoPhase === 'done' && (
            <div className="face-stage-center-icon is-done" aria-hidden="true"><CheckCircle2 size={64} /></div>
          )}
          {promptText && (
            <div className="face-stage-prompt" role="status" aria-live="polite">{promptText}</div>
          )}
        </>
      )}

      {flash && <div className="face-stage-flash" aria-hidden="true" />}
    </div>
  );
}

const CHECK_LABELS = [
  ['face', 'Face detected'],
  ['centered', 'Centered in the oval'],
  ['distance', 'Good distance'],
  ['lighting', 'Good lighting'],
];

/** Compact live checklist so the operator sees what is already OK. */
export function FaceGuidanceChecklist({ guidance, cameraActive }) {
  const checks = guidance?.checks || {};
  const unavailable = guidance?.status === 'unavailable';
  return (
    <ul className="face-checklist" aria-label="Capture readiness">
      {CHECK_LABELS.map(([key, label]) => {
        const state = cameraActive ? checks[key] || 'pending' : 'pending';
        const Icon = state === 'ok' ? CheckCircle2 : state === 'bad' ? XCircle : Circle;
        const note = unavailable && key !== 'lighting' ? 'Check manually' : state === 'ok' ? 'OK' : state === 'bad' ? 'Needs adjusting' : 'Waiting';
        return (
          <li key={key} className={`face-check is-${state}`}>
            <Icon size={16} aria-hidden="true" />
            <span className="face-check-label">{label}</span>
            <span className="face-check-note">{note}</span>
          </li>
        );
      })}
    </ul>
  );
}
