import React, { useState, useEffect } from 'react';
import { BookOpen, X, Trash2, Edit2, Filter, Power } from 'lucide-react';
import { Api } from '../api';
import ActionPopover from '../components/shared/ActionPopover';
import Toast from '../components/shared/Toast';
import { confirmAction, TableLoadingRow, StatusBadge, changeActiveStatus, ModalBackdrop, usePageLoading } from '../ui';

export default function SubjectsView({ user, onSetHeaderInfo }) {
  const [subjects, setSubjects] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [courses, setCourses] = useState([]);
  const [sections, setSections] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [loading, setLoading] = usePageLoading(() => loadData());
  const [showAddModal, setShowAddModal] = useState(false);

  // Dynamic Table Filters (Program -> Section -> Subject)
  const [filterProgram, setFilterProgram] = useState('');
  const [filterSection, setFilterSection] = useState('');
  const [filterSubject, setFilterSubject] = useState('');

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    units: 3,
    description: '',
    program: '',
    course_ref: '',
    section: '',
    instructor: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Edit subject state
  const [editingSubject, setEditingSubject] = useState(null);
  const [editFormData, setEditFormData] = useState({ code: '', name: '', units: 3, description: '', program: '', course_ref: '', section: '', instructor: '' });
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editErrorMsg, setEditErrorMsg] = useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      const [subjList, progList, courseList, secList, instructorList] = await Promise.all([
        Api.getSubjects(),
        Api.getPrograms(),
        Api.getCourses(),
        Api.getSections(),
        Api.getInstructors(),
      ]);
      setSubjects(subjList);
      setPrograms(progList);
      setCourses(courseList);
      setSections(secList);
      setInstructors(instructorList);
    } catch (err) {
      console.error('Failed to load subjects:', err);
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
        title: 'Subjects',
        subtitle: 'Academic course subjects and section assignments',
        headerActions: isAdmin ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowAddModal(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <span>Add Subject</span>
          </button>
        ) : null,
      });
    }
  }, [isAdmin, onSetHeaderInfo]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.code || !formData.name) {
      setErrorMsg('Subject code and name are required.');
      return;
    }

    try {
      setSubmitting(true);
      setErrorMsg('');
      const payload = {
        code: formData.code,
        name: formData.name,
        units: parseInt(formData.units, 10) || 3,
        description: formData.description || '',
        program: formData.program || null,
        course_ref: formData.course_ref ? Number(formData.course_ref) : null,
        section: formData.section || null,
        instructor: formData.instructor || null,
      };
      await Api.createSubject(payload);
      setSuccessMsg(`Subject "${formData.code}" created successfully!`);
      setShowAddModal(false);
      setFormData({ code: '', name: '', units: 3, description: '', program: '', course_ref: '', section: '', instructor: '' });
      await loadData();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to create subject offering.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id, code) => {
    if (!(await confirmAction({ title: `Delete subject ${code}?`, message: 'This subject offering and its schedule links will be removed. This cannot be undone.', confirmLabel: 'Delete subject', tone: 'danger' }))) return;
    try {
      await Api.deleteSubject(id);
      setSuccessMsg(`Subject ${code} deleted.`);
      loadData();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to delete subject.');
    }
  };

  const handleOpenEdit = (sub) => {
    setEditingSubject(sub);
    setEditErrorMsg('');
    setEditFormData({
      code: sub.code || '',
      name: sub.name || '',
      units: sub.units || 3,
      description: sub.description || '',
      program: sub.program || '',
      course_ref: sub.course_ref || sub.course_details?.id || '',
      section: sub.section || '',
      instructor: sub.instructor || '',
    });
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editFormData.code || !editFormData.name) {
      setEditErrorMsg('Subject code and name are required.');
      return;
    }
    try {
      setEditSubmitting(true);
      setEditErrorMsg('');
      await Api.updateSubject(editingSubject.id, {
        code: editFormData.code,
        name: editFormData.name,
        units: parseInt(editFormData.units, 10) || 3,
        description: editFormData.description || '',
        program: editFormData.program || null,
        course_ref: editFormData.course_ref ? Number(editFormData.course_ref) : null,
        section: editFormData.section || null,
        instructor: editFormData.instructor || null,
      });
      setSuccessMsg(`Subject "${editFormData.code}" updated successfully!`);
      setEditingSubject(null);
      await loadData();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setEditErrorMsg(err.message || 'Failed to update subject.');
    } finally {
      setEditSubmitting(false);
    }
  };

  // Handle Program filter selection: updates available sections and resets incompatible selection
  const handleProgramFilterChange = (progId) => {
    setFilterProgram(progId);
    if (progId && filterSection) {
      const secMatch = sections.find((s) => String(s.id) === String(filterSection));
      const secProgId = secMatch?.program || secMatch?.program_details?.id;
      if (String(secProgId) !== String(progId)) {
        setFilterSection('');
        setFilterSubject('');
      }
    }
    if (progId && filterSubject) {
      const subMatch = subjects.find((s) => String(s.id) === String(filterSubject));
      const subProgId = subMatch?.program || subMatch?.program_details?.id;
      if (subProgId && String(subProgId) !== String(progId)) {
        setFilterSubject('');
      }
    }
  };

  // Handle Section filter selection: updates available subjects and resets incompatible selection
  const handleSectionFilterChange = (secId) => {
    setFilterSection(secId);
    if (secId && filterSubject) {
      const subMatch = subjects.find((s) => String(s.id) === String(filterSubject));
      if (subMatch && String(subMatch.section) !== String(secId)) {
        setFilterSubject('');
      }
    }
    // If no program was chosen yet, auto-align with the section's program
    if (secId && !filterProgram) {
      const secMatch = sections.find((s) => String(s.id) === String(secId));
      const secProgId = secMatch?.program || secMatch?.program_details?.id;
      if (secProgId) setFilterProgram(String(secProgId));
    }
  };

  // Sections available under selected program (or all if none selected)
  const availableSections = filterProgram
    ? sections.filter((s) => {
        const pId = s.program || s.program_details?.id;
        return String(pId) === String(filterProgram);
      })
    : sections;

  // Subjects available under selected section or selected program
  const availableSubjects = filterSection
    ? subjects.filter((s) => String(s.section) === String(filterSection))
    : filterProgram
    ? subjects.filter((s) => {
        const subProg = s.program || s.program_details?.id;
        const matchedSec = sections.find((sec) => sec.id === s.section);
        const secProg = matchedSec?.program || matchedSec?.program_details?.id;
        return String(subProg) === String(filterProgram) || String(secProg) === String(filterProgram);
      })
    : subjects;

  const hasActiveFilters = Boolean(filterProgram || filterSection || filterSubject);

  const handleResetFilters = () => {
    setFilterProgram('');
    setFilterSection('');
    setFilterSubject('');
  };

  const displayedSubjects = subjects.filter((sub) => {
    if (filterProgram) {
      const subProg = sub.program || sub.program_details?.id;
      const matchedSec = sections.find((s) => s.id === sub.section);
      const secProg = matchedSec?.program || matchedSec?.program_details?.id;
      if (String(subProg) !== String(filterProgram) && String(secProg) !== String(filterProgram)) {
        return false;
      }
    }

    if (filterSection) {
      if (String(sub.section) !== String(filterSection)) {
        return false;
      }
    }

    if (filterSubject) {
      if (String(sub.id) !== String(filterSubject)) {
        return false;
      }
    }

    return true;
  });

  // Filter sections if program is selected for modal
  // Handles both s.program (integer FK) and s.program_details?.id (nested object)
  const filteredSections = (formData.program || formData.course_ref)
    ? sections.filter((s) => {
        const pId = s.program_details?.id ?? s.program;
        const matchesProgram = !formData.program || String(pId) === String(formData.program);
        const matchesCourse = !formData.course_ref || String(s.course_ref || s.course_details?.id) === String(formData.course_ref);
        return matchesProgram && matchesCourse;
      })
    : sections;

  return (
    <div className="page-content">
      <Toast message={successMsg} type="success" onClose={() => setSuccessMsg('')} />
      <Toast message={errorMsg} type="error" onClose={() => setErrorMsg('')} />

      {/* Dynamic 3-Dropdown Filter Toolbar: Program -> Section -> Subject */}
      <div
        className="card mb-3"
        style={{
          padding: '16px 20px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Filter size={16} style={{ color: 'var(--primary)' }} />
            <span style={{ fontWeight: '700', fontSize: '13.5px', color: 'var(--text-primary)' }}>
              Filter Subjects
            </span>
            {hasActiveFilters && (
              <span className="badge badge-primary" style={{ fontSize: '11px', padding: '2px 8px' }}>
                Active Filters
              </span>
            )}
          </div>
          <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
            Showing <strong>{displayedSubjects.length}</strong> of <strong>{subjects.length}</strong> subjects
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', alignItems: 'flex-end' }}>
          {/* Dropdown 1: Program */}
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ display: 'block', fontSize: '11.5px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              1. Program / College
            </label>
            <select
              className="form-select"
              value={filterProgram}
              onChange={(e) => handleProgramFilterChange(e.target.value)}
              style={{ fontSize: '13px', height: '36px' }}
            >
              <option value="">All Programs</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} - {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Dropdown 2: Section */}
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ display: 'block', fontSize: '11.5px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              2. Class Section
            </label>
            <select
              className="form-select"
              value={filterSection}
              onChange={(e) => handleSectionFilterChange(e.target.value)}
              style={{ fontSize: '13px', height: '36px' }}
            >
              <option value="">All Sections {filterProgram ? `(${availableSections.length})` : ''}</option>
              {availableSections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.course ? ` (${s.course})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Dropdown 3: Subject */}
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ display: 'block', fontSize: '11.5px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              3. Specific Subject
            </label>
            <select
              className="form-select"
              value={filterSubject}
              onChange={(e) => setFilterSubject(e.target.value)}
              style={{ fontSize: '13px', height: '36px' }}
            >
              <option value="">All Subjects {filterSection || filterProgram ? `(${availableSubjects.length})` : ''}</option>
              {availableSubjects.map((sub) => (
                <option key={sub.id} value={sub.id}>
                  {sub.code} - {sub.name}
                </option>
              ))}
            </select>
          </div>

          {/* Action: Clear Filters */}
          {hasActiveFilters && (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={handleResetFilters}
                style={{ height: '36px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', whiteSpace: 'nowrap' }}
              >
                <span>Reset Filters</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <div className="table-container" style={{ border: 'none', margin: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Code</th>
                <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Subject Name</th>
                <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Program</th>
                <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Section</th>
                <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Instructor</th>
                <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Units</th>
                <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Status</th>
                {isAdmin && <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableLoadingRow colSpan={isAdmin ? 8 : 7} label="Loading subjects…" />
              ) : subjects.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 8 : 7} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No subjects found.{' '}
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
              ) : displayedSubjects.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 8 : 7} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No subjects match the selected filters.{' '}
                    <button
                      type="button"
                      className="btn-link"
                      onClick={handleResetFilters}
                      style={{ color: 'var(--primary)', cursor: 'pointer', background: 'none', border: 'none', textDecoration: 'underline' }}
                    >
                      Reset filters
                    </button>
                  </td>
                </tr>
              ) : (
                displayedSubjects.map((sub) => (
                  <tr key={sub.id} className={sub.is_active === false ? 'row-inactive' : undefined}>
                    <td style={{ padding: '14px 18px' }}>
                      <span className="code-tag">{sub.code}</span>
                    </td>
                    <td style={{ padding: '14px 18px' }}>
                      <div style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{sub.name}</div>
                      {sub.description && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {sub.description}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '14px 18px' }}>
                      {sub.program_details ? (
                        <span className="code-tag code-tag-info">{sub.program_details.code}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td style={{ padding: '14px 18px' }}>
                      {sub.section_name ? (
                        <strong>{sub.section_name}</strong>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td style={{ padding: '14px 18px', color: 'var(--text-muted)', fontSize: '13px' }}>
                      {sub.instructor_details?.user
                        ? `${sub.instructor_details.user.first_name} ${sub.instructor_details.user.last_name}`
                        : '—'}
                    </td>
                    <td style={{ padding: '14px 18px', fontSize: '13px', fontWeight: '600' }}>
                      {sub.units || 3}
                    </td>
                    <td style={{ padding: '14px 18px' }}><StatusBadge active={sub.is_active !== false} /></td>
                    {isAdmin && (
                      <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                        <ActionPopover
                          items={[
                            {
                              label: 'Edit Subject',
                              icon: Edit2,
                              onClick: () => handleOpenEdit(sub),
                            },
                            {
                              label: sub.is_active !== false ? 'Deactivate Subject' : 'Activate Subject',
                              icon: Power,
                              isSuccess: sub.is_active === false,
                              onClick: () => changeActiveStatus({
                                entity: 'Subject',
                                name: sub.code,
                                isActive: sub.is_active !== false,
                                impact: `Subject ${sub.code} will be temporarily closed. Its schedules and records are kept, but attendance cannot be taken for it until it is activated again.`,
                                update: (data) => Api.updateSubject(sub.id, data),
                                onSuccess: (msg) => { setSuccessMsg(msg); loadData(); },
                                onError: setErrorMsg,
                              }),
                            },
                            { isDivider: true },
                            {
                              label: 'Delete Subject',
                              icon: Trash2,
                              isDanger: true,
                              onClick: () => handleDelete(sub.id, sub.code),
                            },
                          ]}
                        />
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Subject Modal */}
      {showAddModal && (
        <ModalBackdrop onClose={() => setShowAddModal(false)} busy={submitting}>
          <div className="modal-card modal-lg" style={{ width: '100%', maxWidth: '580px', background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden', border: '1px solid var(--border)' }}>
            <div className="modal-header" style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 className="modal-title" style={{ fontSize: '16px', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <BookOpen size={18} style={{ color: 'var(--primary)' }} />
                <span>Add Subject Offering</span>
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

                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                      1. Academic Program *
                    </label>
                    <select
                      className="form-select"
                      value={formData.program}
                      onChange={(e) => setFormData({ ...formData, program: e.target.value, course_ref: '', section: '' })}
                      required
                    >
                      <option value="">Select program...</option>
                      {programs.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} - {p.name}
                        </option>
                      ))}
                    </select>
                    <span className="form-text" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Filters available sections.</span>
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                      2. Course *
                    </label>
                    <select className="form-select" value={formData.course_ref} onChange={(e) => setFormData({ ...formData, course_ref: e.target.value, section: '' })} required>
                      <option value="">Select course...</option>
                      {courses.filter((course) => !formData.program || String(course.program) === String(formData.program)).map((course) => <option key={course.id} value={course.id}>{course.code} - {course.name}</option>)}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                      3. Section (Optional)
                    </label>
                    <select
                      className="form-select"
                      value={formData.section}
                      onChange={(e) => setFormData({ ...formData, section: e.target.value })}
                    >
                      <option value="">Choose section offering...</option>
                      {filteredSections.map((s) => {
                        const coursePart = s.course ? `${s.course} • ` : '';
                        const yearPart = s.year_level_display || `${s.year_level || 1} Year`;
                        const termPart = s.school_year ? ` • ${s.school_year}` : '';
                        return (
                          <option key={s.id} value={s.id}>
                            {s.name} ({coursePart}{yearPart}{termPart})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                    3. Instructor (Optional)
                  </label>
                  <select
                    className="form-select"
                    value={formData.instructor}
                    onChange={(e) => setFormData({ ...formData, instructor: e.target.value })}
                  >
                    <option value="">Choose instructor...</option>
                    {instructors.map((t) => (
                      <option key={t.id || t.username} value={t.instructor_profile?.id || t.id}>
                        {t.first_name ? `${t.first_name} ${t.last_name || ''}` : t.username} ({t.email})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                      Subject Code *
                    </label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="e.g. CS101, IT 473, ACT 101"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                      Units *
                    </label>
                    <input
                      type="number"
                      className="form-control"
                      value={formData.units}
                      onChange={(e) => setFormData({ ...formData, units: e.target.value })}
                      min="1"
                      max="10"
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                    Full Subject Name *
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. System Integration and Architecture"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                    Description / Course Topics (Optional)
                  </label>
                  <textarea
                    className="form-control"
                    rows="2"
                    placeholder="Brief description of course syllabus..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>
              </div>

              <div className="modal-footer" style={{ padding: '14px 22px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="btn btn-outline" data-modal-close onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  <span>{submitting ? 'Saving...' : 'Save Subject'}</span>
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}

      {/* Edit Subject Modal */}
      {editingSubject && (
        <ModalBackdrop onClose={() => setEditingSubject(null)} busy={editSubmitting}>
          <div className="modal-card modal-lg" style={{ width: '100%', maxWidth: '580px', background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden', border: '1px solid var(--border)' }}>
            <div className="modal-header" style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 className="modal-title" style={{ fontSize: '16px', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Edit2 size={18} style={{ color: 'var(--primary)' }} />
                <span>Edit Subject Offering</span>
              </h3>
              <button type="button" className="btn btn-icon btn-outline btn-sm modal-close-btn" onClick={() => setEditingSubject(null)} style={{ padding: '4px', border: 'none', background: 'none', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleEditSubmit}>
              <div className="modal-body" style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {editErrorMsg && (
                  <div className="alert alert-danger" style={{ fontSize: '13px', padding: '10px 14px' }}>{editErrorMsg}</div>
                )}
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>1. Academic Program *</label>
                    <select className="form-select" value={editFormData.program} onChange={(e) => setEditFormData({ ...editFormData, program: e.target.value, course_ref: '', section: '' })} required>
                      <option value="">Select program...</option>
                      {programs.map((p) => (<option key={p.id} value={p.id}>{p.code} - {p.name}</option>))}
                    </select>
                    <span className="form-text" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Filters available sections.</span>
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>2. Course *</label>
                    <select className="form-select" value={editFormData.course_ref} onChange={(e) => setEditFormData({ ...editFormData, course_ref: e.target.value, section: '' })} required>
                      <option value="">Select course...</option>
                      {courses.filter((course) => !editFormData.program || String(course.program) === String(editFormData.program)).map((course) => <option key={course.id} value={course.id}>{course.code} - {course.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>3. Section (Optional)</label>
                    <select className="form-select" value={editFormData.section} onChange={(e) => setEditFormData({ ...editFormData, section: e.target.value })}>
                      <option value="">Choose section offering...</option>
                      {(editFormData.program ? sections.filter((s) => {
                        const pId = s.program_details?.id ?? s.program;
                        const matchesProgram = String(pId) === String(editFormData.program);
                        const matchesCourse = !editFormData.course_ref || String(s.course_ref || s.course_details?.id) === String(editFormData.course_ref);
                        return matchesProgram && matchesCourse;
                      }) : sections).map((s) => {
                        const coursePart = s.course ? `${s.course} • ` : '';
                        const yearPart = s.year_level_display || `${s.year_level || 1} Year`;
                        const termPart = s.school_year ? ` • ${s.school_year}` : '';
                        return (
                          <option key={s.id} value={s.id}>
                            {s.name} ({coursePart}{yearPart}{termPart})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>3. Instructor (Optional)</label>
                  <select className="form-select" value={editFormData.instructor} onChange={(e) => setEditFormData({ ...editFormData, instructor: e.target.value })}>
                    <option value="">Choose instructor...</option>
                    {instructors.map((t) => (
                      <option key={t.id || t.username} value={t.instructor_profile?.id || t.id}>
                        {t.first_name ? `${t.first_name} ${t.last_name || ''}` : t.username} ({t.email})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>Subject Code *</label>
                    <input type="text" className="form-control" value={editFormData.code} onChange={(e) => setEditFormData({ ...editFormData, code: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>Units *</label>
                    <input type="number" className="form-control" value={editFormData.units} onChange={(e) => setEditFormData({ ...editFormData, units: e.target.value })} min="1" max="10" required />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>Full Subject Name *</label>
                  <input type="text" className="form-control" value={editFormData.name} onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>Description / Course Topics (Optional)</label>
                  <textarea className="form-control" rows="2" value={editFormData.description} onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })} />
                </div>
              </div>
              <div className="modal-footer" style={{ padding: '14px 22px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="btn btn-outline" data-modal-close onClick={() => setEditingSubject(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={editSubmitting}>
                  <span>{editSubmitting ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}
    </div>
  );
}
