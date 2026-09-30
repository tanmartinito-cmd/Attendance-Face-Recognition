import React, { useState, useEffect } from 'react';
import { Calendar, X, Trash2, Edit2 } from 'lucide-react';
import { Api } from '../api';
import { formatTime12h, formatSchoolScheduleParts } from '../utils/time';
import ActionPopover from '../components/shared/ActionPopover';
import Toast from '../components/shared/Toast';
import { confirmAction, TableLoadingRow, ModalBackdrop, usePageLoading } from '../ui';

export default function SchedulesView({ user, onSetHeaderInfo }) {
  const [schedules, setSchedules] = useState([]);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = usePageLoading(() => loadData());
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState({
    section: '',
    subject: '',
    day_of_week: 'Mon',
    day_2: '',
    start_time: '08:00',
    end_time: '09:30',
    room: '',
    effective_from: '',
    effective_to: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Edit Schedule State
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [editFormData, setEditFormData] = useState({
    section: '',
    subject: '',
    day_of_week: 'Mon',
    day_2: '',
    start_time: '08:00',
    end_time: '09:30',
    room: '',
    effective_from: '',
    effective_to: '',
  });
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editErrorMsg, setEditErrorMsg] = useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      const [schList, secList] = await Promise.all([
        Api.getSchedules(),
        Api.getSections(),
      ]);
      setSchedules(schList);
      setSections(secList);
    } catch (err) {
      console.error('Failed to load schedules:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (onSetHeaderInfo) {
      onSetHeaderInfo({
        title: 'Schedules',
        subtitle: 'All class meeting schedules and their effective date windows',
        headerActions: isAdmin ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowAddModal(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <span>Add Schedule</span>
          </button>
        ) : null,
      });
    }
  }, [isAdmin, onSetHeaderInfo]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.section || !formData.start_time || !formData.end_time || !formData.room) {
      setErrorMsg('Section, start time, end time, and room are required.');
      return;
    }

    try {
      setSubmitting(true);
      setErrorMsg('');
      const payload = {
        section: formData.section,
        subject: formData.subject || null,
        day_of_week: formData.day_of_week,
        day_2: formData.day_2 || null,
        start_time: formData.start_time,
        end_time: formData.end_time,
        room: formData.room,
        effective_from: formData.effective_from || null,
        effective_to: formData.effective_to || null,
      };
      await Api.createSchedule(payload);
      setSuccessMsg('Class schedule created successfully!');
      setShowAddModal(false);
      setFormData({
        section: '',
        subject: '',
        day_of_week: 'Mon',
        day_2: '',
        start_time: '08:00',
        end_time: '09:30',
        room: '',
        effective_from: '',
        effective_to: '',
      });
      await loadData();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to create schedule. Possible conflict with another class.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id, sectionName) => {
    if (!(await confirmAction({ title: 'Delete this schedule?', message: `The class schedule for ${sectionName} will be removed from the timetable. Past attendance records are kept.`, confirmLabel: 'Delete schedule', tone: 'danger' }))) return;
    try {
      await Api.deleteSchedule(id);
      setSuccessMsg('Schedule deleted successfully.');
      loadData();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to delete schedule.');
    }
  };

  const handleOpenEditModal = (sch) => {
    setEditingSchedule(sch);
    setEditErrorMsg('');
    setEditFormData({
      section: sch.section || '',
      subject: sch.subject || '',
      day_of_week: sch.day_of_week || 'Mon',
      day_2: sch.day_2 || '',
      start_time: sch.start_time ? sch.start_time.slice(0, 5) : '08:00',
      end_time: sch.end_time ? sch.end_time.slice(0, 5) : '09:30',
      room: sch.room || '',
      effective_from: sch.effective_from || '',
      effective_to: sch.effective_to || '',
    });
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editingSchedule) return;
    if (!editFormData.section || !editFormData.start_time || !editFormData.end_time || !editFormData.room) {
      setEditErrorMsg('Section, start time, end time, and room are required.');
      return;
    }

    try {
      setEditSubmitting(true);
      setEditErrorMsg('');
      const payload = {
        section: editFormData.section,
        subject: editFormData.subject || null,
        day_of_week: editFormData.day_of_week,
        day_2: editFormData.day_2 || null,
        start_time: editFormData.start_time,
        end_time: editFormData.end_time,
        room: editFormData.room,
        effective_from: editFormData.effective_from || null,
        effective_to: editFormData.effective_to || null,
      };
      await Api.updateSchedule(editingSchedule.id, payload);
      setSuccessMsg('Class schedule updated successfully!');
      setEditingSchedule(null);
      await loadData();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setEditErrorMsg(err.message || 'Failed to update schedule. Possible conflict with another class.');
    } finally {
      setEditSubmitting(false);
    }
  };

  return (
    <div className="page-content">
      <Toast message={successMsg} type="success" onClose={() => setSuccessMsg('')} />
      <Toast message={errorMsg} type="error" onClose={() => setErrorMsg('')} />

      <div className="card" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <div className="table-container" style={{ border: 'none', margin: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Section</th>
                <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Subject</th>
                <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Instructor</th>
                <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Day</th>
                <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Time</th>
                <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Room</th>
                <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Effective Period</th>
                {isAdmin && <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableLoadingRow colSpan={isAdmin ? 8 : 7} label="Loading schedules…" />
              ) : schedules.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 8 : 7} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No schedules yet.{' '}
                    {isAdmin && (
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => setShowAddModal(true)}
                        style={{ color: 'var(--primary)', cursor: 'pointer', background: 'none', border: 'none', textDecoration: 'underline' }}
                      >
                        Add one
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                schedules.map((sch) => {
                  const schParts = formatSchoolScheduleParts(sch);
                  const displayTime = schParts.time || formatTime12h(
                    sch.time_display || (sch.start_time && sch.end_time ? `${sch.start_time} - ${sch.end_time}` : '')
                  );
                  return (
                    <tr key={sch.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '14px 18px' }}>
                        <strong>{sch.section_name}</strong>
                      </td>
                      <td style={{ padding: '14px 18px' }}>
                        <span className="badge badge-accent" style={{ fontSize: '12px', fontWeight: '700' }}>
                          {sch.subject_code || '—'}
                        </span>
                      </td>
                      <td style={{ padding: '14px 18px', color: 'var(--text-muted)', fontSize: '13px' }}>
                        {sch.instructor_name || '—'}
                      </td>
                      <td style={{ padding: '14px 18px', fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>
                        {schParts.days || sch.days_display || sch.day_display}
                      </td>
                      <td style={{ padding: '14px 18px', fontSize: '11.5px', fontWeight: '600' }}>
                        {displayTime && displayTime.includes('/') ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                            <span style={{ whiteSpace: 'nowrap' }}>{displayTime.split('/')[0]}</span>
                            <span style={{ whiteSpace: 'nowrap' }}>/{displayTime.split('/')[1]}</span>
                          </div>
                        ) : (
                          <span style={{ whiteSpace: 'nowrap' }}>{displayTime}</span>
                        )}
                      </td>
                      <td style={{ padding: '14px 18px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                        {sch.room || '—'}
                      </td>
                      <td style={{ padding: '14px 18px' }}>
                        {sch.effective_from || sch.effective_to ? (
                          <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                            {sch.effective_from || 'Any'} &rarr; {sch.effective_to || 'Ongoing'}
                          </span>
                        ) : (
                          <span className="text-muted" style={{ fontSize: '12px' }}>
                            No restriction
                          </span>
                        )}
                      </td>
                      {isAdmin && (
                        <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                          <ActionPopover
                            items={[
                              {
                                label: 'Edit Schedule',
                                icon: Edit2,
                                onClick: () => handleOpenEditModal(sch),
                              },
                              { isDivider: true },
                              {
                                label: 'Delete Schedule',
                                icon: Trash2,
                                isDanger: true,
                                onClick: () => handleDelete(sch.id, sch.section_name),
                              },
                            ]}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Schedule Modal */}
      {showAddModal && (
        <ModalBackdrop onClose={() => setShowAddModal(false)} busy={submitting}>
          <div className="modal-card modal-lg" style={{ width: '100%', maxWidth: '580px', background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden', border: '1px solid var(--border)' }}>
            <div className="modal-header" style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 className="modal-title" style={{ fontSize: '16px', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Calendar size={18} style={{ color: 'var(--primary)' }} />
                <span>Add Class Schedule</span>
              </h3>
              <button
                type="button"
                className="btn btn-icon btn-outline btn-sm modal-close-btn"
                onClick={() => setShowAddModal(false)}
                style={{ padding: '4px', border: 'none', background: 'none', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="modal-body" style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {errorMsg && (
                  <div className="alert alert-danger" style={{ fontSize: '13px', padding: '10px 14px' }}>
                    {errorMsg}
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                    Class Section *
                  </label>
                  <select
                    className="form-select"
                    value={formData.section}
                    onChange={(e) => setFormData({ ...formData, section: e.target.value })}
                    required
                  >
                    <option value="">Select section...</option>
                    {sections.map((s) => {
                      const subj = s.effective_subject_code || s.subject_details?.code || '';
                      const instructor = (s.subjects || []).map((subject) => subject.instructor_details?.user ? `${subject.instructor_details.user.first_name} ${subject.instructor_details.user.last_name || ''}`.trim() : '').filter(Boolean).filter((name, index, names) => names.indexOf(name) === index).join(', ');
                      const extra = [subj, instructor].filter(Boolean).join(' • ');
                      return (
                        <option key={s.id} value={s.id}>
                          {s.name} {extra ? `(${extra})` : `(${s.school_year} - ${s.semester})`}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Course Subject Selection (Dedicated to this section) */}
                {(() => {
                  const selectedSec = sections.find((s) => String(s.id) === String(formData.section));
                  const secSubjects = selectedSec?.subjects || (selectedSec?.subject_details ? [selectedSec.subject_details] : []);
                  return (
                    <div className="form-group">
                      <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                        Course Subject Offering *
                      </label>
                      <select
                        className="form-select"
                        value={formData.subject}
                        onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                        required
                        disabled={!formData.section}
                      >
                        <option value="">{formData.section ? 'Select course subject...' : 'Choose a section first...'}</option>
                        {secSubjects.map((sub) => {
                          const tName = sub.instructor_details?.user
                            ? `${sub.instructor_details.user.first_name} ${sub.instructor_details.user.last_name}`
                            : 'Unassigned';
                          return (
                            <option key={sub.id} value={sub.id}>
                              {sub.code} - {sub.name} (Instructor: {tName})
                            </option>
                          );
                        })}
                      </select>
                      {secSubjects.length === 0 && formData.section && (
                        <span className="form-text" style={{ fontSize: '11px', color: 'var(--warning)', display: 'block', marginTop: '4px' }}>
                          No subjects found in this section. Add subjects in Subjects view first.
                        </span>
                      )}
                    </div>
                  );
                })()}

                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                      Day 1 *
                    </label>
                    <select
                      className="form-select"
                      value={formData.day_of_week}
                      onChange={(e) => setFormData({ ...formData, day_of_week: e.target.value })}
                      required
                    >
                      <option value="Mon">Monday</option>
                      <option value="Tue">Tuesday</option>
                      <option value="Wed">Wednesday</option>
                      <option value="Thu">Thursday</option>
                      <option value="Fri">Friday</option>
                      <option value="Sat">Saturday</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                      Day 2 (Optional for 2-day meetings)
                    </label>
                    <select
                      className="form-select"
                      value={formData.day_2}
                      onChange={(e) => setFormData({ ...formData, day_2: e.target.value })}
                    >
                      <option value="">None (Single-day meeting)</option>
                      <option value="Mon">Monday</option>
                      <option value="Tue">Tuesday</option>
                      <option value="Wed">Wednesday</option>
                      <option value="Thu">Thursday</option>
                      <option value="Fri">Friday</option>
                      <option value="Sat">Saturday</option>
                    </select>
                  </div>
                </div>

                <div className="grid-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: '12px' }}>
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                      Start Time *
                    </label>
                    <input
                      type="time"
                      className="form-control"
                      value={formData.start_time}
                      onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                      End Time *
                    </label>
                    <input
                      type="time"
                      className="form-control"
                      value={formData.end_time}
                      onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                      Room / Lab *
                    </label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="e.g. 226, LAB-7"
                      value={formData.room}
                      onChange={(e) => setFormData({ ...formData, room: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                      Effective From (Optional)
                    </label>
                    <input
                      type="date"
                      className="form-control"
                      value={formData.effective_from}
                      onChange={(e) => setFormData({ ...formData, effective_from: e.target.value })}
                    />
                    <span className="form-text" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Leave blank if no start constraint</span>
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                      Effective To (Optional)
                    </label>
                    <input
                      type="date"
                      className="form-control"
                      value={formData.effective_to}
                      onChange={(e) => setFormData({ ...formData, effective_to: e.target.value })}
                    />
                    <span className="form-text" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Leave blank if ongoing schedule</span>
                  </div>
                </div>
              </div>

              <div className="modal-footer" style={{ padding: '14px 22px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="btn btn-outline" data-modal-close onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  <span>{submitting ? 'Creating...' : 'Create Schedule'}</span>
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}

      {/* Edit Schedule Modal */}
      {editingSchedule && (
        <ModalBackdrop onClose={() => setEditingSchedule(null)} busy={editSubmitting}>
          <div className="modal-card modal-lg" style={{ width: '100%', maxWidth: '580px', background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden', border: '1px solid var(--border)' }}>
            <div className="modal-header" style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 className="modal-title" style={{ fontSize: '16px', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Edit2 size={18} style={{ color: 'var(--primary)' }} />
                <span>Edit Class Schedule</span>
              </h3>
              <button
                type="button"
                className="btn btn-icon btn-outline btn-sm modal-close-btn"
                onClick={() => setEditingSchedule(null)}
                style={{ padding: '4px', border: 'none', background: 'none', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit}>
              <div className="modal-body" style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {editErrorMsg && (
                  <div className="alert alert-danger" style={{ fontSize: '13px', padding: '10px 14px' }}>
                    {editErrorMsg}
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                    Class Section *
                  </label>
                  <select
                    className="form-select"
                    value={editFormData.section}
                    onChange={(e) => setEditFormData({ ...editFormData, section: e.target.value })}
                    required
                  >
                    <option value="">Select section...</option>
                    {sections.map((s) => {
                      const subj = s.effective_subject_code || s.subject_details?.code || '';
                      const instructor = (s.subjects || []).map((subject) => subject.instructor_details?.user ? `${subject.instructor_details.user.first_name} ${subject.instructor_details.user.last_name || ''}`.trim() : '').filter(Boolean).filter((name, index, names) => names.indexOf(name) === index).join(', ');
                      const extra = [subj, instructor].filter(Boolean).join(' • ');
                      return (
                        <option key={s.id} value={s.id}>
                          {s.name} {extra ? `(${extra})` : `(${s.school_year} - ${s.semester})`}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Course Subject Selection (Dedicated to this section) */}
                {(() => {
                  const selectedSec = sections.find((s) => String(s.id) === String(editFormData.section));
                  const secSubjects = selectedSec?.subjects || (selectedSec?.subject_details ? [selectedSec.subject_details] : []);
                  return (
                    <div className="form-group">
                      <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                        Course Subject Offering *
                      </label>
                      <select
                        className="form-select"
                        value={editFormData.subject}
                        onChange={(e) => setEditFormData({ ...editFormData, subject: e.target.value })}
                        required
                        disabled={!editFormData.section}
                      >
                        <option value="">{editFormData.section ? 'Select course subject...' : 'Choose a section first...'}</option>
                        {secSubjects.map((sub) => {
                          const tName = sub.instructor_details?.user
                            ? `${sub.instructor_details.user.first_name} ${sub.instructor_details.user.last_name}`
                            : 'Unassigned';
                          return (
                            <option key={sub.id} value={sub.id}>
                              {sub.code} - {sub.name} (Instructor: {tName})
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  );
                })()}

                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                      Day 1 *
                    </label>
                    <select
                      className="form-select"
                      value={editFormData.day_of_week}
                      onChange={(e) => setEditFormData({ ...editFormData, day_of_week: e.target.value })}
                      required
                    >
                      <option value="Mon">Monday</option>
                      <option value="Tue">Tuesday</option>
                      <option value="Wed">Wednesday</option>
                      <option value="Thu">Thursday</option>
                      <option value="Fri">Friday</option>
                      <option value="Sat">Saturday</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                      Day 2 (Optional for 2-day meetings)
                    </label>
                    <select
                      className="form-select"
                      value={editFormData.day_2}
                      onChange={(e) => setEditFormData({ ...editFormData, day_2: e.target.value })}
                    >
                      <option value="">None (Single-day meeting)</option>
                      <option value="Mon">Monday</option>
                      <option value="Tue">Tuesday</option>
                      <option value="Wed">Wednesday</option>
                      <option value="Thu">Thursday</option>
                      <option value="Fri">Friday</option>
                      <option value="Sat">Saturday</option>
                    </select>
                  </div>
                </div>

                {/* Quick Pattern Buttons */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Quick patterns:</span>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                    onClick={() => setEditFormData({ ...editFormData, day_of_week: 'Mon', day_2: 'Wed' })}
                  >
                    M – W
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                    onClick={() => setEditFormData({ ...editFormData, day_of_week: 'Tue', day_2: 'Thu' })}
                  >
                    T – TH
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                    onClick={() => setEditFormData({ ...editFormData, day_of_week: 'Mon', day_2: 'Fri' })}
                  >
                    M – F
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                    onClick={() => setEditFormData({ ...editFormData, day_of_week: 'Sat', day_2: '' })}
                  >
                    Sat only
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                    onClick={() => setEditFormData({ ...editFormData, day_of_week: 'Mon', day_2: '' })}
                  >
                    Mon only
                  </button>
                </div>

                <div className="grid-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: '12px' }}>
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                      Start Time *
                    </label>
                    <input
                      type="time"
                      className="form-control"
                      value={editFormData.start_time}
                      onChange={(e) => setEditFormData({ ...editFormData, start_time: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                      End Time *
                    </label>
                    <input
                      type="time"
                      className="form-control"
                      value={editFormData.end_time}
                      onChange={(e) => setEditFormData({ ...editFormData, end_time: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                      Room / Lab *
                    </label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="e.g. 226, LAB-7"
                      value={editFormData.room}
                      onChange={(e) => setEditFormData({ ...editFormData, room: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                      Effective From (Optional)
                    </label>
                    <input
                      type="date"
                      className="form-control"
                      value={editFormData.effective_from}
                      onChange={(e) => setEditFormData({ ...editFormData, effective_from: e.target.value })}
                    />
                    <span className="form-text" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Leave blank if no start constraint</span>
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                      Effective To (Optional)
                    </label>
                    <input
                      type="date"
                      className="form-control"
                      value={editFormData.effective_to}
                      onChange={(e) => setEditFormData({ ...editFormData, effective_to: e.target.value })}
                    />
                    <span className="form-text" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Leave blank if ongoing schedule</span>
                  </div>
                </div>
              </div>

              <div className="modal-footer" style={{ padding: '14px 22px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="btn btn-outline" data-modal-close onClick={() => setEditingSchedule(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={editSubmitting}>
                  <span>{editSubmitting ? 'Updating...' : 'Update Schedule'}</span>
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}
    </div>
  );
}
