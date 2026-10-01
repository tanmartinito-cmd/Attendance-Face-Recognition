import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle, GraduationCap, LogOut, ShieldCheck } from 'lucide-react';
import { Api } from '../api';
import FaceCaptureStage, { FaceGuidanceChecklist } from '../components/faceCapture/FaceCaptureStage';
import useFaceGuidance from '../components/faceCapture/useFaceGuidance';
import useAutoFaceCapture from '../components/faceCapture/useAutoFaceCapture';
import { cameraErrorMessage, openCameraInto } from '../utils/faceCapture';

/**
 * Required first step for a student without an enrolled face. There is no way to skip it:
 * the server refuses every other request until the face is enrolled. The only other action
 * is signing out.
 */
export default function FaceEnrollmentGateView({ user, onEnrolled, onSignOut }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const doneTimerRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [flash, setFlash] = useState(false);
  const [result, setResult] = useState({ type: '', message: '' });

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }, []);

  useEffect(() => () => { clearTimeout(doneTimerRef.current); stopCamera(); }, [stopCamera]);

  const startCamera = async () => {
    setResult({ type: '', message: '' });
    try {
      streamRef.current = await openCameraInto(videoRef.current, streamRef.current);
      setCameraActive(true);
    } catch (error) {
      setCameraActive(false);
      setResult({ type: 'danger', message: cameraErrorMessage(error) });
    }
  };

  const submitFrames = useCallback(async (frames) => {
    try {
      setEnrolling(true);
      const response = await Api.enrollOwnFace(frames);
      setResult({ type: 'success', message: 'Face enrolled. Opening AttendFR…' });
      stopCamera();
      doneTimerRef.current = setTimeout(() => onEnrolled?.(), 1500);
      return response;
    } catch (error) {
      if (error.code === 'already_enrolled') { onEnrolled?.(); return null; }
      setResult({ type: 'danger', message: error.message });
      throw error; // lets the capture retry
    } finally {
      setEnrolling(false);
    }
  }, [onEnrolled, stopCamera]);

  const guidance = useFaceGuidance(videoRef, cameraActive);
  const auto = useAutoFaceCapture({
    active: cameraActive && result.type !== 'success',
    guidance, videoRef, canvasRef, onSubmit: submitFrames,
    onFlash: () => { setFlash(true); setTimeout(() => setFlash(false), 200); },
  });

  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username;

  return (
    <div className="face-gate-page">
      <header className="face-gate-header">
        <span className="face-gate-brand"><GraduationCap size={20} aria-hidden="true" /> AttendFR</span>
        <button type="button" className="btn btn-outline btn-sm" onClick={onSignOut} disabled={enrolling}>
          <LogOut size={14} aria-hidden="true" /> Sign out
        </button>
      </header>

      <main className="face-gate-main">
        <h1 className="face-gate-title"><Camera size={22} aria-hidden="true" /> Enroll your face to continue</h1>
        <p className="face-gate-lead">
          Welcome, <strong>{name}</strong>. Your instructors take attendance by recognizing your face, so this
          one-time step is required before you can use AttendFR. It takes about a minute.
        </p>

        <div className="face-enroll-body face-gate-body">
          <div className="face-enroll-main">
            <FaceCaptureStage
              videoRef={videoRef}
              canvasRef={canvasRef}
              cameraActive={cameraActive}
              flash={flash}
              guidance={guidance}
              autoCapture={auto}
              onStartCamera={startCamera}
              offlineTitle={result.type === 'success' ? 'Face enrolled' : 'Camera is off'}
              offlineHint={result.type === 'success' ? '' : 'Allow camera access when your browser asks.'}
              showStart={result.type !== 'success'}
            />
            {cameraActive && auto.canRetry && (
              <button type="button" className="btn btn-success" style={{ marginTop: '10px' }} onClick={auto.retry}>Try again</button>
            )}
          </div>

          <aside className="face-enroll-side">
            <FaceGuidanceChecklist guidance={guidance} cameraActive={cameraActive} />
            {result.message && (
              <div className={`alert alert-${result.type} face-enroll-result`} role={result.type === 'danger' ? 'alert' : 'status'}>
                {result.type === 'success' ? <CheckCircle size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
                <span>{result.message}</span>
              </div>
            )}
            <div className="face-enroll-tips">
              <strong>Please use your real face</strong>
              <ul>
                <li>Only you should be in the oval. Look straight at the camera with your eyes open.</li>
                <li>Remove caps, sunglasses and masks. Face the light, not a window.</li>
                <li>Photos and phone screens are rejected automatically.</li>
                <li>Capture is automatic: hold still while the green ring fills.</li>
              </ul>
            </div>
            <div className="face-enroll-tips">
              <strong><ShieldCheck size={13} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> Why this matters</strong>
              <ul>
                <li>If the face you enroll is not really yours, you will not be recognized in class and will be marked absent.</li>
                <li>You can enroll only once. To change it later, ask your administrator.</li>
                <li>Your face data is private and used only for attendance.</li>
              </ul>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
