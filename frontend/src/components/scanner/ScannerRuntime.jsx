import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReopenSessionModal from './ReopenSessionModal';
import { Api } from '../../api';
import { confirmAction } from '../../ui';
import ScannerShell from './ScannerShell';
import useAttendanceRecognition from './useAttendanceRecognition';
import useFaceDetection from './useFaceDetection';
import useFaceOverlay from './useFaceOverlay';
import useScannerCamera from './useScannerCamera';
import useScannerSession from './useScannerSession';

export default function ScannerRuntime({ onNavigate, activeSessionId, onSetHeaderInfo }) {
  const [statusText, setStatusText] = useState('Camera off');
  const [statusState, setStatusState] = useState('off');
  const [searchQuery, setSearchQuery] = useState('');
  const [justMarkedId, setJustMarkedId] = useState(null);
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState('');
  const videoRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const isRecognizingRef = useRef(false);
  const isPausedRef = useRef(false);
  const faceBoxTargetRef = useRef(null);
  const faceBoxSmoothRef = useRef(null);
  const lastFaceSeenRef = useRef(0);
  const localFaceRef = useRef(null); // latest on-device detection: { box, at, width, height }
  const mirrorRef = useRef(true);    // front camera is shown mirrored; back camera is not
  const overlayStateRef = useRef('idle');
  const overlayLabelRef = useRef('');
  const scheduleRef = useRef(() => {});
  const stopCameraRef = useRef(() => {});
  const { session, setSession, records, setRecords, loading, markedStudentIdsRef } = useScannerSession(activeSessionId);
  const faceDetection = useFaceDetection();
  const playAttendanceChime = (late = false) => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain();
      oscillator.connect(gain); gain.connect(context.destination); oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(late ? 660 : 880, context.currentTime); oscillator.frequency.setValueAtTime(late ? 550 : 1320, context.currentTime + 0.1); gain.gain.setValueAtTime(0.28, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.35); oscillator.start(); oscillator.stop(context.currentTime + 0.35);
    } catch { /* browser audio policy */ }
  };
  const recognition = useAttendanceRecognition({ session, setSession, videoRef, captureCanvasRef, setRecords, setStatusText, setStatusState, markedStudentIdsRef, setJustMarkedId, stopCamera: () => stopCameraRef.current(), playAttendanceChime, overlayStateRef, overlayLabelRef, faceBoxTargetRef, lastFaceSeenRef, localFaceRef });
  scheduleRef.current = recognition.scheduleScan;
  // Stable callbacks: inline arrows here re-created startCamera/stopCamera on every render,
  // which re-ran the header effect below in an endless loop ("Maximum update depth exceeded").
  const { setRecognitionActive } = recognition;
  const scheduleScanStable = useCallback((delay) => scheduleRef.current(delay), []);
  const onRecognitionStart = useCallback(() => setRecognitionActive(true), [setRecognitionActive]);
  const onRecognitionStop = useCallback(() => setRecognitionActive(false), [setRecognitionActive]);
  const camera = useScannerCamera({ session, setSession, activeSessionId, videoRef, overlayCanvasRef, streamRef, isRecognizingRef, isPausedRef, initLocalFaceDetector: faceDetection.initLocalFaceDetector, scheduleScan: scheduleScanStable, onRecognitionStart, onRecognitionStop, onSessionRecords: setRecords, setStatusText, setStatusState, mirrorRef });
  stopCameraRef.current = camera.stopCamera;
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const openReopenModal = useCallback(() => {
    if (!session?.id || session.status !== 'closed') return;
    setReopenError('');
    setShowReopenModal(true);
  }, [session?.id, session?.status]);
  const reopenSession = useCallback(async (reason) => {
    if (!session?.id || session.status !== 'closed') return;
    try {
      setReopening(true);
      setReopenError('');
      const response = await Api.reopenSession(session.id, reason);
      setSession(response.session);
      setShowReopenModal(false);
      setStatusText('Session reopened. Start the camera when ready.');
      setStatusState('ready');
    } catch (error) {
      setReopenError(error.message || 'Unable to reopen session');
    } finally {
      setReopening(false);
    }
  }, [session?.id, session?.status, setSession, setStatusState, setStatusText]);
  useFaceOverlay({ videoRef, overlayCanvasRef, isCameraActive: camera.isCameraActive, detectLocalFace: faceDetection.detectLocalFace, faceBoxTargetRef, faceBoxSmoothRef, lastFaceSeenRef, overlayStateRef, overlayLabelRef, localFaceRef, isLocalDetectorReady: faceDetection.isLocalDetectorReady, mirrorRef });

  useEffect(() => { faceDetection.initLocalFaceDetector(); return () => camera.stopCamera(); }, [activeSessionId]);
  // Header only needs rebuilding when the session itself changes; handlers read the latest
  // camera/navigation functions through refs so this effect cannot loop.
  const sectionName = session?.schedule_details?.section_name;
  const subjectCode = session?.schedule_details?.subject_code;
  const room = session?.schedule_details?.room;
  const sessionDate = session?.date;
  const sessionId = session?.id;
  const sessionStatus = session?.status;
  useEffect(() => {
    if (!onSetHeaderInfo) return;
    const stop = () => stopCameraRef.current();
    const goTo = (tab) => navigateRef.current?.(tab);
    const closeSession = async () => {
      if (!(await confirmAction({ title: 'Close this attendance session?', message: 'Recognition stops and students not yet marked stay absent. You can reopen the session later with a reason.', confirmLabel: 'Close session', tone: 'danger' }))) return;
      try {
        await Api.closeSession(sessionId);
      } finally {
        stop();
        setSession((previous) => (previous ? { ...previous, status: 'closed' } : previous));
        goTo('dashboard');
      }
    };
    onSetHeaderInfo({
      title: `Live Attendance${sectionName ? ` – ${sectionName}` : ''}`,
      subtitle: sessionId ? `${subjectCode || '—'} | ${sessionDate} | Room ${room || 'Main Hall'}` : 'Live Camera Scanner',
      headerActions: (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => { stop(); goTo('sections'); }}>Back to Sections</button>
          {sessionStatus === 'open' && <button type="button" className="btn btn-danger btn-sm" onClick={closeSession}>Close Session</button>}
          {sessionStatus === 'closed' && <button type="button" className="btn btn-primary btn-sm" onClick={openReopenModal}>Reopen Session</button>}
        </div>
      ),
    });
  }, [onSetHeaderInfo, openReopenModal, room, sectionName, sessionDate, sessionId, sessionStatus, setSession, subjectCode]);

  const filteredRecords = useMemo(() => { const query = searchQuery.toLowerCase().trim(); return records.filter((record) => { const student = record.student_details || record.student_info || {}; const name = (record.student_name || `${student.user?.first_name || ''} ${student.user?.last_name || ''}`).toLowerCase(); const id = (record.student_id_number || student.student_id || '').toLowerCase(); return name.includes(query) || id.includes(query); }); }, [records, searchQuery]);
  const presentCount = records.filter((record) => record.status === 'present').length;
  const lateCount = records.filter((record) => record.status === 'late').length;
  const statusColor = statusState === 'error' ? '#ef4444' : ['scanning', 'verifying', 'success'].includes(statusState) ? '#10b981' : 'var(--text-muted)';
  return <>
    <ScannerShell session={session} records={records} filteredRecords={filteredRecords} loading={loading} searchQuery={searchQuery} onSearchChange={setSearchQuery} videoRef={videoRef} overlayCanvasRef={overlayCanvasRef} captureCanvasRef={captureCanvasRef} isCameraActive={camera.isCameraActive} isPaused={camera.isPaused} statusText={statusText} statusColor={statusColor} justMarkedId={justMarkedId} presentCount={presentCount} lateCount={lateCount} onStartCamera={camera.startCamera} onStopCamera={camera.stopCamera} onTogglePause={camera.togglePause} onSwitchCamera={camera.switchCamera} canSwitchCamera={camera.canSwitchCamera} facingMode={camera.facingMode} onReopenSession={openReopenModal} onManualMark={recognition.markAttendance} />
    <ReopenSessionModal session={session} isOpen={showReopenModal} loading={reopening} error={reopenError} onClose={() => { if (!reopening) setShowReopenModal(false); }} onConfirm={reopenSession} />
  </>;
}
