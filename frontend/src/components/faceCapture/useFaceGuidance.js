import { useEffect, useRef, useState } from 'react';
import useFaceDetection from '../scanner/useFaceDetection';

/**
 * Live, client-side coaching for biometric face capture.
 *
 * While the camera is active it samples the video a few times per second,
 * checks the detected face against the on-screen oval (presence, centering,
 * distance) plus overall lighting, and returns one plain-language instruction
 * so the operator always knows the single next thing to fix.
 *
 * status:
 *   'idle'        camera off
 *   'loading'     face guide still starting
 *   'noface'      no face in view
 *   'adjust'      face found but needs repositioning / better light
 *   'ready'       face is well placed; safe to capture
 *   'unavailable' detector could not load; manual alignment only
 */

const TICK_MS = 280;
const DETECTOR_TIMEOUT_MS = 8000;
const READY_STREAK = 2;

// Used only to ignore tiny faces far in the background (fraction of frame width).
const MIN_FACE_WIDTH = 0.22;

// On-screen oval (must match --oval-top / --oval-height in .face-stage, 3:4 shape).
const OVAL_TOP = 0.55;
const OVAL_HEIGHT = 0.8;
// A face box covers brow-to-chin, the oval the whole head: its centre sits a bit low.
const FACE_Y_BIAS = 0.08; // fraction of the oval half-height

// Centering and distance are measured against the OVAL, with hysteresis:
// easy to stay "good" (EXIT limits), a bit stricter to become good (ENTER limits),
// so small movements and detector jitter never flip the state back and forth.
const CENTER_ENTER = 0.5; // face centre within 50% of the oval radius
const CENTER_EXIT = 0.72;
const SIZE_ENTER = [0.45, 1.25]; // face width / oval width
const SIZE_EXIT = [0.38, 1.4];

const BOX_SMOOTHING = 0.5; // exponential smoothing of the detector box
const MISS_GRACE_TICKS = 2; // a face missed for 1–2 ticks is still "there"
// Average luminance (0–255) limits.
const MIN_BRIGHTNESS = 60;
const MAX_BRIGHTNESS = 215;

// Shown live on top of the camera, so every message is a short instruction (a few words).
// Longer explanations belong in the side panel, not on the video.
export const GUIDANCE_MESSAGES = {
  idle: 'Camera off',
  loading: 'Starting…',
  noface: 'No face detected',
  center: 'Center your face',
  raise: 'Move up slightly',
  lower: 'Move down slightly',
  closer: 'Move closer',
  farther: 'Move back',
  dark: 'Too dark',
  bright: 'Too bright',
  holdStill: 'Hold still',
  ready: 'Looks good',
  unavailable: 'Center your face',
  crowded: 'One person only',
};

// Same rule as the server (FACE_ENROLL_OVAL_ZONE / FACE_ENROLL_SECOND_FACE_RATIO):
// only the face inside the oval counts; background people are ignored.
const OVAL_ZONE_X = 0.25;
const OVAL_ZONE_Y = 0.35;
const SECOND_FACE_RATIO = 0.6;

const boxWidth = (b) => b.right - b.left;

/**
 * Pick the student's face from every face in view.
 * Returns { box, crowded } where box is null when nobody is in (or near) the oval.
 */
export function pickOvalFace(boxes, width, height) {
  if (!boxes?.length || !width || !height) return { box: null, crowded: false };
  const inZone = boxes.filter((b) => {
    const cx = (b.left + b.right) / 2 / width - 0.5;
    const cy = (b.top + b.bottom) / 2 / height - 0.5;
    return Math.abs(cx) <= OVAL_ZONE_X && Math.abs(cy) <= OVAL_ZONE_Y;
  }).sort((a, b) => boxWidth(b) - boxWidth(a));
  if (inZone.length) {
    const main = inZone[0];
    const crowded = inZone.slice(1).some((b) => boxWidth(b) >= SECOND_FACE_RATIO * boxWidth(main));
    return { box: main, crowded };
  }
  // Nobody in the oval: coach a close, off-centre person; ignore small faces far in the background.
  const nearest = [...boxes].sort((a, b) => boxWidth(b) - boxWidth(a))[0];
  return { box: boxWidth(nearest) / width >= MIN_FACE_WIDTH ? nearest : null, crowded: false };
}

