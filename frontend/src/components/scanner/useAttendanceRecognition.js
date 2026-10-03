import { useCallback, useEffect, useRef } from 'react';
import { Api } from '../../api';

const SCAN_GAP_MS = 250;      // between frames while waiting for a student
const VERIFY_GAP_MS = 60;     // between frames while a student is being confirmed
const IDLE_CHECK_MS = 150;    // how often to look again when no usable face is in view
const MAX_CAPTURE_W = 480;    // landscape frames
const MAX_CAPTURE_H = 640;    // portrait phone frames (keeps uploads ~30-40 KB)
// Same rule as the server (FACE_SCAN_MIN_FACE_RATIO / FACE_SCAN_CENTER_ZONE), a bit looser,
// so the server stays the authority but empty / far / off-centre frames are never uploaded.
const LOCAL_MIN_FACE_RATIO = 0.12;
const LOCAL_CENTER_ZONE = 0.35;
const LOCAL_FRESH_MS = 600;

/**
 * Should this frame be sent? Uses the on-device detector (no network).
 * Returns { send, hint }. With no on-device detector, every frame is sent.
 */
export function localFaceGate(localFace, now = Date.now()) {
  if (!localFace || !localFace.ready || now - localFace.at > LOCAL_FRESH_MS) return { send: true, hint: '' };
  const { box, width } = localFace;
  if (!box || !width) return { send: false, hint: 'Waiting for a student…' };
  const faceWidth = box.right - box.left;
  if (faceWidth < LOCAL_MIN_FACE_RATIO * width) return { send: false, hint: 'Move closer to the camera' };
  const centerX = (box.left + box.right) / 2;
  if (Math.abs(centerX - width / 2) > LOCAL_CENTER_ZONE * width) return { send: false, hint: 'Center your face in the camera' };
  return { send: true, hint: '' };
}

// After a student is marked (or found already marked) the phone stops uploading while that same
// face stays in view: each upload costs the server ~1 s to build a face code for an answer it
// already has. The phone cannot tell WHO is there, only where the face is, so it compares boxes.
const HOLD_MAX_MS = 3000;     // longest pause; then one frame is re-checked (worst-case swap delay)
const HOLD_LEAVE_MS = 500;    // no face in view this long = the student left
const HOLD_CHECK_MS = 150;    // how often the pause looks at the camera (no upload)
const HOLD_SHIFT_MAX = 0.35;  // face centre may move this many face-widths and still be "the same"
const HOLD_RATIO_MIN = 0.75;  // ...and its width may change within this range
const HOLD_RATIO_MAX = 1.33;

/** Is `b` (a face box) plausibly the same person as `a` a moment earlier? */
export function isSameFace(a, b) {
  if (!a || !b) return false;
  const widthA = a.right - a.left;
  const widthB = b.right - b.left;
  if (widthA <= 0 || widthB <= 0) return false;
  const shift = Math.hypot(((b.left + b.right) - (a.left + a.right)) / 2, ((b.top + b.bottom) - (a.top + a.bottom)) / 2) / widthA;
  const ratio = widthB / widthA;
  return shift <= HOLD_SHIFT_MAX && ratio >= HOLD_RATIO_MIN && ratio <= HOLD_RATIO_MAX;
}

/**
 * Should the phone keep pausing uploads for the student it just finished?
 * held = { box, at, missSince }; localFace = the on-device detector's latest { box, at, ready }.
 * Returns { hold, held, reason }: when hold is false, scanning resumes immediately
 * (person left, a different face stepped in, the pause ran out, or there is no detector).
 */
export function holdDecision(held, localFace, now = Date.now()) {
  if (!held) return { hold: false, held: null, reason: 'none' };
  if (now - held.at > HOLD_MAX_MS) return { hold: false, held: null, reason: 'expired' };
  if (!localFace?.ready || now - localFace.at > LOCAL_FRESH_MS) return { hold: false, held: null, reason: 'no-detector' };
  if (!localFace.box) {
    const missSince = held.missSince ?? now;
    if (now - missSince >= HOLD_LEAVE_MS) return { hold: false, held: null, reason: 'left' };
    return { hold: true, held: { ...held, missSince }, reason: 'brief-gap' };
  }
  if (!isSameFace(held.box, localFace.box)) return { hold: false, held: null, reason: 'changed' };
  // Follow slow drift (swaying) so only a sudden jump counts as a different person.
  return { hold: true, held: { ...held, box: localFace.box, missSince: null }, reason: 'same-face' };
}

/** Capture size: at most 480 wide (landscape) / 640 tall (portrait phones), never upscaled. */
export function captureSize(sourceWidth, sourceHeight) {
  const scale = Math.min(1, MAX_CAPTURE_W / sourceWidth, MAX_CAPTURE_H / sourceHeight);
  return { width: Math.round(sourceWidth * scale), height: Math.round(sourceHeight * scale) };
}

