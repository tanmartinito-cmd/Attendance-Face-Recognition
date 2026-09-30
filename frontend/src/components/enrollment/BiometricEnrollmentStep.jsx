import React from 'react';
import { AlertCircle, Camera, CheckCircle2 } from 'lucide-react';
import FaceCaptureStage, { FaceGuidanceChecklist } from '../faceCapture/FaceCaptureStage';
import useFaceGuidance from '../faceCapture/useFaceGuidance';
import useAutoFaceCapture from '../faceCapture/useAutoFaceCapture';

export default function BiometricEnrollmentStep({
  formData,
  videoRef,
  cameraActive,
  flash,
  faceMsg,
  faceMsgType,
  enrollingFace,
  onStartCamera,
  onStopCamera,
  onSubmitFrames,
  onFlash,
  onReviewForm,
  onFinish,
}) {
  const guidance = useFaceGuidance(videoRef, cameraActive);
  const done = faceMsgType === 'success';
  // Hands-free: face placed well -> "Hold steady" -> 3, 2, 1 -> Processing -> Done
  const auto = useAutoFaceCapture({ active: cameraActive && !done, guidance, videoRef, onSubmit: onSubmitFrames, onFlash });

  return (
    <div className="card face-enroll-step">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', padding: '16px 20px', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}><Camera size={18} /> Facial Biometric Capture</h3>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>Enrolling biometric record for {formData.given_name} {formData.family_name}</div>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={onReviewForm}>Review Form Details</button>
      </div>

      <div className="card-body" style={{ padding: '20px' }}>
        <p className="biometric-consent-note">Capture only with the student’s informed consent. The system checks for a single face and securely links the resulting biometric record to this student profile.</p>

        <div className="face-enroll-body">
          <div className="face-enroll-main">
            <FaceCaptureStage
              videoRef={videoRef}
              cameraActive={cameraActive}
              flash={flash}
              guidance={guidance}
              autoCapture={auto}
              onStartCamera={onStartCamera}
              offlineTitle={done ? 'Face enrolled' : 'Camera ready for face enrollment'}
              offlineHint={done ? 'You can return to the student list.' : 'Have the student look straight at the camera.'}
              showStart={!done}
            />
          </div>

          <aside className="face-enroll-side">
            {/* The live instruction is shown on the camera itself; the checklist shows what's OK. */}
            <FaceGuidanceChecklist guidance={guidance} cameraActive={cameraActive} />
            {faceMsg && (
              <div className={`alert alert-${faceMsgType} face-enroll-result`} role={faceMsgType === 'danger' ? 'alert' : 'status'}>
                {done ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                <span>{faceMsg}</span>
              </div>
            )}
            {cameraActive && (
              <div className="face-enroll-side-actions">
                <p className="face-auto-note">Capture is automatic: the green ring fills as good photos are taken. Only the person in the oval is used.</p>
                {auto.canRetry && (
                  <button type="button" className="btn btn-success btn-lg" onClick={auto.retry}>Try again</button>
                )}
                <button type="button" className="btn btn-outline" onClick={onStopCamera} disabled={enrollingFace}>Stop Camera</button>
              </div>
            )}
          </aside>
        </div>

        <div style={{ marginTop: '24px', paddingTop: '18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {!done && <button type="button" className="btn btn-outline" onClick={onFinish}>Finish biometric enrollment later</button>}
          <button type="button" className="btn btn-primary" onClick={onFinish} style={{ marginLeft: 'auto' }}>{done ? 'Done — Return to Registered Students' : 'Return to Registered Students'}</button>
        </div>
      </div>
    </div>
  );
}
