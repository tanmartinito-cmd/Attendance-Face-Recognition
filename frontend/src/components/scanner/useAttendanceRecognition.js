import { useCallback, useEffect, useRef } from 'react';
import { Api } from '../../api';

export default function useAttendanceRecognition({ session, setSession, videoRef, captureCanvasRef, setRecords, setStatusText, setStatusState, markedStudentIdsRef, setJustMarkedId, stopCamera, playAttendanceChime, overlayStateRef, overlayLabelRef, faceBoxTargetRef, lastFaceSeenRef }) {
  const timerRef = useRef(null);
  const requestPendingRef = useRef(false);
  const recognizingRef = useRef(false);
  const pausedRef = useRef(false);
  const captureAndRecognizeRef = useRef(null);
  const scheduleScanRef = useRef(null);

  const scheduleScan = useCallback((delay = 500) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!recognizingRef.current || pausedRef.current) return;
    timerRef.current = setTimeout(async () => {
      await captureAndRecognizeRef.current?.();
      if (recognizingRef.current && !pausedRef.current) scheduleScanRef.current?.(500);
    }, delay);
  }, []);

  scheduleScanRef.current = scheduleScan;

  const applyRecognition = useCallback((data, captureWidth, captureHeight) => {
    const video = videoRef.current;
    if (!video || !data?.recognized?.length) return;
    const result = data.recognized[0];
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
  }, [faceBoxTargetRef, lastFaceSeenRef, markedStudentIdsRef, overlayLabelRef, overlayStateRef, playAttendanceChime, setJustMarkedId, setRecords, setStatusState, setStatusText, videoRef]);

  const captureAndRecognize = useCallback(async () => {
    if (!recognizingRef.current || requestPendingRef.current || pausedRef.current || !session?.id) return;
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    const sourceWidth = video.videoWidth || 640;
    const sourceHeight = video.videoHeight || 480;
    const width = Math.min(sourceWidth, 480);
    const height = Math.round(sourceHeight * (width / sourceWidth));
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(video, 0, 0, width, height);
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
        applyRecognition(response, width, height);
      }
    } catch (error) {
      console.error('Scan recognition error:', error);
      setStatusText('Recognition unavailable — retrying');
      setStatusState('error');
    } finally {
      requestPendingRef.current = false;
    }
  }, [applyRecognition, captureCanvasRef, session?.id, setSession, setStatusState, setStatusText, stopCamera, videoRef]);

  captureAndRecognizeRef.current = captureAndRecognize;

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const setRecognitionActive = useCallback((active) => {
    recognizingRef.current = active;
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