export default function useAttendanceRecognition({ session, setSession, videoRef, captureCanvasRef, setRecords, setStatusText, setStatusState, markedStudentIdsRef, setJustMarkedId, stopCamera, playAttendanceChime, overlayStateRef, overlayLabelRef, faceBoxTargetRef, lastFaceSeenRef, localFaceRef }) {
  const nextGapRef = useRef(SCAN_GAP_MS);
  const timerRef = useRef(null);
  const requestPendingRef = useRef(false);
  const recognizingRef = useRef(false);
  const pausedRef = useRef(false);
  const captureAndRecognizeRef = useRef(null);
  const scheduleScanRef = useRef(null);
  const heldRef = useRef(null); // the student just finished: skip uploads while their face stays put

  // One request at a time; the next frame is sent SCAN_GAP_MS after the previous answer.
  // 250 ms keeps a student's 3 confirmation frames quick while staying far below the
  // server's 180 requests/min limit.
  const scheduleScan = useCallback((delay = SCAN_GAP_MS) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!recognizingRef.current || pausedRef.current) return;
    timerRef.current = setTimeout(async () => {
      await captureAndRecognizeRef.current?.();
      if (recognizingRef.current && !pausedRef.current) scheduleScanRef.current?.(nextGapRef.current);
    }, delay);
  }, []);

  scheduleScanRef.current = scheduleScan;

  // `sentBox` = where the on-device detector saw the face when this frame was captured. The pause
  // only starts if the face is still there now, so a student who stepped in while the request was
  // running is never paused by the previous student's answer.
  const applyRecognition = useCallback((data, captureWidth, captureHeight, sentBox = null) => {
    const video = videoRef.current;
    heldRef.current = null;
    if (!video || !data?.recognized?.length) return;
    const result = data.recognized[0];
    const startHold = () => {
      const local = localFaceRef?.current;
      const now = Date.now();
      if (local?.ready && local.box && now - local.at <= LOCAL_FRESH_MS && isSameFace(sentBox, local.box)) {
        heldRef.current = { box: local.box, at: now, missSince: null };
      }
    };
    if (result.box) {
      const left = result.box.left ?? result.box.x;
      const top = result.box.top ?? result.box.y;
      const right = result.box.right ?? result.box.x + result.box.w;
      const bottom = result.box.bottom ?? result.box.y + result.box.h;
      const scaleX = (video.videoWidth || captureWidth) / captureWidth;
      const scaleY = (video.videoHeight || captureHeight) / captureHeight;
      faceBoxTargetRef.current = { left: left * scaleX, top: top * scaleY, right: right * scaleX, bottom: bottom * scaleY };
      lastFaceSeenRef.current = Date.now();
    }
    const studentId = result.student_id;
    if (result.already_marked || (studentId && markedStudentIdsRef.current.has(studentId))) {
      overlayStateRef.current = 'verified';
      overlayLabelRef.current = result.name ? `${result.name} — Present` : 'Present';
      setStatusText(`Already Verified: ${result.name || 'Student'}`);
      setStatusState('success');
      startHold();
      return;
    }
    if (result.matched) {
      const attendanceStatus = result.new_status || 'present';
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      overlayStateRef.current = 'verified';
      overlayLabelRef.current = `${result.name} — ${attendanceStatus === 'late' ? 'Late' : 'Present'}`;
      setStatusText(`Recorded ${attendanceStatus === 'late' ? 'Late' : 'Present'}: ${result.name}`);
      setStatusState('success');
      if (studentId) markedStudentIdsRef.current.add(studentId);
      setRecords((records) => records.map((record) => {
        const id = record.student || record.student_details?.id;
        const number = record.student_id_number || record.student_details?.student_id;
        return id === studentId || (number && number === result.student_number)
          ? { ...record, status: attendanceStatus, recognized_at: new Date().toISOString(), display_time: time }
          : record;
      }));
      if (studentId) {
        setJustMarkedId(studentId);
        setTimeout(() => setJustMarkedId(null), 2000);
      }
      playAttendanceChime(attendanceStatus === 'late');
      startHold();
      return;
    }
    if (result.quality_failed) {
      // Frame skipped by the landmark quality gate (angle, eyes, distance, blur, light).
      overlayStateRef.current = 'verifying';
      overlayLabelRef.current = result.message || 'Look straight at the camera';
      setStatusText(result.message || 'Look straight at the camera');
      setStatusState('verifying');
      return;
    }
    if (result.verifying) {
      overlayStateRef.current = 'verifying';
      overlayLabelRef.current = result.name ? `Verifying ${result.name}...` : 'Verifying...';
      setStatusText(`Verifying: ${result.name || 'Face'}`);
      setStatusState('verifying');
      return;
    }
    if (result.wrong_section) {
      overlayStateRef.current = 'error';
      overlayLabelRef.current = 'Wrong Section';
      setStatusText(`${result.name} — wrong section`);
      setStatusState('error');
      return;
    }
    if (result.liveness_failed) {
      overlayStateRef.current = 'error';
      overlayLabelRef.current = 'Liveness Check Failed';
      setStatusText(result.message || 'Spoof Detected: Photo/Screen');
      setStatusState('error');
      return;
    }
    if (result.name === 'Unknown') {
      overlayStateRef.current = 'error';
      overlayLabelRef.current = 'Not Enrolled';
      setStatusText('Face not enrolled in this section');
      setStatusState('error');
    }
  }, [faceBoxTargetRef, lastFaceSeenRef, localFaceRef, markedStudentIdsRef, overlayLabelRef, overlayStateRef, playAttendanceChime, setJustMarkedId, setRecords, setStatusState, setStatusText, videoRef]);

  const captureAndRecognize = useCallback(async () => {
    if (!recognizingRef.current || requestPendingRef.current || pausedRef.current || !session?.id) return;
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    // The student just finished is still standing there: no upload, keep their "Present" label.
    if (heldRef.current) {
      const decision = holdDecision(heldRef.current, localFaceRef?.current);
      heldRef.current = decision.held;
      if (decision.hold) {
        nextGapRef.current = HOLD_CHECK_MS;
        return;
      }
    }
    // On-device pre-check: no upload (and no server time) unless a student is in front.
    const gate = localFaceGate(localFaceRef?.current);
    if (!gate.send) {
      nextGapRef.current = IDLE_CHECK_MS;
      overlayStateRef.current = 'scanning';
      overlayLabelRef.current = gate.hint;
      setStatusText(gate.hint);
      setStatusState('ready');
      return;
    }
    const { width, height } = captureSize(video.videoWidth || 640, video.videoHeight || 480);
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(video, 0, 0, width, height);
    const localNow = localFaceRef?.current;
    const sentBox = localNow?.ready && localNow.box && Date.now() - localNow.at <= LOCAL_FRESH_MS ? localNow.box : null;
    requestPendingRef.current = true;
    try {
      const response = await Api.recognizeFace(session.id, canvas.toDataURL('image/jpeg', 0.72));
      if (response?.session_closed) {
        stopCamera();
        setSession((previous) => ({ ...previous, status: 'closed' }));
        setStatusText('Session closed');
        setStatusState('off');
      } else if (response?.attendance_unavailable) {
        stopCamera();
        setStatusText(response.error || 'Attendance is outside the scheduled time window');
        setStatusState('off');
      } else if (response?.success) {
        applyRecognition(response, width, height, sentBox);
        // A student halfway through confirmation: send the next frame right away.
        nextGapRef.current = response.recognized?.[0]?.verifying ? VERIFY_GAP_MS : SCAN_GAP_MS;
      }
    } catch (error) {
      nextGapRef.current = SCAN_GAP_MS;
      console.error('Scan recognition error:', error);
      setStatusText('Recognition unavailable — retrying');
      setStatusState('error');
    } finally {
      requestPendingRef.current = false;
    }
  }, [applyRecognition, captureCanvasRef, localFaceRef, overlayLabelRef, overlayStateRef, session?.id, setSession, setStatusState, setStatusText, stopCamera, videoRef]);

  captureAndRecognizeRef.current = captureAndRecognize;

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const setRecognitionActive = useCallback((active) => {
    recognizingRef.current = active;
    heldRef.current = null; // a new camera run always starts with a fresh look
    if (!active && timerRef.current) clearTimeout(timerRef.current);
  }, []);
  const setRecognitionPaused = useCallback((paused) => {
    pausedRef.current = paused;
    if (paused && timerRef.current) clearTimeout(timerRef.current);
  }, []);
  const markAttendance = useCallback(async (studentId, attendanceStatus = 'present') => {
    if (!session?.id) return;
    const response = await Api.markAttendance(session.id, studentId, attendanceStatus);
    if (!response?.success) return;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    markedStudentIdsRef.current.add(studentId);
    setRecords((records) => records.map((record) => (record.student || record.student_details?.id) === studentId
      ? { ...record, status: attendanceStatus, recognized_at: new Date().toISOString(), display_time: time }
      : record));
    setJustMarkedId(studentId);
    setTimeout(() => setJustMarkedId(null), 2500);
    setStatusText(`Recorded: ${response.student_name}`);
    setStatusState('success');
    playAttendanceChime(attendanceStatus === 'late');
  }, [markedStudentIdsRef, playAttendanceChime, session?.id, setJustMarkedId, setRecords, setStatusState, setStatusText]);

  return { captureAndRecognize, applyRecognition, scheduleScan, markAttendance, setRecognitionActive, setRecognitionPaused, requestPendingRef };
}
