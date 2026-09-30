import React from 'react';
import { Edit2, X, AlertCircle } from 'lucide-react';
import PasswordInput from '../shared/PasswordInput';
import PhoneInput from '../shared/PhoneInput';
import { ModalBackdrop } from '../../ui';

/**
 * EditUserModal — Modal form for editing an existing user account.
 * Renders role-specific sections (Faculty Details / Student Academic Profile).
 *
 * Props:
 * - isOpen: boolean
 * - user: the user object being edited (for role + username display)
 * - onClose: () => void
 * - onSubmit: (e) => void
 * - formData / setFormData: controlled form state from parent
 * - programs: array of { id, code, name }
 * - submitting: boolean
 * - errorMsg: string
 */
export default function EditUserModal({
  isOpen,
  user,
  onClose,
  onSubmit,
  formData,
  setFormData,
  programs = [],
  courses = [],
  submitting = false,
  errorMsg = '',
}) {
  if (!isOpen || !user) return null;

  return (
    <ModalBackdrop onClose={onClose} busy={submitting}>
      <div className="modal-card" style={{ maxWidth: '640px', width: '100%', borderRadius: 'var(--radius-lg)', background: 'var(--bg-card)', border: '1px solid var(--border)', overflow: 'hidden', boxShadow: 'var(--shadow-lg)' }}>
        <div className="modal-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Edit2 size={18} color="var(--primary)" />
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '700' }}>
              Edit User: <code style={{ color: 'var(--primary)' }}>@{user.username}</code>
            </h3>
          </div>
          <button type="button" className="modal-close-btn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={onSubmit}>
          <div className="modal-body" style={{ padding: '20px', maxHeight: '70vh', overflowY: 'auto' }}>
            {errorMsg && (
              <div className="alert alert-danger" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', fontSize: '13px' }}>
                <AlertCircle size={15} />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="grid-2" style={{ gap: '14px', marginBottom: '14px' }}>
              <div className="form-group">
                <label className="form-label">First Name</label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.first_name}
                  onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Last Name</label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.last_name}
                  onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                />
              </div>
            </div>

            <div className="grid-2" style={{ gap: '14px', marginBottom: '14px' }}>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input
                  type="email"
                  className="form-control"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <PhoneInput
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
            </div>

            <div className="grid-2" style={{ gap: '14px', marginBottom: '14px' }}>
              <div className="form-group">
                <label className="form-label">Account Status</label>
                <select
                  className="form-select"
                  value={formData.is_active ? 'active' : 'inactive'}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.value === 'active' })}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive / Suspended</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">New Password (optional)</label>
                <PasswordInput
                  placeholder="Leave blank to keep unchanged"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  showStrength={true}
                />
                <small style={{ display: 'block', marginTop: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                  Leave blank to keep existing password. Passwords are encrypted and never displayed.
                </small>
              </div>
            </div>

            {user.role === 'instructor' && (
              <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: '13px', fontWeight: '700', marginBottom: '12px', color: 'var(--text-primary)' }}>
                  Faculty Details
                </div>
                <div className="grid-2" style={{ gap: '14px' }}>
                  <div className="form-group">
                    <label className="form-label">Faculty ID</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formData.faculty_id}
                      onChange={(e) => setFormData({ ...formData, faculty_id: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Title</label>
                    <select
                      className="form-select"
                      value={formData.title || ''}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    >
                      <option value="">No Title</option>
                      <option value="Prof.">Prof. (Professor)</option>
                      <option value="Assoc. Prof.">Assoc. Prof.</option>
                      <option value="Asst. Prof.">Asst. Prof.</option>
                      <option value="Dr.">Dr. (Doctor)</option>
                      <option value="Engr.">Engr. (Engineer)</option>
                      <option value="Atty.">Atty. (Attorney)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Position / Rank</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="e.g., Assistant Professor, Instructor"
                      value={formData.position || ''}
                      onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Employment Status</label>
                    <select
                      className="form-select"
                      value={formData.employment_status || 'Regular'}
                      onChange={(e) => setFormData({ ...formData, employment_status: e.target.value })}
                    >
                      <option value="Regular">Regular</option>
                      <option value="Part-time">Part-time</option>
                      <option value="Contractual">Contractual</option>
                      <option value="Probationary">Probationary</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Department / Program</label>
                    <select
                      className="form-select"
                      value={formData.department}
                      onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    >
                      <option value="">Select Department</option>
                      {programs.map((p) => (
                        <option key={p.id || p.code} value={p.name || p.code}>
                          {p.code} - {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Specialization</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formData.specialization}
                      onChange={(e) => setFormData({ ...formData, specialization: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Date Hired</label>
                    <input
                      type="date"
                      className="form-control"
                      value={formData.date_hired || ''}
                      onChange={(e) => setFormData({ ...formData, date_hired: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Contact Number</label>
                    <PhoneInput
                      value={formData.contact_number || ''}
                      onChange={(e) => setFormData({ ...formData, contact_number: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label className="form-label">Office Location</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="e.g., Room 301, Engineering Building"
                      value={formData.office_location || ''}
                      onChange={(e) => setFormData({ ...formData, office_location: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label className="form-label">Consultation Hours</label>
                    <textarea
                      className="form-control"
                      rows={2}
                      placeholder="e.g., Mon-Fri 2:00 PM - 4:00 PM"
                      value={formData.consultation_hours || ''}
                      onChange={(e) => setFormData({ ...formData, consultation_hours: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label className="form-label">Education Background</label>
                    <textarea
                      className="form-control"
                      rows={2}
                      placeholder="Highest educational attainment and degrees"
                      value={formData.education_background || ''}
                      onChange={(e) => setFormData({ ...formData, education_background: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label className="form-label">Certifications & Licenses</label>
                    <textarea
                      className="form-control"
                      rows={2}
                      placeholder="Professional certifications and licenses"
                      value={formData.certifications || ''}
                      onChange={(e) => setFormData({ ...formData, certifications: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            )}

            {user.role === 'student' && (
              <>
                <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', marginBottom: '12px', color: 'var(--text-primary)' }}>
                    Student Academic Profile
                  </div>
                  <div className="grid-2" style={{ gap: '14px' }}>
                    <div className="form-group">
                      <label className="form-label">Student ID *</label>
                      <input
                        type="text"
                        className="form-control"
                        value={formData.student_id}
                        onChange={(e) => setFormData({ ...formData, student_id: e.target.value })}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Year Level</label>
                      <select
                        className="form-select"
                        value={formData.year_level}
                        onChange={(e) => setFormData({ ...formData, year_level: Number(e.target.value) })}
                      >
                        <option value={1}>1st Year</option>
                        <option value={2}>2nd Year</option>
                        <option value={3}>3rd Year</option>
                        <option value={4}>4th Year</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Academic Program</label>
                      <select
                        className="form-select"
                        value={formData.program_id || ''}
                        onChange={(e) => {
                          const programId = e.target.value;
                          const program = programs.find((item) => String(item.id) === String(programId));
                          const firstCourse = courses.find((item) => String(item.program) === String(programId));
                          setFormData({ ...formData, program_id: programId, program: program?.code || '', course_ref: firstCourse?.id || '', course: firstCourse?.code || '' });
                        }}
                        required
                      >
                        <option value="">Select Program</option>
                        {programs.map((program) => <option key={program.id} value={program.id}>{program.code} - {program.name}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Degree Course *</label>
                      <select
                        className="form-select"
                        value={formData.course_ref || ''}
                        onChange={(e) => {
                          const course = courses.find((item) => String(item.id) === String(e.target.value));
                          setFormData({ ...formData, course_ref: e.target.value, course: course?.code || '' });
                        }}
                        required
                      >
                        <option value="">Select Course</option>
                        {courses.filter((course) => !formData.program_id || String(course.program) === String(formData.program_id)).map((course) => <option key={course.id} value={course.id}>{course.code} - {course.name}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', marginBottom: '12px', color: 'var(--text-primary)' }}>
                    Personal Details
                  </div>
                  <div className="form-group">
                    <label className="form-label">Middle Name</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formData.middle_name || ''}
                      onChange={(e) => setFormData({ ...formData, middle_name: e.target.value })}
                    />
                  </div>
                  <div className="grid-2" style={{ gap: '14px' }}>
                    <div className="form-group">
                      <label className="form-label">Date of Birth</label>
                      <input
                        type="date"
                        className="form-control"
                        value={formData.birth_date || ''}
                        onChange={(e) => setFormData({ ...formData, birth_date: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Place of Birth</label>
                      <input
                        type="text"
                        className="form-control"
                        value={formData.birth_place || ''}
                        onChange={(e) => setFormData({ ...formData, birth_place: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid-2" style={{ gap: '14px' }}>
                    <div className="form-group">
                      <label className="form-label">Gender</label>
                      <select
                        className="form-select"
                        value={formData.gender || 'Male'}
                        onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                      >
                        <option>Male</option>
                        <option>Female</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Civil Status</label>
                      <select
                        className="form-select"
                        value={formData.civil_status || 'Single'}
                        onChange={(e) => setFormData({ ...formData, civil_status: e.target.value })}
                      >
                        <option>Single</option>
                        <option>Married</option>
                        <option>Widowed</option>
                        <option>Separated</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid-2" style={{ gap: '14px' }}>
                    <div className="form-group">
                      <label className="form-label">Religion</label>
                      <input
                        type="text"
                        className="form-control"
                        value={formData.religion || ''}
                        onChange={(e) => setFormData({ ...formData, religion: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Citizenship</label>
                      <input
                        type="text"
                        className="form-control"
                        value={formData.citizenship || ''}
                        onChange={(e) => setFormData({ ...formData, citizenship: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', marginBottom: '12px', color: 'var(--text-primary)' }}>
                    Address & Contact
                  </div>
                  <div className="form-group">
                    <label className="form-label">Current Address</label>
                    <textarea
                      className="form-control"
                      rows={2}
                      value={formData.current_address || ''}
                      onChange={(e) => setFormData({ ...formData, current_address: e.target.value })}
                    />
                  </div>
                  <div className="grid-2" style={{ gap: '14px' }}>
                    <div className="form-group">
                      <label className="form-label">Mobile Number</label>
                      <PhoneInput
                        value={formData.mobile_number || ''}
                        onChange={(e) => setFormData({ ...formData, mobile_number: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Telephone</label>
                      <input
                        type="text"
                        className="form-control"
                        value={formData.telephone || ''}
                        onChange={(e) => setFormData({ ...formData, telephone: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="modal-footer" style={{ padding: '14px 20px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button type="button" className="btn btn-outline" data-modal-close onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting} data-loading={submitting ? 'true' : undefined}>
              {submitting ? 'Saving changes…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </ModalBackdrop>
  );
}
