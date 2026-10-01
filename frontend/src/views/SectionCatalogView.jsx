import React, { useState, useEffect } from 'react';
import { X, Trash2, Calendar, Edit2, Power, Layers } from 'lucide-react';
import AcademicFilterToolbar, { AcademicFilterField, AcademicFilterSelect } from '../components/shared/AcademicFilterToolbar';
import { Api } from '../api';
import ActionPopover from '../components/shared/ActionPopover';
import Toast from '../components/shared/Toast';
import {
  confirmAction, TableLoadingRow, StatusBadge, changeActiveStatus, ModalBackdrop, usePageLoading,
  EmptyTableRow, useShowHeaderAdd,
} from '../ui';

const emptyForm = { program: '', course_ref: '', name: '', year_level: 1, description: '' };
const YEAR_LABELS = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year' };

export default function SectionCatalogView({ user, onNavigate, onSetHeaderInfo }) {
  const [sections, setSections] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [courses, setCourses] = useState([]); // courses for the current filter
  const [allCourses, setAllCourses] = useState([]); // every course, used by the add/edit form
  const [loading, setLoading] = usePageLoading(() => loadData(currentFilters())); // silent refresh keeps filters

  const [filterCollege, setFilterCollege] = useState('');
  const [filterCourse, setFilterCourse] = useState('');
  const [filterYear, setFilterYear] = useState('');

  const [modalMode, setModalMode] = useState(null); // 'add' | 'edit' | null
  const [editingSection, setEditingSection] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const isAdmin = user?.role === 'admin';

  const loadData = async (filters = {}) => {
    try {
      setLoading(true);
      const [secList, progList, courseList] = await Promise.all([
        Api.getProgramSections(filters),
        programs.length ? Promise.resolve(programs) : Api.getPrograms(),
        Api.getCourses(filters.program_id || filters.program || null),
      ]);
      setSections(secList || []);
      setPrograms(progList || []);
      setCourses(courseList || []);
      if (!filters.program_id && !filters.program) setAllCourses(courseList || []);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load section catalog.');
    } finally {
      setLoading(false);
    }
  };

  const currentFilters = () => ({ program_id: filterCollege, course_id: filterCourse, year_level: filterYear });

  useEffect(() => {
    loadData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openAdd = () => {
    setEditingSection(null);
    setFormData({ ...emptyForm, program: filterCollege || '' });
    setFormError('');
    setModalMode('add');
  };

  const openEdit = (sec) => {
    setEditingSection(sec);
    setFormData({
      program: String(sec.program || sec.program_details?.id || ''),
      course_ref: String(sec.course_ref || sec.course_details?.id || ''),
      name: sec.name || '',
      year_level: sec.year_level || 1,
      description: sec.description || '',
    });
    setFormError('');
    setModalMode('edit');
  };

  const closeModal = () => {
    if (submitting) return;
    setModalMode(null);
    setEditingSection(null);
  };

  const hasActiveFilters = Boolean(filterCollege || filterCourse || filterYear);
  // Empty catalog: the only Add button is the one centered in the table.
  const showHeaderAdd = useShowHeaderAdd(loading, sections.length > 0 || hasActiveFilters);

  useEffect(() => {
    if (!onSetHeaderInfo) return;
    onSetHeaderInfo({
      title: 'Section Catalog (Master List)',
      subtitle: 'Official section definitions grouped by College, Course, and Year Level',
      headerActions: isAdmin && showHeaderAdd ? (
        <button type="button" className="btn btn-primary" onClick={openAdd}>
          Add Section Definition
        </button>
      ) : null,
    });
  }, [isAdmin, onSetHeaderInfo, showHeaderAdd]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleProgramChange = (programId) => {
    setFilterCollege(programId);
    setFilterCourse('');
    loadData({ program_id: programId, year_level: filterYear });
  };

  const handleCourseChange = (courseId) => {
    setFilterCourse(courseId);
    loadData({ program_id: filterCollege, course_id: courseId, year_level: filterYear });
  };

  const handleYearChange = (yearLevel) => {
    setFilterYear(yearLevel);
    loadData({ program_id: filterCollege, course_id: filterCourse, year_level: yearLevel });
  };

  const handleResetFilters = () => {
    setFilterCollege('');
    setFilterCourse('');
    setFilterYear('');
    loadData();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const name = formData.name.trim();
    if (!name || !formData.program || !formData.course_ref) {
      setFormError('College, course, and section name are required.');
      return;
    }
    const duplicate = sections.find((sec) => sec.id !== editingSection?.id
      && String(sec.program) === String(formData.program)
      && sec.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicate) {
      setFormError(`A section named "${duplicate.name}" already exists in this college.`);
      return;
    }

    const selectedCourse = allCourses.find((course) => String(course.id) === String(formData.course_ref));
    const payload = {
      program: Number(formData.program),
      course_ref: Number(formData.course_ref),
      course: selectedCourse?.code || '',
      name,
      year_level: parseInt(formData.year_level, 10) || 1,
      description: formData.description.trim(),
    };

    try {
      setSubmitting(true);
      setFormError('');
      if (modalMode === 'edit' && editingSection) {
        await Api.updateProgramSection(editingSection.id, payload);
        setSuccessMsg(`Section definition "${name}" updated.`);
      } else {
        await Api.createProgramSection(payload);
        setSuccessMsg(`Section definition "${name}" created.`);
      }
      setModalMode(null);
      setEditingSection(null);
      setFormData(emptyForm);
      await loadData(currentFilters());
    } catch (err) {
      setFormError(err.message || 'Failed to save section definition.');
    } finally {
      setSubmitting(false);
    }
  };

  const deleteDefinition = async (sec) => {
    if (!(await confirmAction({
      title: `Delete section ${sec.name}?`,
      message: 'This section definition will be removed from the master list. This cannot be undone.',
      details: 'Tip: deactivate it instead to close it temporarily without losing history.',
      confirmLabel: 'Delete section',
      tone: 'danger',
    }))) return;
    try {
      await Api.deleteProgramSection(sec.id);
      setSuccessMsg(`Section definition ${sec.name} deleted.`);
      await loadData(currentFilters());
    } catch (err) {
      setErrorMsg(err.message || 'Failed to delete definition.');
    }
  };

  const toggleDefinition = (sec) => changeActiveStatus({
    entity: 'Section',
    name: sec.name,
    isActive: sec.is_active !== false,
    impact: `Section ${sec.name} will be temporarily closed. Its class offerings and enrollments are kept, but attendance cannot be taken for them until it is activated again.`,
    update: (data) => Api.updateProgramSection(sec.id, data),
    onSuccess: async (msg) => { setSuccessMsg(msg); await loadData(currentFilters()); },
    onError: setErrorMsg,
  });

  const colSpan = isAdmin ? 8 : 7;
  const formCourses = allCourses.filter((course) => String(course.program) === String(formData.program));

  return (
    <div className="page-content">
      <Toast message={successMsg} type="success" onClose={() => setSuccessMsg('')} />
      <Toast message={errorMsg} type="error" onClose={() => setErrorMsg('')} />

      <AcademicFilterToolbar
        title="Filter Section Catalog"
        hasActiveFilters={hasActiveFilters}
        onReset={handleResetFilters}
        resultCount={sections.length}
        resultTotal={sections.length}
        resultLabel="section definitions"
      >
        <AcademicFilterField label="1. College / Department">
          <AcademicFilterSelect value={filterCollege} onChange={(e) => handleProgramChange(e.target.value)}>
            <option value="">All Colleges / Departments</option>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
          </AcademicFilterSelect>
        </AcademicFilterField>
        <AcademicFilterField label="2. Degree Course (BSIT, CS, etc.)">
          <AcademicFilterSelect value={filterCourse} disabled={!filterCollege || loading} onChange={(e) => handleCourseChange(e.target.value)}>
            <option value="">All Courses / Majors</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.code}{c.name ? ` - ${c.name}` : ''}</option>)}
          </AcademicFilterSelect>
        </AcademicFilterField>
        <AcademicFilterField label="3. Year Level">
          <AcademicFilterSelect value={filterYear} onChange={(e) => handleYearChange(e.target.value)}>
            <option value="">All Year Levels</option>
            {Object.entries(YEAR_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </AcademicFilterSelect>
        </AcademicFilterField>
      </AcademicFilterToolbar>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>College</th>
                <th>Course</th>
                <th>Section Name</th>
                <th>Year Level</th>
                <th>Description / Track</th>
                <th>Class Offerings</th>
                <th>Status</th>
                {isAdmin && <th style={{ textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableLoadingRow colSpan={colSpan} label="Loading section catalog…" />
              ) : sections.length === 0 ? (
                hasActiveFilters ? (
                  <EmptyTableRow
                    colSpan={colSpan}
                    icon={Layers}
                    title="No section definitions match your filters"
                    message="Try another college, course or year level."
                    secondary={<button type="button" className="btn btn-outline" onClick={handleResetFilters}>Clear filters</button>}
                  />
                ) : (
                  <EmptyTableRow
                    colSpan={colSpan}
                    icon={Layers}
                    title="No section definitions yet"
                    message="Add the official sections of each course to build the master list."
                    actionLabel={isAdmin ? 'Add Section Definition' : null}
                    onAction={openAdd}
                  />
                )
              ) : (
                sections.map((sec) => {
                  const active = sec.is_active !== false;
                  const offerings = sec.active_classes_count || 0;
                  return (
                    <tr key={sec.id} className={active ? undefined : 'row-inactive'}>
                      <td><span className="code-tag">{sec.program_details?.code || '—'}</span></td>
                      <td><span className="code-tag code-tag-info">{sec.course_details?.code || sec.course || '—'}</span></td>
                      <td><strong>{sec.name}</strong></td>
                      <td className="text-secondary">{sec.year_level_display || YEAR_LABELS[sec.year_level] || '—'}</td>
                      <td className="text-muted">{sec.description || '—'}</td>
                      <td className="num-cell">{offerings === 1 ? '1 class' : `${offerings} classes`}</td>
                      <td><StatusBadge active={active} /></td>
                      {isAdmin && (
                        <td style={{ textAlign: 'right' }}>
                          <ActionPopover
                            items={[
                              { label: 'Edit Definition', icon: Edit2, onClick: () => openEdit(sec) },
                              { label: 'Open Semester Class', icon: Calendar, onClick: () => onNavigate?.('sections') },
                              { label: active ? 'Deactivate Section' : 'Activate Section', icon: Power, isSuccess: !active, onClick: () => toggleDefinition(sec) },
                              { isDivider: true },
                              { label: 'Delete Definition', icon: Trash2, isDanger: true, onClick: () => deleteDefinition(sec) },
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

      {modalMode && (
        <ModalBackdrop onClose={closeModal} busy={submitting}>
          <div className="modal-card modal-md" role="dialog" aria-modal="true" aria-labelledby="catalog-modal-title">
            <div className="modal-header">
              <div>
                <h3 className="modal-title" id="catalog-modal-title">
                  {modalMode === 'edit' ? `Edit ${editingSection?.name || 'Section Definition'}` : 'Add Section Definition'}
                </h3>
                <p className="modal-subtitle">
                  {modalMode === 'edit'
                    ? 'Fix typos or move this section to the right course. Linked class offerings update automatically.'
                    : 'Create an official section under a college and course.'}
                </p>
              </div>
              <button type="button" className="modal-close-btn" aria-label="Close" onClick={closeModal}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                {formError && <div className="alert alert-danger">{formError}</div>}

                <div className="modal-form-grid">
                  <div className="form-group">
                    <label className="form-label" htmlFor="catalog-program">College / Department *</label>
                    <select
                      id="catalog-program"
                      className="form-select"
                      value={formData.program}
                      onChange={(e) => setFormData({ ...formData, program: e.target.value, course_ref: '' })}
                      required
                    >
                      <option value="">Select college…</option>
                      {programs.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="catalog-course">Course / Degree *</label>
                    <select
                      id="catalog-course"
                      className="form-select"
                      value={formData.course_ref}
                      onChange={(e) => setFormData({ ...formData, course_ref: e.target.value })}
                      disabled={!formData.program}
                      required
                    >
                      <option value="">{formData.program ? (formCourses.length ? 'Select course…' : 'No courses in this college') : 'Select a college first'}</option>
                      {formCourses.map((course) => <option key={course.id} value={course.id}>{course.code} - {course.name}</option>)}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="catalog-name">Section Name *</label>
                    <input
                      id="catalog-name"
                      type="text"
                      className="form-control"
                      placeholder="e.g. BSIT-1A"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value.toUpperCase() })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="catalog-year">Year Level</label>
                    <select
                      id="catalog-year"
                      className="form-select"
                      value={formData.year_level}
                      onChange={(e) => setFormData({ ...formData, year_level: parseInt(e.target.value, 10) })}
                    >
                      {Object.entries(YEAR_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </div>

                  <div className="form-group modal-form-full">
                    <label className="form-label" htmlFor="catalog-description">Description / Track</label>
                    <input
                      id="catalog-description"
                      type="text"
                      className="form-control"
                      placeholder="Optional, e.g. Software Engineering Track"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-outline" data-modal-close onClick={closeModal} disabled={submitting}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {modalMode === 'edit'
                    ? (submitting ? 'Saving changes…' : 'Save changes')
                    : (submitting ? 'Creating…' : 'Create definition')}
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}
    </div>
  );
}
