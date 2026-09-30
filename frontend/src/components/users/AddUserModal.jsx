import React from 'react';
import { Shield, X, Check, AlertCircle } from 'lucide-react';
import PasswordInput from '../shared/PasswordInput';
import PhoneInput from '../shared/PhoneInput';
import { ModalBackdrop } from '../../ui';

/**
 * AddUserModal — Modal form for creating a new Staff/Faculty account.
 *
 * Props:
 * - isOpen: boolean
 * - onClose: () => void
 * - onSubmit: (e) => void  (form submit handler, owns validation + API call)
 * - formData / setFormData: controlled form state from parent
 * - programs: array of { id, code, name } for department dropdown
 * - submitting: boolean
 * - errorMsg: string
 */
export default function AddUserModal({
  isOpen,
  onClose,
  onSubmit,
  formData,
  setFormData,
  programs = [],
  submitting = false,
  errorMsg = '',
}) {
  if (!isOpen) return null;

  return (
    <ModalBackdrop onClose={onClose} busy={submitting}>
      <div className="modal-card" style={{ maxWidth: '640px', width: '100%', borderRadius: 'var(--radius-lg)', background: 'var(--bg-card)', border: '1px solid var(--border)', overflow: 'hidden', boxShadow: 'var(--shadow-lg)' }}>
        <div className="modal-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Shield size={18} color="var(--accent)" />
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '700' }}>Add Staff / Faculty Account</h3>
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
              {formData.role === 'admin' ? (
                <div className="form-group">
                  <label className="form-label">Username *</label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    placeholder="e.g. jdoe"
                    required
                  />
                </div>
              ) : (
                <div className="form-group">
                  <label className="form-label">Username</label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.faculty_id?.trim() || 'Auto (FAC-0001…)'}
                    disabled
                    aria-describedby="username-is-faculty-id"
                  />
                  <div id="username-is-faculty-id" className="text-muted" style={{ fontSize: '12px', marginTop: '4px' }}>
                    Faculty sign in with their Faculty ID.
                  </div>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Role *</label>
                <select
                  className="form-select"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                >
                  <option value="instructor">Instructor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">First Name *</label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.first_name}
                  onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                  placeholder="First Name"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Last Name *</label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.last_name}
                  onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                  placeholder="Last Name"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Email *</label>
                <input
                  type="email"
                  className="form-control"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="e.g. jdoe@attendfr.edu"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Phone</label>
                <PhoneInput
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="e.g. 09123456789"
                />
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Password *</label>
                <PasswordInput
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Create secure password"
                  required
                  showStrength={true}
                />
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Confirm Password *</label>
                <PasswordInput
                  value={formData.confirm_password}
                  onChange={(e) => setFormData({ ...formData, confirm_password: e.target.value })}
                  placeholder="Confirm your password"
                  required
                  showStrength={false}
                />
                {formData.confirm_password && (
                  <div
                    style={{
                      marginTop: '6px',
                      fontSize: '11.5px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      color: formData.password === formData.confirm_password ? '#16a34a' : '#dc2626',
                      fontWeight: '600',
                    }}
                  >
                    {formData.password === formData.confirm_password ? (
                      <>
                        <Check size={13} style={{ strokeWidth: 2.5 }} />
                        <span>Passwords match</span>
                      </>
                    ) : (
                      <>
                        <X size={13} style={{ strokeWidth: 2.5 }} />
                        <span>Passwords do not match</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Faculty Profile with Department DROPDOWN */}
            {formData.role === 'instructor' && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px', marginTop: '8px' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-secondary)' }}>
                  Faculty Profile
                </h4>
                <div className="grid-2" style={{ gap: '14px' }}>
                  <div className="form-group">
                    <label className="form-label">Faculty ID (login username)</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formData.faculty_id}
                      onChange={(e) => setFormData({ ...formData, faculty_id: e.target.value })}
                      placeholder="Leave blank to auto-assign (FAC-0001…)"
                    />
                  </div>

                  {/* Dynamic Department Dropdown populated with Program entities */}
                  <div className="form-group">
                    <label className="form-label">Department / Program *</label>
                    <select
                      className="form-select"
                      value={formData.department}
                      onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                      required
                    >
                      <option value="">Select Program / Department</option>
                      {programs.map((p) => (
                        <option key={p.id || p.code} value={p.name || p.code}>
                          {p.code} - {p.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label className="form-label">Specialization</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formData.specialization}
                      onChange={(e) => setFormData({ ...formData, specialization: e.target.value })}
                      placeholder="e.g. Software Engineering, AI & Robotics"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="modal-footer" style={{ padding: '14px 20px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button type="button" className="btn btn-outline" data-modal-close onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting} data-loading={submitting ? 'true' : undefined}>
              {submitting ? 'Creating account…' : 'Create account'}
            </button>
          </div>
        </form>
      </div>
    </ModalBackdrop>
  );
}
