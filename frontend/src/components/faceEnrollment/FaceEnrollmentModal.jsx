import React, { useEffect } from 'react';
import { AlertTriangle, Camera, CheckCircle, X } from 'lucide-react';
import FaceCaptureStage, { FaceGuidanceChecklist } from '../faceCapture/FaceCaptureStage';
import useFaceGuidance from '../faceCapture/useFaceGuidance';
import useAutoFaceCapture from '../faceCapture/useAutoFaceCapture';

export default function FaceEnrollmentModal({ student, videoRef, canvasRef, cameraActive, enrolling, resultMsg, resultType, flash, onClose, onStartCamera, onStopCamera, onSubmitFrames, onFlash }) {
  const guidance = useFaceGuidance(videoRef, Boolean(student) && cameraActive);
  // Hands-free: face placed well -> "Hold steady" -> 3, 2, 1 -> Processing -> Done
  const auto = useAutoFaceCapture({
    active: Boolean(student) && cameraActive && resultType !== 'success',
    guidance, videoRef, canvasRef, onSubmit: onSubmitFrames, onFlash,
  });

  useEffect(() => {
    if (!student || enrolling) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [student, enrolling, onClose]);

  if (!student) return null;

  const fullName = `${student.user?.first_name || ''} ${student.user?.last_name || ''}`.trim() || 'Student';
  const isReEnroll = Boolean(student.is_face_enrolled);

  return (
    <div className="modal-backdrop open" role="dialog" aria-modal="true" aria-labelledby="face-enroll-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}>
      <div className="modal-card face-enroll-modal">
        <div className="modal-header face-enroll-header">
          <div>
            <h3 className="modal-title" id="face-enroll-title"><Camera size={18} /> {isReEnroll ? 'Re-enroll Face' : 'Face Enrollment'}</h3>
            <div className="modal-subtitle"><strong>{fullName}</strong> • ID: <code>{student.student_id}</code></div>
          </div>
          <button type="button" onClick={onClose} className="modal-close-btn" aria-label="Close face enrollment" disabled={enrolling}><X size={18} /></button>
        </div>

        <div className="modal-body face-enroll-body">
          <div className="face-enroll-main">
            <FaceCaptureStage
              videoRef={videoRef}
              canvasRef={canvasRef}
              cameraActive={cameraActive}
              flash={flash}
              guidance={guidance}
              autoCapture={auto}
              onStartCamera={onStartCamera}
              offlineTitle={resultType === 'success' ? 'Face enrolled' : 'Camera is off'}
              offlineHint={resultType === 'success' ? '' : 'Have the student look straight at the camera.'}
              showStart={resultType !== 'success'}
            />
          </div>

          <aside className="face-enroll-side">
            {/* The live instruction is shown on the camera itself; the checklist shows what's OK. */}
            <FaceGuidanceChecklist guidance={guidance} cameraActive={cameraActive} />

            {resultMsg && (
              <div className={`alert alert-${resultType} face-enroll-result`} role={resultType === 'danger' ? 'alert' : 'status'}>
                {resultType === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                <span>{resultMsg}</span>
              </div>
            )}

            <div className="face-enroll-tips">
              <strong>Capture is automatic</strong>
              <ul>
                <li>Center the face in the oval; the green ring fills as good photos are taken.</li>
                <li>Look straight ahead with eyes open. Small movements are fine.</li>
                <li>Only the person in the oval is used; people in the background are ignored.</li>
                <li>Remove caps, sunglasses, or masks.</li>
                <li>Light should face the student, not behind.</li>
              </ul>
            </div>
          </aside>
        </div>

        <div className="modal-footer face-enroll-footer">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={enrolling}>Close</button>
          {/* "Start Camera" lives only in the centre of the camera view. */}
          {cameraActive && (
            <div className="face-enroll-footer-actions">
              <button type="button" className="btn btn-outline" onClick={onStopCamera} disabled={enrolling}>Stop Camera</button>
              {auto.canRetry && (
                <button type="button" className="btn btn-success" onClick={auto.retry}>
                  {isReEnroll ? 'Try re-enrolling again' : 'Try again'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