const STATUS_TONE = {
  idle: 'neutral',
  loading: 'neutral',
  unavailable: 'neutral',
  noface: 'danger',
  adjust: 'warning',
  ready: 'success',
};

/** Colour tone ('success' | 'warning' | 'danger' | 'neutral') for a status. */
export function guidanceTone(status) {
  return STATUS_TONE[status] || 'neutral';
}

/** Capture stays enabled unless the detector is sure there is no face. */
export function canCaptureWith(status) {
  return status !== 'noface' && status !== 'idle';
}

const IDLE_STATE = {
  status: 'idle',
  message: GUIDANCE_MESSAGES.idle,
  checks: { face: 'pending', centered: 'pending', distance: 'pending', lighting: 'pending' },
};

function measureBrightness(video, canvas) {
  try {
    if (canvas.width !== 48) canvas.width = 48;
    if (canvas.height !== 36) canvas.height = 36;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, 48, 36);
    const { data } = ctx.getImageData(0, 0, 48, 36);
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return total / (data.length / 4);
  } catch {
    return null;
  }
}

/**
 * Where the face is relative to the on-screen oval.
 * Video pixels are mapped to the displayed (object-fit: cover, cropped) view first.
 * Returns { dx, dy } in oval radii (0 = centre, 1 = on the oval line) and `size`
 * (face width / oval width).
 */
export function faceInOval(box, { width, height, viewWidth, viewHeight }) {
  const vw = viewWidth || width;
  const vh = viewHeight || height;
  const scale = Math.max(vw / width, vh / height);
  const offX = (width * scale - vw) / 2;
  const offY = (height * scale - vh) / 2;
  const cx = ((box.left + box.right) / 2) * scale - offX;
  const cy = ((box.top + box.bottom) / 2) * scale - offY;
  const ry = (OVAL_HEIGHT * vh) / 2;
  const rx = ry * 0.75;
  return {
    dx: (cx - vw / 2) / rx,
    dy: (cy - OVAL_TOP * vh) / ry - FACE_Y_BIAS,
    size: ((box.right - box.left) * scale) / (2 * rx),
  };
}

/** Pure evaluation step, exported for unit testing. `previous` enables hysteresis. */
export function evaluateFaceFrame({
  box, width, height, viewWidth, viewHeight, brightness, detectorReady, crowded = false, previous = null,
}) {
  const lighting = brightness == null ? 'pending'
    : brightness < MIN_BRIGHTNESS || brightness > MAX_BRIGHTNESS ? 'bad' : 'ok';
  const lightingKey = brightness != null && brightness < MIN_BRIGHTNESS ? 'dark'
    : brightness != null && brightness > MAX_BRIGHTNESS ? 'bright' : null;

  if (!detectorReady) {
    return {
      status: 'unavailable',
      message: lightingKey ? GUIDANCE_MESSAGES[lightingKey] : GUIDANCE_MESSAGES.unavailable,
      checks: { face: 'pending', centered: 'pending', distance: 'pending', lighting },
    };
  }

  if (!box || !width || !height) {
    return {
      status: 'noface',
      message: GUIDANCE_MESSAGES.noface,
      checks: { face: 'bad', centered: 'pending', distance: 'pending', lighting },
    };
  }

  const { dx, dy, size } = faceInOval(box, { width, height, viewWidth, viewHeight });

  const wasSized = previous?.checks?.distance === 'ok';
  const [minSize, maxSize] = wasSized ? SIZE_EXIT : SIZE_ENTER;
  const distanceKey = size < minSize ? 'closer' : size > maxSize ? 'farther' : null;

  const wasCentered = previous?.checks?.centered === 'ok';
  const limit = wasCentered ? CENTER_EXIT : CENTER_ENTER;
  let centerKey = null;
  if (Math.hypot(dx, dy) > limit) {
    if (Math.abs(dx) >= Math.abs(dy)) centerKey = 'center';
    else centerKey = dy < 0 ? 'lower' : 'raise';
  }

  const checks = {
    face: 'ok',
    centered: centerKey ? 'bad' : 'ok',
    distance: distanceKey ? 'bad' : 'ok',
    lighting,
  };

  // One instruction at a time, in the order people naturally fix things.
  const issue = (crowded ? 'crowded' : null) || centerKey || distanceKey || lightingKey;
  if (issue) return { status: 'adjust', message: GUIDANCE_MESSAGES[issue], checks };
  return { status: 'ready', message: GUIDANCE_MESSAGES.ready, checks };
}

