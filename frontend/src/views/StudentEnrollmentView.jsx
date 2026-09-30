import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Api } from '../api';
import BiometricEnrollmentStep from '../components/enrollment/BiometricEnrollmentStep';
import EnrollmentStepIndicator from '../components/enrollment/EnrollmentStepIndicator';
import StudentEnrollmentForm from '../components/enrollment/StudentEnrollmentForm';
import { getPhPhoneValidationMessage } from '../utils/validation';
import { cameraErrorMessage, openCameraInto } from '../utils/faceCapture';
import { getCitiesMunicipalities, getProvinces, getRegions } from '../utils/phLocationsApi';

// v2: older drafts were seeded with a default program/course (CITEC/BSIT); drop them.
const DRAFT_KEY = 'attendfr_enrollment_draft_v2';
const LEGACY_DRAFT_KEY = 'attendfr_enrollment_draft';

const defaultFormData = {
  student_id: '', program: '', program_id: '', course: '', course_ref: '', section_id: '', year_level: '',
  family_name: '', given_name: '', middle_name: '', gender: 'Male', birth_date: '', birth_place: '',
  civil_status: 'Single', religion: 'Roman Catholic', citizenship: 'Filipino',
  lang_english: true, lang_filipino: true, lang_cebuano: true, lang_others: '',
  address: '', region_code: '', region: '', province_code: '', province: '', municipality_code: '', municipality: '',
  current_address: '', current_region: '', current_province: '', current_municipality: '',
  permanent_address: '', permanent_region: '', permanent_province: '', permanent_municipality: '',
  telephone: '', mobile_number: '', email: '', password: '',
};

