import { useCallback, useState } from 'react';
import { Api } from '../../api';
import { startAttendanceSession } from '../../utils/startAttendance';

/**
 * Camera constraints. 'user' = front (selfie) camera, 'environment' = back camera, which an
 * instructor's phone points at the students. 1280x720 is plenty: frames are downscaled to
 * 480 px (640 px tall in portrait) before upload.
 */
export function cameraConstraints(facingMode) {
  return { video: { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, facingMode: { ideal: facingMode }, frameRate: { ideal: 30, max: 30 } }, audio: false };
}

export default function useScannerCamera({ session, setSession, activeSessionId, videoRef, overlayCanvasRef, streamRef, isRecognizingRef, isPausedRef, initLocalFaceDetector, scheduleScan, onRecognitionStart, onRecognitionStop, onSessionRecords, setStatusText, setStatusState, mirrorRef }) {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [facingMode, setFacingMode] = useState('user');
  const [canSwitchCamera, setCanSwitchCamera] = useState(false);

  const openStream = useCallback(async (mode) => {
    const mediaStream = await navigator.mediaDevices.getUserMedia(cameraConstraints(mode));
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = mediaStream;
    if (mirrorRef) mirrorRef.current = mode === 'user'; // selfie view is mirrored, back camera is not
    if (videoRef.current) { videoRef.current.srcObject = mediaStream; await videoRef.current.play(); }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices?.();
      setCanSwitchCamera((devices || []).filter((device) => device.kind === 'videoinput').length > 1);
    } catch { setCanSwitchCamera(false); }
    return mediaStream;
  }, [mirrorRef, streamRef, videoRef]);

  const stopCamera = useCallback(() => {
    isRecognizingRef.current = false;
    isPausedRef.current = false;
    onRecognitionStop?.();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    if (overlayCanvasRef.current) {
      const context = overlayCanvasRef.current.getContext('2d');
      context.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
    }
    setIsCameraActive(false);
    setIsPaused(false);
    setStatusText('Camera off');
    setStatusState('off');
  }, [onRecognitionStop, overlayCanvasRef, setStatusState, setStatusText, videoRef]);

  const startCamera = useCallback(async () => {
    try {
      let currentSession = session;
      if (!currentSession?.id) {
        if (!activeSessionId) {
          alert('No schedule selected. Please go back and select a class schedule to start attendance.');
          return;
        }
        currentSession = await startAttendanceSession(activeSessionId); // asks Present / Late when starting late
        if (!currentSession) { setStatusText('Camera off'); setStatusState('off'); return; }
        setSession(currentSession);
        try {
          const detail = await Api.getSessionDetail(currentSession.id);
          onSessionRecords(detail.records || []);
        } catch {
          // Records will load lazily.
        }
      }
      if (currentSession?.status === 'closed') {
        throw new Error('This attendance session is closed. Reopen it explicitly before starting the camera.');
      }
      setStatusText('Starting camera & detector...');
      setStatusState('ready');
      await initLocalFaceDetector();
      await openStream(facingMode);
      isRecognizingRef.current = true;
      onRecognitionStart?.();
      isPausedRef.current = false;
      setIsCameraActive(true);
      setIsPaused(false);
      setStatusText('Camera active');
      setStatusState('ready');
      scheduleScan(150);
    } catch (error) {
      console.error('Failed to start camera:', error);
      alert(`Camera error: ${error.message}`);
      setStatusText('Camera error');
      setStatusState('error');
    }
  }, [activeSessionId, facingMode, initLocalFaceDetector, onRecognitionStart, onSessionRecords, openStream, scheduleScan, session, setSession, setStatusState, setStatusText]);

  /** Front <-> back camera while scanning (phones / tablets). */
  const switchCamera = useCallback(async () => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    try {
      await openStream(next);
      setFacingMode(next);
    } catch (error) {
      console.error('Failed to switch camera:', error);
      setStatusText('Could not switch camera');
      setStatusState('error');
    }
  }, [facingMode, openStream, setStatusState, setStatusText]);

  const togglePause = useCallback(() => {
    if (isPausedRef.current) {
      isPausedRef.current = false;
      setIsPaused(false);
      setStatusText('Camera active');
      setStatusState('ready');
      scheduleScan(100);
    } else {
      isPausedRef.current = true;
      setIsPaused(true);
      setStatusText('Paused');
      setStatusState('ready');
    }
  }, [scheduleScan, setStatusState, setStatusText]);

  return { isCameraActive, isPaused, streamRef, isRecognizingRef, isPausedRef, startCamera, stopCamera, togglePause, switchCamera, canSwitchCamera, facingMode };
}
