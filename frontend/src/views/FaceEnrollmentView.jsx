import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Api } from '../api';
import FaceEnrollmentModal from '../components/faceEnrollment/FaceEnrollmentModal';
import RegisterStudentModal from '../components/faceEnrollment/RegisterStudentModal';
import StudentEnrollmentTable from '../components/faceEnrollment/StudentEnrollmentTable';
import { cameraErrorMessage, openCameraInto } from '../utils/faceCapture';
import { usePageLoading, useShowHeaderAdd } from '../ui';
import { checkPasswordCriteria } from '../utils/validation';

const emptyRegisterForm = { student_id: '', first_name: '', last_name: '', email: '', course: '', year_level: '', password: '' };

export default function FaceEnrollmentView({ onNavigate, onSetHeaderInfo }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = usePageLoading(() => loadStudents());
  const [search, setSearch] = useState('');
  const [activeModalStudent, setActiveModalStudent] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [resultType, setResultType] = useState('');
  const [flash, setFlash] = useState(false);
  const [modalSession, setModalSession] = useState(0);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [registerForm, setRegisterForm] = useState(emptyRegisterForm);
  const [registerSubmitting, setRegisterSubmitting] = useState(false);
  const [registerError, setRegisterError] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState('');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const autoCloseRef = useRef(null); // pending "close after success" timer

  const loadStudents = async () => {
    try { setLoading(true); setStudents((await Api.getStudents()) || []); } catch (error) { console.error('Failed to load students:', error); } finally { setLoading(false); }
  };
  useEffect(() => { loadStudents(); return () => { clearTimeout(autoCloseRef.current); stopCamera(); }; }, []);
  // One "register" action everywhere: the full admission flow (or the quick form without routing).
  const openRegister = useCallback(() => (onNavigate ? onNavigate('student_enrollment') : setShowRegisterModal(true)), [onNavigate]);
  // No students yet: the only Register button is the one centered in the table.
  const showHeaderAdd = useShowHeaderAdd(loading, students.length > 0);
  useEffect(() => { onSetHeaderInfo?.({ title: 'Select Student to Enroll', subtitle: 'Enroll or update biometric 128-D face embeddings for students', headerActions: showHeaderAdd ? <button type="button" className="btn btn-primary" onClick={openRegister} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>Register New Student</button> : null }); }, [onSetHeaderInfo, openRegister, showHeaderAdd]);

  const startCamera = async () => {
    setResultMsg(''); setResultType('');
    try {
      streamRef.current = await openCameraInto(videoRef.current, streamRef.current);
      setCameraActive(true);
    } catch (error) {
      setCameraActive(false); setResultType('danger'); setResultMsg(cameraErrorMessage(error));
    }
  };
  const stopCamera = () => { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; if (videoRef.current) videoRef.current.srcObject = null; setCameraActive(false); };
  // The camera only starts when the operator presses "Start Camera" inside the camera view.
  // Each open gets a new key, so the modal (capture progress, guidance, messages) starts fresh.
  const openFaceModal = (student) => { clearTimeout(autoCloseRef.current); stopCamera(); setModalSession((n) => n + 1); setActiveModalStudent(student); setResultMsg(''); setResultType(''); };
  const closeFaceModal = () => { stopCamera(); setActiveModalStudent(null); setResultMsg(''); setResultType(''); };
  // Called by the hands-free capture with the 3 checked frames. Throws so the capture flow can retry.
  const submitFaceFrames = async (frames) => {
    if (!activeModalStudent) throw new Error('No student selected.');
    try {
      setEnrolling(true); setResultMsg('');
      const response = await Api.enrollFaceWithConfirm(activeModalStudent.id, frames);
      setResultType('success'); setResultMsg(response.message || 'Face biometrics enrolled successfully!');
      setStudents((previous) => previous.map((student) => student.id === activeModalStudent.id ? { ...student, is_face_enrolled: true, face_enrolled_at: new Date().toISOString(), face_image: response.face_image || student.face_image } : student));
      clearTimeout(autoCloseRef.current);
      autoCloseRef.current = setTimeout(closeFaceModal, 1800);
      return response;
    } catch (error) {
      setResultType('danger'); setResultMsg(error.message || 'Face enrollment failed. Ensure face is lit and centered.');
      throw error;
    } finally { setEnrolling(false); }
  };
  const flashOnce = () => { setFlash(true); setTimeout(() => setFlash(false), 200); };
  const handleRegisterSubmit = async (event) => {
    event.preventDefault();
    if (!registerForm.student_id || !registerForm.first_name || !registerForm.last_name) { setRegisterError('Student ID, First Name, and Last Name are required.'); return; }
    // No default password: every student gets their own (the server enforces the same policy).
    if (!registerForm.password) { setRegisterError('Please set a password for the student.'); return; }
    const { isStrong, criteria } = checkPasswordCriteria(registerForm.password);
    if (!isStrong) { setRegisterError(`Password must have: ${criteria.filter((c) => !c.met).map((c) => c.label.toLowerCase()).join(', ')}.`); return; }
    try { setRegisterSubmitting(true); setRegisterError(''); await Api.createUser({ username: registerForm.student_id, email: registerForm.email || `${registerForm.student_id.toLowerCase().replace(/[^a-z0-9]/g, '')}@student.urios.edu.ph`, first_name: registerForm.first_name, last_name: registerForm.last_name, role: 'student', student_id: registerForm.student_id, course: registerForm.course, year_level: Number(registerForm.year_level) || 1, password: registerForm.password }); setRegisterSuccess(`Student ${registerForm.first_name} ${registerForm.last_name} registered successfully!`); setShowRegisterModal(false); setRegisterForm(emptyRegisterForm); await loadStudents(); setTimeout(() => setRegisterSuccess(''), 4000); } catch (error) { setRegisterError(error.message || 'Failed to register student.'); } finally { setRegisterSubmitting(false); } };

  const query = search.toLowerCase().trim();
  const filteredStudents = students.filter((student) => { const name = `${student.user?.first_name || ''} ${student.user?.last_name || ''}`.toLowerCase(); return !query || name.includes(query) || (student.student_id || '').toLowerCase().includes(query) || (student.course || '').toLowerCase().includes(query); });

  return <div className="page-content">{registerSuccess && <div className="alert alert-success" style={{ marginBottom: '16px' }}>{registerSuccess}</div>}<StudentEnrollmentTable students={filteredStudents} hasStudents={students.length > 0} loading={loading} search={search} onSearchChange={setSearch} onOpenFaceModal={openFaceModal} onRegister={openRegister} /><FaceEnrollmentModal key={modalSession} student={activeModalStudent} videoRef={videoRef} canvasRef={canvasRef} cameraActive={cameraActive} enrolling={enrolling} resultMsg={resultMsg} resultType={resultType} flash={flash} onClose={closeFaceModal} onStartCamera={startCamera} onStopCamera={stopCamera} onSubmitFrames={submitFaceFrames} onFlash={flashOnce} /><RegisterStudentModal isOpen={showRegisterModal} form={registerForm} setForm={setRegisterForm} error={registerError} submitting={registerSubmitting} onClose={() => setShowRegisterModal(false)} onSubmit={handleRegisterSubmit} /></div>;
}
