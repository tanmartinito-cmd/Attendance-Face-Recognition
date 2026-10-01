import React, { useEffect, useState, useId } from 'react';
import { ArrowLeft, CheckCircle2, GraduationCap, MapPin, Phone, ShieldCheck } from 'lucide-react';
import { Api } from '../api';
import PasswordInput from '../components/shared/PasswordInput';
import PhoneInput from '../components/shared/PhoneInput';
import TurnstileWidget from '../components/shared/TurnstileWidget';
import { getRegions, getProvinces, getCitiesMunicipalities } from '../utils/phLocationsApi';

const EMPTY_STUDENT = {
  role: 'student', student_id: '', given_name: '', middle_name: '', family_name: '',
  gender: 'Male', birth_date: '', birth_place: '', civil_status: 'Single', religion: 'Roman Catholic',
  citizenship: 'Filipino', lang_english: false, lang_filipino: false, lang_cebuano: false, lang_others: '',
  address: '', region_code: '', region: '', province_code: '', province: '', municipality_code: '', municipality: '',
  mobile_number: '', telephone: '', email: '', password: '', confirm_password: '',
  program_id: '', program: '', course_ref: '', course: '', year_level: '',
};

const EMPTY_FACULTY = {
  role: 'instructor', faculty_id: '', given_name: '', middle_name: '', family_name: '',
  gender: 'Male', birth_date: '', birth_place: '', civil_status: 'Single', religion: 'Roman Catholic',
  citizenship: 'Filipino', lang_english: false, lang_filipino: false, lang_cebuano: false, lang_others: '',
  address: '', region_code: '', region: '', province_code: '', province: '', municipality_code: '', municipality: '',
  mobile_number: '', telephone: '', email: '', password: '', confirm_password: '',
  department: '',
};

