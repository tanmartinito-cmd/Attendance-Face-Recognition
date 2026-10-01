import React, { useId } from 'react';
import { GraduationCap, MapPin, Phone, ShieldCheck } from 'lucide-react';
import PasswordInput from '../shared/PasswordInput';
import PhoneInput from '../shared/PhoneInput';

export default function StudentEnrollmentForm({
  formData,
  setFormData,
  programs = [],
  courses = [],
  sections = [],
  regionsList = [],
  provincesList = [],
  citiesList = [],
  loadingLocations,
  onRegionChange,
  onProvinceChange,
  onMunicipalityChange,
  onSubmit,
  onSaveOnly,
  onCancel,
  submitting,
}) {
  const update = (key, value) => setFormData((previous) => ({ ...previous, [key]: value }));
  const hasRegion = Boolean(formData.region_code || formData.permanent_region_code || formData.current_region_code);
  const hasProvince = Boolean(formData.province_code || formData.permanent_province_code || formData.current_province_code);

  return (
    <form onSubmit={(event) => onSubmit(event, true)}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <SectionCard icon={<GraduationCap size={16} />} title="Academic Program & Degree">
            <Field label="Student ID Number *">
              <input 
                className="form-control" 
                required 
                value={formData.student_id} 
                onChange={(event) => update('student_id', event.target.value)}
                placeholder="e.g., 23100000450"
                maxLength={20}
              />
              <small className="form-text">FSUU Student ID format: 23100000XXX</small>
            </Field>
            <div className="grid-2">
              <Field label="Academic Program">
                <select className="form-select" value={formData.program_id || ''} onChange={(event) => {
                  const programId = event.target.value;
                  const program = programs.find((item) => String(item.id) === String(programId));
                  // Changing the program clears the dependent choices; nothing is pre-selected.
                  setFormData((previous) => ({
                    ...previous,
                    program_id: programId,
                    program: program?.code || '',
                    course_ref: '',
                    course: '',
                    section_id: '',
                  }));
                }} required>
                  <option value="">Select Program</option>
                  {programs.map((program) => <option key={program.id} value={program.id}>{program.code} - {program.name}</option>)}
                </select>
              </Field>
              <Field label="Degree Course">
                <select className="form-select" value={formData.course_ref || ''} onChange={(event) => {
                  const course = courses.find((item) => String(item.id) === String(event.target.value));
                  setFormData((previous) => ({ ...previous, course_ref: event.target.value, course: course?.code || '', section_id: '' }));
                }} disabled={!formData.program_id} required>
                  <option value="">{formData.program_id ? 'Select Course' : 'Select Program First'}</option>
                  {courses.filter((course) => !formData.program_id || String(course.program) === String(formData.program_id)).map((course) => <option key={course.id} value={course.id}>{course.code} - {course.name}</option>)}
                </select>
              </Field>
              <Field label="Year Level"><select className="form-select" value={formData.year_level || ''} onChange={(event) => update('year_level', event.target.value ? Number(event.target.value) : '')} required><option value="">Select Year Level</option><option value={1}>1st Year</option><option value={2}>2nd Year</option><option value={3}>3rd Year</option><option value={4}>4th Year</option></select></Field>
              <Field label="Section (Optional)">
                <select className="form-select" value={formData.section_id || ''} onChange={(event) => update('section_id', event.target.value)} disabled={!formData.course_ref}>
                  <option value="">Assign Section Later</option>
                  {sections.filter((section) => {
                    const sectionCourseId = section.course_ref || section.course_details?.id;
                    return sectionCourseId ? String(sectionCourseId) === String(formData.course_ref) : String(section.course || '').toUpperCase() === String(formData.course || '').toUpperCase();
                  }).map((section) => <option key={section.id} value={section.id}>{section.name} • {section.school_year} ({section.semester})</option>)}
                </select>
                <small className="form-text">You can assign the Section later if it is not available yet.</small>
              </Field>
            </div>
          </SectionCard>

          <SectionCard icon={<GraduationCap size={16} />} title="Personal Information">
            <Field label="Family Name (Last Name) *"><input className="form-control" required value={formData.family_name} onChange={(event) => update('family_name', event.target.value.toUpperCase())} /></Field>
            <Field label="Given Name (First Name) *"><input className="form-control" required value={formData.given_name} onChange={(event) => update('given_name', event.target.value.toUpperCase())} /></Field>
            <Field label="Middle Name"><input className="form-control" value={formData.middle_name} onChange={(event) => update('middle_name', event.target.value.toUpperCase())} /></Field>
            <div className="grid-2"><Field label="Date of Birth *"><input type="date" className="form-control" required value={formData.birth_date} onChange={(event) => update('birth_date', event.target.value)} /></Field><Field label="Place of Birth *"><input className="form-control" required value={formData.birth_place} onChange={(event) => update('birth_place', event.target.value.toUpperCase())} /></Field></div>
          </SectionCard>

          <SectionCard icon={<ShieldCheck size={16} />} title="Demographics & Civil Status">
            <div className="grid-2"><Field label="Gender *"><select className="form-select" value={formData.gender} onChange={(event) => update('gender', event.target.value)}><option>Male</option><option>Female</option></select></Field><Field label="Civil Status"><select className="form-select" value={formData.civil_status} onChange={(event) => update('civil_status', event.target.value)}><option>Single</option><option>Married</option><option>Widowed</option><option>Separated</option></select></Field></div>
            <div className="grid-2"><Field label="Religion"><select className="form-select" value={formData.religion} onChange={(event) => update('religion', event.target.value)}><option>Roman Catholic</option><option>Seventh-day Adventist</option><option>Iglesia ni Cristo</option><option>Baptist</option><option>Islam</option><option>Born Again Christian</option><option>Other</option></select></Field><Field label="Citizenship"><input className="form-control" value={formData.citizenship} onChange={(event) => update('citizenship', event.target.value)} /></Field></div>
            <div className="form-group"><label className="form-label">Languages Spoken</label><div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px' }}>{[['lang_english', 'English'], ['lang_filipino', 'Filipino'], ['lang_cebuano', 'Cebuano']].map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(formData[key])} onChange={(event) => update(key, event.target.checked)} /> {label}</label>)}<input className="form-control" style={{ width: '160px' }} placeholder="Other dialect" value={formData.lang_others} onChange={(event) => update('lang_others', event.target.value)} /></div></div>
          </SectionCard>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <SectionCard icon={<MapPin size={16} />} title="Address Information">
            <Field label="House#/Street Name & Barangay"><textarea className="form-control" rows={2} value={formData.address || formData.permanent_address || formData.current_address || ''} onChange={(event) => setFormData((previous) => ({ ...previous, address: event.target.value, permanent_address: event.target.value, current_address: event.target.value }))} /></Field>
            <div className="grid-2"><Field label="Region"><select className="form-select" value={formData.region_code || ''} onChange={(event) => onRegionChange(event.target.value)} disabled={loadingLocations}><option value="">-- Select Region --</option>{regionsList.map((region) => <option key={region.code} value={region.code}>{region.displayName || region.name}</option>)}</select></Field><Field label="Province"><select className="form-select" value={formData.province_code || ''} onChange={(event) => onProvinceChange(event.target.value)} disabled={!hasRegion}><option value="">{hasRegion ? '-- Select Province --' : '-- Select Region First --'}</option>{provincesList.map((province) => <option key={province.code} value={province.code}>{province.name}</option>)}</select></Field></div>
            <Field label="City / Municipality"><select className="form-select" value={formData.municipality_code || ''} onChange={(event) => onMunicipalityChange(event.target.value)} disabled={!hasRegion || (provincesList.length > 0 && !hasProvince)}><option value="">{!hasRegion ? '-- Select Region First --' : provincesList.length > 0 && !hasProvince ? '-- Select Province First --' : '-- Select City / Municipality --'}</option>{citiesList.map((city) => <option key={city.code} value={city.code}>{city.name}</option>)}</select></Field>
          </SectionCard>

          <SectionCard icon={<Phone size={16} />} title="Communication & Security">
            <PhoneInput id="mobile_number" floatingLabel="Mobile Number" required value={formData.mobile_number} onChange={(event) => update('mobile_number', event.target.value)} />
            <Field label="Telephone / Landline"><input className="form-control" value={formData.telephone} onChange={(event) => update('telephone', event.target.value)} /></Field>
            <Field label="Personal Email Address"><input type="email" className="form-control" value={formData.email} onChange={(event) => update('email', event.target.value)} /></Field>
            <PasswordInput id="password" floatingLabel="Account Password" required value={formData.password} onChange={(event) => update('password', event.target.value)} showStrength />
          </SectionCard>
        </div>
      </div>

      <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', padding: '16px 20px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)' }}><button type="button" className="btn btn-outline" onClick={onCancel}>Cancel &amp; Return</button><div style={{ display: 'flex', gap: '10px' }}><button type="button" className="btn btn-secondary" disabled={submitting} onClick={(event) => onSaveOnly(event)}>Save Profile Only</button><button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Registering...' : 'Save & Proceed to Face Biometrics ➔'}</button></div></div>
    </form>
  );
}

function SectionCard({ icon, title, children }) { return <div className="card"><div className="card-header" style={{ borderBottom: '1px solid var(--border)' }}><span className="card-title" style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>{icon} {title}</span></div><div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>{children}</div></div>; }
function Field({ label, children }) {
  const generatedId = useId();
  const child = React.isValidElement(children)
    ? React.cloneElement(children, { id: children.props.id || generatedId })
    : children;
  return <div className="form-group"><label className="form-label" htmlFor={React.isValidElement(children) ? (children.props.id || generatedId) : undefined}>{label}</label>{child}</div>;
}