export default function StudentEnrollmentView({ onNavigate, onSetHeaderInfo }) {
  const [formData, setFormData] = useState(() => readDraft());
  const [regionsList, setRegionsList] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [courses, setCourses] = useState([]);
  const [sections, setSections] = useState([]);
  const [provincesList, setProvincesList] = useState([]);
  const [citiesList, setCitiesList] = useState([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [enrolledStudent, setEnrolledStudentState] = useState(() => readSessionObject('attendfr_enrolled_student'));
  const [activeStep, setActiveStepState] = useState(() => Number(sessionStorage.getItem('attendfr_enrollment_step') || 1));
  const [cameraActive, setCameraActive] = useState(false);
  const [enrollingFace, setEnrollingFace] = useState(false);
  const [faceMsg, setFaceMsg] = useState('');
  const [faceMsgType, setFaceMsgType] = useState('');
  const [flash, setFlash] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);

  const clearEnrollmentSession = () => {
    [DRAFT_KEY, LEGACY_DRAFT_KEY, 'attendfr_enrollment_step', 'attendfr_enrolled_student'].forEach((key) => sessionStorage.removeItem(key));
  };

  const setEnrolledStudent = (student) => {
    setEnrolledStudentState(student);
    if (student) sessionStorage.setItem('attendfr_enrolled_student', JSON.stringify(student));
    else sessionStorage.removeItem('attendfr_enrolled_student');
  };

  const setActiveStep = (step) => {
    setActiveStepState(step);
    sessionStorage.setItem('attendfr_enrollment_step', String(step));
  };

  useEffect(() => {
    // Keep an in-progress form recoverable, but never persist the account password in browser storage.
    const { password, ...safeDraft } = formData;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(safeDraft));
  }, [formData]);

  useEffect(() => {
    onSetHeaderInfo?.({
      title: 'Student Admission & Enrollment',
      subtitle: 'Student demographic registration & biometric onboarding',
      headerActions: <button type="button" className="btn btn-outline btn-sm" onClick={() => { clearEnrollmentSession(); onNavigate('face_enrollment'); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><span>Back to Students</span></button>,
    });
  }, [onNavigate, onSetHeaderInfo]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([Api.getPrograms(), Api.getCourses(), Api.getSections()]).then(([programData, courseData, sectionData]) => {
      if (!cancelled) {
        setPrograms(programData || []);
        setCourses(courseData || []);
        setSections(sectionData || []);
      }
    }).catch(() => {
      if (!cancelled) {
        setPrograms([]);
        setCourses([]);
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // Only resolve a course the user (or a restored draft) already chose; never pre-select one.
    if (!formData.course || formData.course_ref || !courses.length) return;
    const match = courses.find((course) => course.code?.toUpperCase() === formData.course?.toUpperCase());
    if (match) {
      setFormData((previous) => ({
        ...previous,
        course_ref: match.id,
        program_id: match.program,
        program: match.program_details?.code || previous.program,
      }));
    }
  }, [courses, formData.course, formData.course_ref]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingLocations(true);
      try {
        const regions = await getRegions();
        if (!cancelled) setRegionsList(regions);
        const regionCode = formData.region_code;
        if (regionCode) {
          const provinces = await getProvinces(regionCode);
          if (!cancelled) setProvincesList(provinces);
          if (formData.province_code) {
            const cities = await getCitiesMunicipalities(regionCode, formData.province_code);
            if (!cancelled) setCitiesList(cities);
          }
        }
      } catch (error) { console.error('Error loading location data:', error); } finally { if (!cancelled) setLoadingLocations(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (formData.student_id) return;
    Api.getNextStudentId().then((response) => setFormData((previous) => ({ ...previous, student_id: response?.next_student_id || '23100000450' }))).catch(() => setFormData((previous) => ({ ...previous, student_id: '23100000450' })));
  }, [formData.student_id]);

  const handleRegionChange = async (regionCode) => {
    const region = regionsList.find((item) => item.code === regionCode);
    const regionName = region?.displayName || region?.name || '';
    setProvincesList([]); setCitiesList([]);
    if (!regionCode) { setFormData((previous) => ({ ...previous, region_code: '', region: '', province_code: '', province: '', municipality_code: '', municipality: '' })); return; }
    const provinces = await getProvinces(regionCode); setProvincesList(provinces);
    setFormData((previous) => ({ ...previous, region_code: regionCode, region: regionName, province_code: '', province: provinces.length ? '' : 'N/A', municipality_code: '', municipality: '' }));
    if (!provinces.length) setCitiesList(await getCitiesMunicipalities(regionCode, null));
  };

  const handleProvinceChange = async (provinceCode) => {
    const province = provincesList.find((item) => item.code === provinceCode);
    const regionCode = formData.region_code;
    setCitiesList(provinceCode ? await getCitiesMunicipalities(regionCode, provinceCode) : []);
    setFormData((previous) => ({ ...previous, province_code: provinceCode, province: province?.name || '', municipality_code: '', municipality: '' }));
  };

  const handleMunicipalityChange = (municipalityCode) => {
    const municipality = citiesList.find((item) => item.code === municipalityCode);
    setFormData((previous) => ({ ...previous, municipality_code: municipalityCode, municipality: municipality?.name || '' }));
  };

  const startCamera = async () => {
    setFaceMsg(''); setFaceMsgType('');
    try {
      streamRef.current = await openCameraInto(videoRef.current, streamRef.current);
      setCameraActive(true);
    } catch (error) {
      setCameraActive(false); setFaceMsgType('danger'); setFaceMsg(cameraErrorMessage(error));
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  };

  const handleSubmitForm = async (event, proceedToFace = true) => {
    event.preventDefault(); setErrorMsg(''); setSuccessMsg('');
    if (!formData.family_name.trim() || !formData.given_name.trim()) { setErrorMsg('Please enter both Family Name (Last Name) and Given Name (First Name).'); return; }
    if (!formData.program_id || !formData.course_ref || !formData.year_level) { setErrorMsg('Please select the Academic Program, Degree Course, and Year Level.'); return; }
    if (!formData.password) { setErrorMsg('Please set a strong account password for the student.'); return; }
    const phoneError = formData.mobile_number ? getPhPhoneValidationMessage(formData.mobile_number) : '';
    if (phoneError) { setErrorMsg(phoneError); return; }
    try {
      setSubmitting(true);
      const languages = [['lang_english', 'English'], ['lang_filipino', 'Filipino'], ['lang_cebuano', 'Cebuano']].filter(([key]) => formData[key]).map(([, value]) => value);
      if (formData.lang_others.trim()) languages.push(formData.lang_others.trim());
      const address = (formData.address || formData.permanent_address || formData.current_address || '').trim();
      const region = formData.region || formData.permanent_region || formData.current_region || '';
      const province = formData.province || formData.permanent_province || formData.current_province || '';
      const municipality = formData.municipality || formData.permanent_municipality || formData.current_municipality || '';
      const payload = { role: 'student', student_id: formData.student_id || 'auto', first_name: formData.given_name.trim(), last_name: formData.family_name.trim(), middle_name: formData.middle_name.trim(), gender: formData.gender, birth_date: formData.birth_date || null, birth_place: formData.birth_place.trim(), civil_status: formData.civil_status, religion: formData.religion.trim(), citizenship: formData.citizenship.trim(), languages_spoken: languages.join(', '), current_address: address, current_region: region, current_province: province, current_municipality: municipality, permanent_address: address, permanent_region: region, permanent_province: province, permanent_municipality: municipality, telephone: formData.telephone.trim(), mobile_number: formData.mobile_number.trim(), phone: formData.mobile_number.trim() || formData.telephone.trim(), email: formData.email.trim(), password: formData.password, year_level: Number(formData.year_level), course: formData.course, course_ref: formData.course_ref ? Number(formData.course_ref) : null, section_id: formData.section_id ? Number(formData.section_id) : null };
      const response = await Api.createUser(payload);
      if (formData.section_id && response?.student_profile?.id) {
        await Api.enrollStudent(formData.section_id, response.student_profile.id);
      }
      setEnrolledStudent(response); setSuccessMsg(`Student ${payload.first_name} ${payload.last_name} registered! They sign in with Student ID "${response?.student_profile?.student_id || response?.username || payload.student_id}".`);
      if (proceedToFace) setActiveStep(2); else setTimeout(() => onNavigate('face_enrollment'), 1800);
    } catch (error) { setErrorMsg(error.message || 'Failed to submit student enrollment. Please verify form details.'); } finally { setSubmitting(false); }
  };

  // Called by the hands-free capture with the 3 checked frames. Throws so it can retry.
  const submitFaceFrames = async (frames) => {
    const profileId = enrolledStudent?.student_profile?.id;
    if (!profileId) {
      const error = new Error('Student profile record not found. Unable to link face capture.');
      error.code = 'no_profile';
      throw error;
    }
    try {
      setEnrollingFace(true); setFaceMsg('');
      const response = await Api.enrollFaceWithConfirm(profileId, frames);
      setFaceMsgType('success'); setFaceMsg(response.message || 'Face enrolled and linked to this student.');
      setTimeout(stopCamera, 1500); // let the "Done" check show briefly
      return response;
    } catch (error) {
      setFaceMsgType('danger'); setFaceMsg(error.message || 'Failed to enroll facial biometrics. Please reposition and try again.');
      throw error;
    } finally { setEnrollingFace(false); }
  };
  const flashOnce = () => { setFlash(true); setTimeout(() => setFlash(false), 200); };

  const finishEnrollment = () => { stopCamera(); clearEnrollmentSession(); onNavigate('face_enrollment'); };

  return <div className="page-content" style={{ maxWidth: '1150px', margin: '0 auto', paddingBottom: '60px' }}>
    {errorMsg && <div className="alert alert-danger" role="alert" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}><AlertCircle size={18} /><span>{errorMsg}</span></div>}
    {successMsg && <div className="alert alert-success" role="status" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}><CheckCircle2 size={18} /><span>{successMsg}</span></div>}
    <div className="enrollment-draft-note" role="note">Your progress is saved during this browser session. For privacy, account passwords are never stored in the saved draft.</div>
    <EnrollmentStepIndicator activeStep={activeStep} hasEnrolledStudent={Boolean(enrolledStudent)} onStepChange={setActiveStep} />
    {activeStep === 1 && <StudentEnrollmentForm formData={formData} setFormData={setFormData} programs={programs} courses={courses} sections={sections} regionsList={regionsList} provincesList={provincesList} citiesList={citiesList} loadingLocations={loadingLocations} onRegionChange={handleRegionChange} onProvinceChange={handleProvinceChange} onMunicipalityChange={handleMunicipalityChange} onSubmit={handleSubmitForm} onSaveOnly={(event) => handleSubmitForm(event, false)} onCancel={finishEnrollment} submitting={submitting} />}
    {activeStep === 2 && <BiometricEnrollmentStep formData={formData} videoRef={videoRef} cameraActive={cameraActive} flash={flash} faceMsg={faceMsg} faceMsgType={faceMsgType} enrollingFace={enrollingFace} onStartCamera={startCamera} onStopCamera={stopCamera} onSubmitFrames={submitFaceFrames} onFlash={flashOnce} onReviewForm={() => setActiveStep(1)} onFinish={finishEnrollment} />}
  </div>;
}

function readDraft() {
  try { sessionStorage.removeItem(LEGACY_DRAFT_KEY); const draft = sessionStorage.getItem(DRAFT_KEY); return draft ? { ...defaultFormData, ...JSON.parse(draft) } : defaultFormData; } catch { return defaultFormData; }
}
function readSessionObject(key) {
  try { const value = sessionStorage.getItem(key); return value ? JSON.parse(value) : null; } catch { return null; }
}
