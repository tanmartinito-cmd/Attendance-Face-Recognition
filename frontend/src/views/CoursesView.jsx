import { useEffect, useState } from 'react';
import { BookOpen, X, Trash2, Edit2, Power, Filter } from 'lucide-react';
import { Api } from '../api';
import ActionPopover from '../components/shared/ActionPopover';
import Toast from '../components/shared/Toast';
import { confirmAction, TableLoadingRow, StatusBadge, changeActiveStatus, ModalBackdrop, usePageLoading } from '../ui';

const emptyCourse = { code: '', name: '', description: '', is_active: true, program: '' };

export default function CoursesView({ user, onSetHeaderInfo }) {
  const [courses, setCourses] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = usePageLoading(() => Promise.all([loadPrograms(), loadCourses()]));
  const [filterProgram, setFilterProgram] = useState('');
  const [showCourseModal, setShowCourseModal] = useState(false);
  const [editingCourse, setEditingCourse] = useState(null);
  const [courseForm, setCourseForm] = useState(emptyCourse);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const isAdmin = user?.role === 'admin';

  const loadPrograms = async () => {
    try {
      setPrograms(await Api.getPrograms());
    } catch (error) {
      setErrorMsg(error.message || 'Failed to load programs.');
    }
  };

  const loadCourses = async (programId = filterProgram) => {
    try {
      setLoading(true);
      setCourses(await Api.getCourses(programId || null));
    } catch (error) {
      setErrorMsg(error.message || 'Failed to load courses.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPrograms();
    loadCourses();
  }, []);

  useEffect(() => {
    onSetHeaderInfo?.({
      title: 'Courses',
      subtitle: 'Manage the Courses offered under each Academic Program',
      headerActions: isAdmin ? (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => { setEditingCourse(null); setCourseForm(emptyCourse); setErrorMsg(''); setShowCourseModal(true); }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          Add Course
        </button>
      ) : null,
    });
  }, [isAdmin, onSetHeaderInfo]);

  const handleFilterChange = (programId) => {
    setFilterProgram(programId);
    loadCourses(programId);
  };

  const submitCourse = async (event) => {
    event.preventDefault();
    if (!courseForm.code.trim() || !courseForm.name.trim() || !courseForm.program) {
      setErrorMsg('Program, course code, and course name are required.');
      return;
    }
    try {
      setSubmitting(true);
      const payload = { ...courseForm, program: Number(courseForm.program), code: courseForm.code.trim().toUpperCase() };
      if (editingCourse) await Api.updateCourse(editingCourse.id, payload);
      else await Api.createCourse(payload);
      setSuccessMsg(editingCourse ? 'Course updated successfully.' : 'Course created successfully.');
      setShowCourseModal(false);
      setEditingCourse(null);
      setCourseForm(emptyCourse);
      await loadCourses();
    } catch (error) {
      setErrorMsg(error.message || 'Failed to save course.');
    } finally {
      setSubmitting(false);
    }
  };

  const openAddCourse = () => {
    setEditingCourse(null);
    setCourseForm({ ...emptyCourse, program: filterProgram || '' });
    setErrorMsg('');
    setShowCourseModal(true);
  };

  const openEditCourse = (course) => {
    setEditingCourse(course);
    setCourseForm({
      code: course.code || '',
      name: course.name || '',
      description: course.description || '',
      is_active: course.is_active !== false,
      program: course.program || course.program_details?.id || '',
    });
    setErrorMsg('');
    setShowCourseModal(true);
  };

  const deleteCourse = async (course) => {
    if (!(await confirmAction({ title: `Delete course ${course.code}?`, message: 'A course can only be deleted when no sections, subjects or students depend on it. This cannot be undone.', details: 'Tip: deactivate the course instead to hide it without losing history.', confirmLabel: 'Delete course', tone: 'danger' }))) return;
    try {
      await Api.deleteCourse(course.id);
      setSuccessMsg(`Course ${course.code} deleted.`);
      await loadCourses();
    } catch (error) {
      setErrorMsg(error.message || 'Course cannot be deleted while it is in use.');
    }
  };

  const toggleCourse = (course) => changeActiveStatus({
    entity: 'Course',
    name: course.code,
    isActive: course.is_active !== false,
    impact: `Course ${course.code} will be temporarily closed. Its sections and students are kept, but it will not be offered for new classes and attendance cannot be taken until it is activated again.`,
    update: (data) => Api.updateCourse(course.id, data),
    onSuccess: async (msg) => { setSuccessMsg(msg); await loadCourses(); },
    onError: setErrorMsg,
  });

  return (
    <div className="page-content">
      <Toast message={successMsg} type="success" onClose={() => setSuccessMsg('')} />
      <Toast message={errorMsg} type="error" onClose={() => setErrorMsg('')} />

      <div
        className="card mb-3"
        style={{ padding: '16px 20px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', display: 'flex', flexDirection: 'column', gap: '12px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Filter size={16} style={{ color: 'var(--primary)' }} />
          <span style={{ fontWeight: 700, fontSize: '13.5px' }}>Filter by Program</span>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <select
            className="form-select"
            value={filterProgram}
            onChange={(e) => handleFilterChange(e.target.value)}
            style={{ fontSize: '13px', height: '36px', minWidth: '240px' }}
          >
            <option value="">All Programs</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>{p.code} - {p.name}</option>
            ))}
          </select>
          {filterProgram && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => handleFilterChange('')} style={{ height: '36px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="table-container" style={{ border: 'none', margin: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Course Name</th>
                <th>Program</th>
                <th>Status</th>
                {isAdmin && <th style={{ textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableLoadingRow colSpan={isAdmin ? 5 : 4} label="Loading courses…" />
              ) : courses.length === 0 ? (
                <tr><td colSpan={isAdmin ? 5 : 4} className="text-center text-muted" style={{ padding: '36px' }}>No Courses found.</td></tr>
              ) : courses.map((course) => (
                <tr key={course.id} className={course.is_active === false ? 'row-inactive' : undefined}>
                  <td><span className="code-tag">{course.code}</span></td>
                  <td><strong>{course.name}</strong></td>
                  <td>{course.program_details ? <span className="code-tag code-tag-info">{course.program_details.code}</span> : <span className="text-muted">—</span>}</td>
                  <td><StatusBadge active={course.is_active !== false} /></td>
                  {isAdmin && (
                    <td style={{ textAlign: 'right' }}>
                      <ActionPopover items={[
                        { label: 'Edit Course', icon: Edit2, onClick: () => openEditCourse(course) },
                        { label: course.is_active ? 'Deactivate Course' : 'Activate Course', icon: Power, isSuccess: !course.is_active, onClick: () => toggleCourse(course) },
                        { isDivider: true },
                        { label: 'Delete Course', icon: Trash2, isDanger: true, onClick: () => deleteCourse(course) },
                      ]} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCourseModal && (
        <CourseModal
          programs={programs}
          editing={Boolean(editingCourse)}
          formData={courseForm}
          setFormData={setCourseForm}
          submitting={submitting}
          errorMsg={errorMsg}
          onSubmit={submitCourse}
          onClose={() => { setShowCourseModal(false); setEditingCourse(null); }}
        />
      )}
    </div>
  );
}

function CourseModal({ programs, editing, formData, setFormData, submitting, errorMsg, onSubmit, onClose }) {
  return (
    <ModalBackdrop onClose={onClose} busy={submitting}>
      <div className="modal-card modal-md">
        <div className="modal-header">
          <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {editing ? <Edit2 size={18} /> : <BookOpen size={18} />}
            {editing ? 'Edit Course' : 'Add Course'}
          </h3>
          <button type="button" className="btn btn-icon btn-outline btn-sm" aria-label="Close" data-modal-close onClick={onClose} style={{ padding: '4px', border: 'none', background: 'none' }}>
            <X size={18} />
          </button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="modal-body" style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {errorMsg && <div className="alert alert-danger">{errorMsg}</div>}
            <Field label="Academic Program *">
              <select className="form-select" value={formData.program} onChange={(e) => setFormData({ ...formData, program: e.target.value })} required>
                <option value="">Select program...</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>{p.code} - {p.name}</option>
                ))}
              </select>
            </Field>
            <div className="grid-2">
              <Field label="Course Code *">
                <input className="form-control" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })} placeholder="e.g. BSIT" required />
              </Field>
              <Field label="Course Name *">
                <input className="form-control" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Bachelor of Science in IT" required />
              </Field>
            </div>
            <Field label="Description">
              <textarea className="form-control" rows="3" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" checked={formData.is_active !== false} onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })} /> Active Course
            </label>
          </div>
          <div className="modal-footer" style={{ padding: '14px 22px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button type="button" className="btn btn-outline" data-modal-close onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : editing ? 'Save Changes' : 'Add Course'}
            </button>
          </div>
        </form>
      </div>
    </ModalBackdrop>
  );
}

function Field({ label, children }) {
  return <div className="form-group"><label className="form-label">{label}</label>{children}</div>;
}