function SectionCard({ icon, title, children }) {
  return (
    <div className="card">
      <div className="card-header" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="card-title" style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {icon} {title}
        </span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  const generatedId = useId();
  const child = React.isValidElement(children)
    ? React.cloneElement(children, { id: children.props.id || generatedId })
    : children;
  return (
    <div className="form-group">
      <label className="form-label" htmlFor={React.isValidElement(children) ? (children.props.id || generatedId) : undefined}>
        {label}
      </label>
      {child}
    </div>
  );
}

/**
 * Public registration with complete profile information.
 */
export default function RegisterView({ onBackToLogin }) {
  const [role, setRole] = useState('student');
  const [formData, setFormData] = useState(EMPTY_STUDENT);
  const [programs, setPrograms] = useState([]);
  const [courses, setCourses] = useState([]);
  const [regionsList, setRegionsList] = useState([]);
  const [provincesList, setProvincesList] = useState([]);
  const [citiesList, setCitiesList] = useState([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    Promise.all([
      Api.getRegisterOptions(),
      Api.getPrograms(),
      Api.getCourses(),
    ]).then(([opts, progs, crs]) => {
      setTurnstileSiteKey(opts.turnstile_site_key || '');
      setPrograms(progs || []);
      setCourses(crs || []);
    }).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingLocations(true);
      try {
        const regions = await getRegions();
        if (!cancelled) setRegionsList(regions);
      } catch (error) {
        console.error('Error loading regions:', error);
      } finally {
        if (!cancelled) setLoadingLocations(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!formData.region_code) { setProvincesList([]); setCitiesList([]); return; }
    let cancelled = false;
    getProvinces(formData.region_code).then((provinces) => {
      if (!cancelled) {
        setProvincesList(provinces);
        if (!provinces.length) {
          getCitiesMunicipalities(formData.region_code, null).then((cities) => {
            if (!cancelled) setCitiesList(cities);
          });
        }
      }
    });
    return () => { cancelled = true; };
  }, [formData.region_code]);

  useEffect(() => {
    if (!formData.region_code || !formData.province_code) { setCitiesList([]); return; }
    let cancelled = false;
    getCitiesMunicipalities(formData.region_code, formData.province_code).then((cities) => {
      if (!cancelled) setCitiesList(cities);
    });
    return () => { cancelled = true; };
  }, [formData.region_code, formData.province_code]);

  const handleRoleChange = (newRole) => {
    setRole(newRole);
    setFormData(newRole === 'student' ? EMPTY_STUDENT : EMPTY_FACULTY);
    setError('');
  };

  const update = (key, value) => setFormData((prev) => ({ ...prev, [key]: value }));

  const handleRegionChange = (regionCode) => {
    const region = regionsList.find((item) => item.code === regionCode);
    const regionName = region?.displayName || region?.name || '';
    if (!regionCode) {
      setFormData((prev) => ({ ...prev, region_code: '', region: '', province_code: '', province: '', municipality_code: '', municipality: '' }));
      return;
    }
    setFormData((prev) => ({ ...prev, region_code: regionCode, region: regionName, province_code: '', province: '', municipality_code: '', municipality: '' }));
  };

  const handleProvinceChange = (provinceCode) => {
    const province = provincesList.find((item) => item.code === provinceCode);
    setFormData((prev) => ({ ...prev, province_code: provinceCode, province: province?.name || '', municipality_code: '', municipality: '' }));
  };

  const handleMunicipalityChange = (municipalityCode) => {
    const municipality = citiesList.find((item) => item.code === municipalityCode);
    setFormData((prev) => ({ ...prev, municipality_code: municipalityCode, municipality: municipality?.name || '' }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!formData.family_name.trim() || !formData.given_name.trim()) {
      setError('Please enter both Family Name and Given Name.');
      return;
    }
    if (!formData.mobile_number.trim()) {
      setError('Mobile number is required.');
      return;
    }
    if (!formData.email.trim()) {
      setError('Email address is required.');
      return;
    }
    if (!formData.password || formData.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (formData.password !== formData.confirm_password) {
      setError('Passwords do not match.');
      return;
    }

    if (role === 'student') {
      if (!formData.student_id.trim()) {
        setError('Student ID is required.');
        return;
      }
      if (!formData.program_id || !formData.course_ref || !formData.year_level) {
        setError('Please select Program, Course, and Year Level.');
        return;
      }
    } else {
      if (!formData.faculty_id.trim()) {
        setError('Faculty ID is required.');
        return;
      }
    }

    if (turnstileSiteKey && !turnstileToken) {
      setError('Please complete the "Verify you are human" check.');
      return;
    }

    try {
      setSubmitting(true);
      const languages = [
        formData.lang_english && 'English',
        formData.lang_filipino && 'Filipino',
        formData.lang_cebuano && 'Cebuano',
        formData.lang_others.trim(),
      ].filter(Boolean).join(', ');

      const payload = {
        role,
        student_id: formData.student_id || undefined,
        faculty_id: formData.faculty_id || undefined,
        first_name: formData.given_name.trim(),
        last_name: formData.family_name.trim(),
        middle_name: formData.middle_name.trim(),
        gender: formData.gender,
        birth_date: formData.birth_date || null,
        birth_place: formData.birth_place.trim(),
        civil_status: formData.civil_status,
        religion: formData.religion.trim(),
        citizenship: formData.citizenship.trim(),
        languages_spoken: languages,
        current_address: formData.address.trim(),
        current_region: formData.region,
        current_province: formData.province,
        current_municipality: formData.municipality,
        permanent_address: formData.address.trim(),
        permanent_region: formData.region,
        permanent_province: formData.province,
        permanent_municipality: formData.municipality,
        mobile_number: formData.mobile_number.trim(),
        telephone: formData.telephone.trim(),
        phone: formData.mobile_number.trim(),
        email: formData.email.trim(),
        password: formData.password,
        confirm_password: formData.confirm_password,
        program: formData.program,
        course: formData.course,
        course_ref: formData.course_ref ? Number(formData.course_ref) : undefined,
        year_level: formData.year_level ? Number(formData.year_level) : undefined,
        department: formData.department || undefined,
        turnstile_token: turnstileToken,
        face_consent: true,
      };

      await Api.register(payload);
      setDone(true);
    } catch (err) {
      setError(err.message || 'Registration failed. Please check your details and try again.');
      setResetKey((k) => k + 1);
    } finally {
      setSubmitting(false);
    }
  };

  const hasRegion = Boolean(formData.region_code);
  const hasProvince = Boolean(formData.province_code);

  if (done) {
    return (
      <div className="login-page">
        <div className="login-card" role="status">
          <CheckCircle2 size={40} style={{ color: '#16a34a', display: 'block', margin: '0 auto 12px' }} aria-hidden="true" />
          <h1 style={{ fontSize: '20px', textAlign: 'center', margin: '0 0 8px' }}>Registration submitted</h1>
          <p className="text-muted" style={{ textAlign: 'center', fontSize: '13.5px' }}>
            An administrator will review your details. You can sign in with your
            {role === 'student' ? ' Student ID' : ' Faculty ID'} and password once approved.
            {role === 'student' && ' At your first sign-in you will be asked to enroll your face.'}
          </p>
          <button type="button" className="btn btn-primary w-full btn-lg" style={{ justifyContent: 'center', marginTop: '12px' }} onClick={onBackToLogin}>
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="register-card" style={{ maxWidth: '1100px' }}>
        <div className="login-logo">
          <div className="login-logo-icon"><GraduationCap size={28} aria-hidden="true" /></div>
          <h1>Create an account</h1>
          <p>Complete your profile — your account is activated after admin approval.</p>
        </div>

        <div className="register-role" role="radiogroup" aria-label="I am a">
          {[['student', 'Student'], ['instructor', 'Faculty']].map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={role === value}
              className={`btn ${role === value ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => handleRoleChange(value)}>
              {label}
            </button>
          ))}
        </div>

        {error && <div className="alert alert-danger" role="alert" style={{ marginBottom: '16px' }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
            {/* Left Column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Academic Card */}
              <SectionCard icon={<GraduationCap size={16} />} title={role === 'student' ? "Academic Program & Degree" : "Professional Information"}>
                {role === 'student' ? (
                  <div className="grid-2">
                    <Field label="Academic Program *">
                      <select className="form-select" value={formData.program_id || ''} onChange={(e) => {
                        const programId = e.target.value;
                        const program = programs.find((p) => String(p.id) === String(programId));
                        setFormData((prev) => ({ ...prev, program_id: programId, program: program?.code || '', course_ref: '', course: '' }));
                      }} required>
                        <option value="">Select Program</option>
                        {programs.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Degree Course *">
                      <select className="form-select" value={formData.course_ref || ''} onChange={(e) => {
                        const course = courses.find((c) => String(c.id) === String(e.target.value));
                        setFormData((prev) => ({ ...prev, course_ref: e.target.value, course: course?.code || '' }));
                      }} disabled={!formData.program_id} required>
                        <option value="">{formData.program_id ? 'Select Course' : 'Select Program First'}</option>
                        {courses.filter((c) => !formData.program_id || String(c.program) === String(formData.program_id)).map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Student ID *">
                      <input className="form-control" required value={formData.student_id} onChange={(e) => update('student_id', e.target.value)} />
                    </Field>
                    <Field label="Year Level *">
                      <select className="form-select" value={formData.year_level || ''} onChange={(e) => update('year_level', e.target.value)} required>
                        <option value="">Select Year Level</option>
                        <option value={1}>1st Year</option>
                        <option value={2}>2nd Year</option>
                        <option value={3}>3rd Year</option>
                        <option value={4}>4th Year</option>
                      </select>
                    </Field>
                  </div>
                ) : (
                  <>
                    <Field label="Faculty ID *">
                      <input className="form-control" required value={formData.faculty_id} onChange={(e) => update('faculty_id', e.target.value)} />
                    </Field>
                    <Field label="Department">
                      <select className="form-select" value={formData.department} onChange={(e) => update('department', e.target.value)}>
                        <option value="">Select your department</option>
                        {programs.map((p) => <option key={p.id} value={p.name}>{p.code} - {p.name}</option>)}
                      </select>
                    </Field>
                  </>
                )}
              </SectionCard>

              {/* Personal Info Card */}
              <SectionCard icon={<GraduationCap size={16} />} title="Personal Information">
                <Field label="Family Name (Last Name) *">
                  <input className="form-control" required value={formData.family_name} onChange={(e) => update('family_name', e.target.value.toUpperCase())} />
                </Field>
                <Field label="Given Name (First Name) *">
                  <input className="form-control" required value={formData.given_name} onChange={(e) => update('given_name', e.target.value.toUpperCase())} />
                </Field>
                <Field label="Middle Name">
                  <input className="form-control" value={formData.middle_name} onChange={(e) => update('middle_name', e.target.value.toUpperCase())} />
                </Field>
                <div className="grid-2">
                  <Field label="Date of Birth *">
                    <input type="date" className="form-control" required value={formData.birth_date} onChange={(e) => update('birth_date', e.target.value)} />
                  </Field>
                  <Field label="Place of Birth *">
                    <input className="form-control" required value={formData.birth_place} onChange={(e) => update('birth_place', e.target.value.toUpperCase())} />
                  </Field>
                </div>
              </SectionCard>

              {/* Demographics Card */}
              <SectionCard icon={<ShieldCheck size={16} />} title="Demographics & Civil Status">
                <div className="grid-2">
                  <Field label="Gender *">
                    <select className="form-select" value={formData.gender} onChange={(e) => update('gender', e.target.value)}>
                      <option>Male</option>
                      <option>Female</option>
                    </select>
                  </Field>
                  <Field label="Civil Status">
                    <select className="form-select" value={formData.civil_status} onChange={(e) => update('civil_status', e.target.value)}>
                      <option>Single</option>
                      <option>Married</option>
                      <option>Widowed</option>
                      <option>Separated</option>
                    </select>
                  </Field>
                </div>
                <div className="grid-2">
                  <Field label="Religion">
                    <select className="form-select" value={formData.religion} onChange={(e) => update('religion', e.target.value)}>
                      <option>Roman Catholic</option>
                      <option>Seventh-day Adventist</option>
                      <option>Iglesia ni Cristo</option>
                      <option>Baptist</option>
                      <option>Islam</option>
                      <option>Born Again Christian</option>
                      <option>Other</option>
                    </select>
                  </Field>
                  <Field label="Citizenship">
                    <input className="form-control" value={formData.citizenship} onChange={(e) => update('citizenship', e.target.value)} />
                  </Field>
                </div>
                <div className="form-group">
                  <label className="form-label">Languages Spoken</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px' }}>
                    {[['lang_english', 'English'], ['lang_filipino', 'Filipino'], ['lang_cebuano', 'Cebuano']].map(([key, label]) => (
                      <label key={key}>
                        <input type="checkbox" checked={Boolean(formData[key])} onChange={(e) => update(key, e.target.checked)} /> {label}
                      </label>
                    ))}
                    <input className="form-control" style={{ width: '160px' }} placeholder="Other dialect" value={formData.lang_others} onChange={(e) => update('lang_others', e.target.value)} />
                  </div>
                </div>
              </SectionCard>
            </div>

            {/* Right Column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Address Card */}
              <SectionCard icon={<MapPin size={16} />} title="Address Information">
                <Field label="House#/Street Name & Barangay">
                  <textarea className="form-control" rows={2} value={formData.address} onChange={(e) => update('address', e.target.value)} />
                </Field>
                <div className="grid-2">
                  <Field label="Region">
                    <select className="form-select" value={formData.region_code || ''} onChange={(e) => handleRegionChange(e.target.value)} disabled={loadingLocations}>
                      <option value="">-- Select Region --</option>
                      {regionsList.map((region) => <option key={region.code} value={region.code}>{region.displayName || region.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Province">
                    <select className="form-select" value={formData.province_code || ''} onChange={(e) => handleProvinceChange(e.target.value)} disabled={!hasRegion}>
                      <option value="">{hasRegion ? '-- Select Province --' : '-- Select Region First --'}</option>
                      {provincesList.map((province) => <option key={province.code} value={province.code}>{province.name}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="City / Municipality">
                  <select className="form-select" value={formData.municipality_code || ''} onChange={(e) => handleMunicipalityChange(e.target.value)} disabled={!hasRegion || (provincesList.length > 0 && !hasProvince)}>
                    <option value="">{!hasRegion ? '-- Select Region First --' : provincesList.length > 0 && !hasProvince ? '-- Select Province First --' : '-- Select City / Municipality --'}</option>
                    {citiesList.map((city) => <option key={city.code} value={city.code}>{city.name}</option>)}
                  </select>
                </Field>
              </SectionCard>

              {/* Contact & Security Card */}
              <SectionCard icon={<Phone size={16} />} title="Contact & Security">
                <PhoneInput id="mobile_number" floatingLabel="Mobile Number *" required value={formData.mobile_number} onChange={(e) => update('mobile_number', e.target.value)} />
                <Field label="Telephone / Landline">
                  <input className="form-control" value={formData.telephone} onChange={(e) => update('telephone', e.target.value)} />
                </Field>
                <Field label="Personal Email Address *">
                  <input type="email" className="form-control" required value={formData.email} onChange={(e) => update('email', e.target.value)} />
                </Field>
                <PasswordInput id="password" floatingLabel="Account Password *" required value={formData.password} onChange={(e) => update('password', e.target.value)} showStrength />
                <PasswordInput id="confirm_password" floatingLabel="Confirm Password *" required value={formData.confirm_password} onChange={(e) => update('confirm_password', e.target.value)} showStrength={false} />
              </SectionCard>
            </div>
          </div>

          {/* Turnstile & Submit */}
          <div style={{ marginTop: '20px' }}>
            <TurnstileWidget siteKey={turnstileSiteKey} onToken={setTurnstileToken} resetKey={resetKey}
              onError={() => setError('The human check could not load. Refresh and try again.')} />

            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <button type="button" className="btn-link" onClick={onBackToLogin}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                <ArrowLeft size={14} aria-hidden="true" /> Back to sign in
              </button>
              <button type="submit" className="btn btn-primary btn-lg" disabled={submitting}
                style={{ justifyContent: 'center', minWidth: '220px' }}>
                {submitting ? 'Submitting registration...' : 'Submit registration'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