export default function useFaceGuidance(videoRef, active) {
  const { initLocalFaceDetector, detectLocalFaces } = useFaceDetection();
  const [guidance, setGuidance] = useState(IDLE_STATE);
  const lastKeyRef = useRef('');
  const brightnessCanvasRef = useRef(null);

  useEffect(() => {
    if (!active) {
      lastKeyRef.current = '';
      return undefined;
    }

    let cancelled = false;
    let timer = null;
    let detectorReady = false;
    let readyStreak = 0;
    let smoothBox = null;
    let misses = 0;
    let lastEval = null;

    const publish = (next) => {
      const key = `${next.status}|${next.message}|${Object.values(next.checks).join(',')}`;
      if (key === lastKeyRef.current) return;
      lastKeyRef.current = key;
      setGuidance(next);
    };

    publish({ ...IDLE_STATE, status: 'loading', message: GUIDANCE_MESSAGES.loading });

    const tick = async () => {
      if (cancelled) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth) {
        if (!brightnessCanvasRef.current) brightnessCanvasRef.current = document.createElement('canvas');
        const brightness = measureBrightness(video, brightnessCanvasRef.current);
        const boxes = detectorReady ? await detectLocalFaces(video) : [];
        if (cancelled) return;
        const picked = pickOvalFace(boxes, video.videoWidth, video.videoHeight);
        // Detector boxes jitter and sometimes drop a frame: smooth them and keep the
        // last box for a couple of ticks so a tiny movement is not "face lost".
        if (picked.box) {
          misses = 0;
          const prev = smoothBox;
          smoothBox = prev
            ? Object.fromEntries(Object.keys(picked.box).map((k) => [k, prev[k] + (picked.box[k] - prev[k]) * BOX_SMOOTHING]))
            : picked.box;
        } else if (++misses > MISS_GRACE_TICKS) {
          smoothBox = null;
        }
        let next = evaluateFaceFrame({
          box: smoothBox,
          crowded: picked.crowded,
          width: video.videoWidth,
          height: video.videoHeight,
          viewWidth: video.clientWidth,
          viewHeight: video.clientHeight,
          brightness,
          detectorReady,
          previous: lastEval,
        });
        lastEval = next;
        // Require a short streak of good frames so "ready" doesn't flicker.
        if (next.status === 'ready') {
          readyStreak += 1;
          if (readyStreak < READY_STREAK) next = { ...next, status: 'adjust', message: GUIDANCE_MESSAGES.holdStill };
        } else {
          readyStreak = 0;
        }
        publish(next);
      }
      timer = setTimeout(tick, TICK_MS);
    };

    const timeout = new Promise((resolve) => setTimeout(() => resolve(false), DETECTOR_TIMEOUT_MS));
    Promise.race([initLocalFaceDetector(), timeout])
      .then((ok) => { detectorReady = Boolean(ok); })
      .catch(() => { detectorReady = false; })
      .finally(() => { if (!cancelled) tick(); });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, videoRef, initLocalFaceDetector, detectLocalFaces]);

  // When the camera is off, always report idle (stale live state is ignored).
  return active ? guidance : IDLE_STATE;
}
