import React, { useEffect, useState } from 'react';
import { Camera, Edit2, Eye, FileText, Power, RotateCcw, Trash2, Users, UserX } from 'lucide-react';
import AcademicFilterToolbar, { AcademicFilterField, AcademicFilterSelect } from '../components/shared/AcademicFilterToolbar';
import { Api } from '../api';
import { formatSchoolScheduleParts } from '../utils/time';
import { getScheduleStatus } from '../utils/scheduleStatus';
import ActionPopover from '../components/shared/ActionPopover';
import Toast from '../components/shared/Toast';
import { confirmAction, TableLoadingRow, StatusBadge, changeActiveStatus, usePageLoading } from '../ui';
import AddSectionModal from '../components/sections/AddSectionModal';
import EditSectionModal from '../components/sections/EditSectionModal';
import SectionDetailModal from '../components/sections/SectionDetailModal';
import TimetableGrid from '../components/sections/TimetableGrid';

const initialSectionForm = { name: '', program_section: '', program: '', course: '', course_ref: '', year_level: 1, school_year: '2025-2026', semester: '1st' };

export default function SectionsView({ user, onNavigate, onStartSession, onSetHeaderInfo }) {
  const role = user?.role || 'admin';
  const isAdmin = role === 'admin';
  const [viewMode, setViewMode] = useState('table');
  const [sections, setSections] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [courses, setCourses] = useState([]);
  const [filterProgramId, setFilterProgramId] = useState('');
  const [filterCourseId, setFilterCourseId] = useState('');
  const [filterSectionId, setFilterSectionId] = useState('');
  const [filterSubjectId, setFilterSubjectId] = useState('');
  const [filterYearLevel, setFilterYearLevel] = useState('');
  const [filterSections, setFilterSections] = useState([]);
  const [filterSubjects, setFilterSubjects] = useState([]);
  const [catalogSections, setCatalogSections] = useState([]);
  const [sessions, setSessions] = useState([]);
  // Silent refresh keeps the active filters.
  const [loading, setLoading] = usePageLoading(() => (Object.keys(currentFilterParams()).length ? loadSections(currentFilterParams()) : loadData()));
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSection, setEditingSection] = useState(null);
  const [selectedSectionDetail, setSelectedSectionDetail] = useState(null);
  const [sectionEnrollments, setSectionEnrollments] = useState([]);
  const [loadingEnrollments, setLoadingEnrollments] = useState(false);
  const [allStudents, setAllStudents] = useState([]);
  const [enrollStudentId, setEnrollStudentId] = useState('');
  const [enrollType, setEnrollType] = useState('regular');
  const [enrollSubjectId, setEnrollSubjectId] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [rosterFilterSubjectId, setRosterFilterSubjectId] = useState('all');
  const [formData, setFormData] = useState(initialSectionForm);
  const [editFormData, setEditFormData] = useState(initialSectionForm);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadSections = async (filters = {}) => {
    try {
      setLoading(true);
      const data = await Api.getSections(filters);
      const nextSections = data || [];
      setSections(nextSections);
      setFilterSections(nextSections);
      setFilterSubjects(uniqueSubjects(nextSections));
    } catch (error) {
      setErrorMsg(error.message || 'Failed to load sections.');
    } finally {
      setLoading(false);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const [sectionData, scheduleData, programData, courseData, catalogData, sessionData] = await Promise.all([Api.getSections(), Api.getSchedules(), Api.getPrograms(), Api.getCourses(), Api.getProgramSections(), Api.getSessions().catch(() => [])]);
      const nextSections = sectionData || [];
      setSections(nextSections); setFilterSections(nextSections); setFilterSubjects(uniqueSubjects(nextSections)); setSchedules(scheduleData || []); setPrograms(programData || []); setCourses(courseData || []); setCatalogSections(catalogData || []); setSessions(sessionData || []);
    } catch (error) { setErrorMsg(error.message || 'Failed to load sections.'); } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (isAdmin && viewMode !== 'table') setViewMode('table'); }, [isAdmin, viewMode]);

  const currentFilterParams = () => ({
    ...(filterProgramId ? { program_id: filterProgramId } : {}),
    ...(filterCourseId ? { course_id: filterCourseId } : {}),
    ...(filterSectionId ? { section_id: filterSectionId } : {}),
    ...(filterSubjectId ? { subject_id: filterSubjectId } : {}),
    ...(filterYearLevel ? { year_level: filterYearLevel } : {}),
  });
  const handleProgramFilter = async (value) => {
    setFilterProgramId(value); setFilterCourseId(''); setFilterSectionId(''); setFilterSubjectId('');
    setFilterSubjects([]); setFilterSections([]);
    setCourses(await Api.getCourses(value || null));
    await loadSections({ ...(value ? { program_id: value } : {}), ...(filterYearLevel ? { year_level: filterYearLevel } : {}) });
  };
  const handleCourseFilter = async (value) => {
    setFilterCourseId(value); setFilterSectionId(''); setFilterSubjectId(''); setFilterSubjects([]);
    await loadSections({ ...currentFilterParams(), ...(value ? { course_id: value } : {}), section_id: undefined, subject_id: undefined });
  };
  const handleSectionFilter = async (value) => {
    setFilterSectionId(value); setFilterSubjectId(''); setFilterSubjects([]);
    await loadSections({ ...currentFilterParams(), ...(value ? { section_id: value } : {}), subject_id: undefined });
  };
  const handleSubjectFilter = async (value) => {
    setFilterSubjectId(value);
    await loadSections({ ...currentFilterParams(), ...(value ? { subject_id: value } : {}) });
  };
  const handleYearFilter = async (value) => {
    setFilterYearLevel(value); setFilterSectionId(''); setFilterSubjectId(''); setFilterSubjects([]);
    await loadSections({ ...(filterProgramId ? { program_id: filterProgramId } : {}), ...(filterCourseId ? { course_id: filterCourseId } : {}), ...(value ? { year_level: value } : {}) });
  };
  const resetFilters = async () => {
    setFilterProgramId(''); setFilterCourseId(''); setFilterSectionId(''); setFilterSubjectId(''); setFilterYearLevel('');
    setCourses(await Api.getCourses());
    await loadSections();
  };
  useEffect(() => {
    onSetHeaderInfo?.({
      title: role === 'student' ? 'My Schedule' : role === 'teacher' ? 'Sections & Schedules' : 'Class Sections',
      subtitle: role === 'student' ? 'Your enrolled course subjects, room assignments, and weekly class timetable' : role === 'teacher' ? 'Your assigned teaching sections, course subjects, and class schedules' : 'Manage school sections, subjects, and weekly timetable schedules',
      headerActions: <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>{!isAdmin && <div className="view-toggle-group"><button type="button" className={`btn ${viewMode === 'table' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setViewMode('table')}>Table View</button><button type="button" className={`btn ${viewMode === 'grid' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setViewMode('grid')}>Timetable Grid</button></div>}{isAdmin && <button type="button" className="btn btn-primary" onClick={() => setShowAddModal(true)}>Add Section</button>}</div>,
    });
  }, [isAdmin, onSetHeaderInfo, role, viewMode]);

  const handleCreateSection = async (data) => { await Api.createSection({ ...data, name: data.name.trim(), program_section: Number(data.program_section), program: Number(data.program), course_ref: Number(data.course_ref), course: data.course || '', year_level: Number(data.year_level) || 1 }); setSuccessMsg(`Class Section "${data.name}" created successfully!`); setShowAddModal(false); setFormData(initialSectionForm); await loadData(); };
  const handleUpdateSection = async (sectionId, data) => { await Api.updateSection(sectionId, { ...data, name: data.name.trim(), program_section: Number(data.program_section), program: Number(data.program), course_ref: Number(data.course_ref), course: data.course || '', year_level: Number(data.year_level) || 1 }); setSuccessMsg(`Section "${data.name}" updated successfully!`); setEditingSection(null); await loadData(); };
  const handleToggleSection = (section) => changeActiveStatus({ entity: 'Section', name: section.name, isActive: section.is_active !== false, impact: `Class section ${section.name} will be temporarily closed. Its schedules and enrollments are kept, but attendance cannot be taken until it is activated again.`, update: (data) => Api.updateSection(section.id, data), onSuccess: async (msg) => { setSuccessMsg(msg); await loadData(); }, onError: setErrorMsg });
  const handleDeleteSection = async (id, name) => { if (!(await confirmAction({ title: `Delete class section ${name}?`, message: 'Its schedules and enrollments will be removed. This cannot be undone.', confirmLabel: 'Delete section', tone: 'danger' }))) return; try { await Api.deleteSection(id); setSuccessMsg(`Section "${name}" deleted.`); await loadData(); } catch (error) { setErrorMsg(error.message || 'Failed to delete section.'); } };
  const startAttendanceForSchedule = async (schedule) => {
    try {
      const session = await Api.startSession(schedule.id);
      setSessions((current) => [session, ...current.filter((item) => String(item.id) !== String(session.id))]);
      onStartSession?.(session);
    } catch (error) {
      setErrorMsg(error.message || 'Failed to start attendance.');
    }
  };

  const openDetail = async (section, subjectId = null) => {
    setSelectedSectionDetail(section); setEnrollStudentId(''); setEnrollType(subjectId ? 'irregular' : 'regular'); setEnrollSubjectId(subjectId ? String(subjectId) : ''); setRosterFilterSubjectId(subjectId ? String(subjectId) : 'all');
    try { setLoadingEnrollments(true); const [enrollments, students] = await Promise.all([Api.getSectionEnrollments(section.id, subjectId ? { subject_id: subjectId } : null), (allStudents.length || role !== 'admin') ? Promise.resolve(allStudents) : Api.getStudents()]); /* full student list is admin-only (enroll picker) */ setSectionEnrollments(enrollments || []); if (!allStudents.length) setAllStudents(students || []); } catch (error) { setErrorMsg(error.message || 'Failed to load section roster.'); } finally { setLoadingEnrollments(false); }
  };
  const reloadRoster = async (subjectId = rosterFilterSubjectId) => {
    if (!selectedSectionDetail) return;
    setLoadingEnrollments(true);
    try {
      const enrollments = await Api.getSectionEnrollments(selectedSectionDetail.id, subjectId !== 'all' ? { subject_id: subjectId } : null);
      setSectionEnrollments(enrollments || []);
    } catch (error) { setErrorMsg(error.message || 'Failed to load section roster.'); } finally { setLoadingEnrollments(false); }
  };
  const enrollStudent = async (event) => { event.preventDefault(); if (!enrollStudentId || !selectedSectionDetail) return; if (enrollType === 'irregular' && !enrollSubjectId) { setErrorMsg('Please select a target subject.'); return; } try { setEnrolling(true); await Api.enrollStudent(selectedSectionDetail.id, enrollStudentId, enrollType === 'irregular' ? enrollSubjectId : null); await reloadRoster(); setEnrollStudentId(''); setSuccessMsg('Student successfully enrolled in section!'); await loadData(); } catch (error) { setErrorMsg(error.message || 'Failed to enroll student.'); } finally { setEnrolling(false); } };
  const unenrollStudent = async (enrollmentId) => { if (!(await confirmAction({ title: 'Remove student from section?', message: 'The student will no longer appear in this section roster or its attendance sessions.', confirmLabel: 'Remove student', tone: 'danger' }))) return; try { await Api.unenrollStudent(selectedSectionDetail.id, enrollmentId); await reloadRoster(); setSuccessMsg('Student removed from section.'); await loadData(); } catch (error) { setErrorMsg(error.message || 'Failed to remove student.'); } };

  return <div className="page-content"><Toast message={successMsg} type="success" onClose={() => setSuccessMsg('')} /><Toast message={errorMsg} type="error" onClose={() => setErrorMsg('')} />
    {viewMode === 'table' && <AcademicFilterToolbar
      title="Filter Class Sections"
      hasActiveFilters={Boolean(filterProgramId || filterCourseId || filterSectionId || filterSubjectId || filterYearLevel)}
      onReset={resetFilters}
    >
      <AcademicFilterField label="Program"><AcademicFilterSelect value={filterProgramId} onChange={(event) => handleProgramFilter(event.target.value)}><option value="">All Programs</option>{programs.map((program) => <option key={program.id} value={program.id}>{program.code} - {program.name}</option>)}</AcademicFilterSelect></AcademicFilterField>
      <AcademicFilterField label="Course"><AcademicFilterSelect value={filterCourseId} onChange={(event) => handleCourseFilter(event.target.value)} disabled={!filterProgramId}><option value="">All Courses</option>{courses.filter((course) => !filterProgramId || String(course.program) === String(filterProgramId)).map((course) => <option key={course.id} value={course.id}>{course.code} - {course.name}</option>)}</AcademicFilterSelect></AcademicFilterField>
      <AcademicFilterField label="Class Section"><AcademicFilterSelect value={filterSectionId} onChange={(event) => handleSectionFilter(event.target.value)} disabled={!filterCourseId}><option value="">All Sections</option>{filterSections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</AcademicFilterSelect></AcademicFilterField>
      <AcademicFilterField label="Subject"><AcademicFilterSelect value={filterSubjectId} onChange={(event) => handleSubjectFilter(event.target.value)} disabled={!filterSectionId}><option value="">All Subjects</option>{filterSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.code} - {subject.name}</option>)}</AcademicFilterSelect></AcademicFilterField>
      <AcademicFilterField label="Year Level"><AcademicFilterSelect value={filterYearLevel} onChange={(event) => handleYearFilter(event.target.value)}><option value="">All Years</option><option value="1">1st Year</option><option value="2">2nd Year</option><option value="3">3rd Year</option><option value="4">4th Year</option></AcademicFilterSelect></AcademicFilterField>
    </AcademicFilterToolbar>}
    {viewMode === 'grid' && !isAdmin ? <TimetableGrid schedules={schedules} /> : <SectionTable sections={sections} schedules={schedules} sessions={sessions} loading={loading} role={role} isAdmin={isAdmin} onDetail={openDetail} onEdit={(section) => { setEditingSection(section); setEditFormData({ ...initialSectionForm, ...section, program: section.program_details?.id || section.program || '', course_ref: section.course_ref || section.course_details?.id || '', course: section.course || section.course_details?.code || '', }); }} onDelete={handleDeleteSection} onToggleActive={handleToggleSection} onNavigate={onNavigate} onStartSession={onStartSession} onStartSchedule={startAttendanceForSchedule} />}
    <AddSectionModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} onSubmit={handleCreateSection} programs={programs} courses={courses} catalogSections={catalogSections} />
    <EditSectionModal isOpen={Boolean(editingSection)} section={editingSection} onClose={() => setEditingSection(null)} onUpdate={handleUpdateSection} programs={programs} courses={courses} catalogSections={catalogSections} />
    <SectionDetailModal section={selectedSectionDetail} role={role} isAdmin={isAdmin} schedules={schedules} enrollments={sectionEnrollments} loadingEnrollments={loadingEnrollments} allStudents={allStudents} enrollStudentId={enrollStudentId} enrollType={enrollType} enrollSubjectId={enrollSubjectId} enrolling={enrolling} rosterFilterSubjectId={rosterFilterSubjectId} onClose={() => setSelectedSectionDetail(null)} onEnrollStudent={enrollStudent} onStudentChange={(event) => setEnrollStudentId(event.target.value)} onUnenrollStudent={unenrollStudent} onRosterFilterChange={(value) => { setRosterFilterSubjectId(value); setEnrollType(value === 'all' ? 'regular' : 'irregular'); setEnrollSubjectId(value === 'all' ? '' : value); reloadRoster(value); }} onEnrollTypeChange={setEnrollType} onEnrollSubjectChange={setEnrollSubjectId} onStartSession={onStartSession} />
  </div>;
}

function SectionTable({ sections, schedules, sessions, loading, role, isAdmin, onDetail, onEdit, onDelete, onNavigate, onStartSession, onStartSchedule, onToggleActive }) {
  const columnCount = role === 'teacher' ? 9 : 8;

  return (
    <div className="card mb-3">
      <div className="table-container" style={{ border: 'none', overflowX: 'auto' }}>
        <table className="sections-table">
          <thead>
            <tr>
              <th>Program</th><th>Course</th><th>Section</th>
              {role === 'teacher' && <th>Attendance</th>}
              <th>{isAdmin ? 'Subject & Instructor' : 'Subject'}</th><th>Schedule</th><th>School Year</th><th>Students</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <TableLoadingRow colSpan={columnCount} label="Loading sections…" />
              : sections.length === 0 ? <tr><td colSpan={columnCount} className="text-center text-muted">No class sections available.</td></tr>
                : sections.flatMap((section) => getRows(section, schedules, sessions, role, isAdmin, onDetail, onEdit, onDelete, onNavigate, onStartSession, onStartSchedule, onToggleActive))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getRows(section, schedules, sessions, role, isAdmin, onDetail, onEdit, onDelete, onNavigate, onStartSession, onStartSchedule, onToggleActive) {
  const subjects = getSectionSubjects(section);
  const sectionActive = section.is_active !== false;
  const rowSpan = subjects.length;
  const firstSubjectId = subjects[0]?.id || null;

  return subjects.map((subject, index) => {
    const subjectSchedules = getSubjectSchedules(section, subject, schedules);
    const attendanceStatus = role === 'teacher' && subjectSchedules[0] ? getScheduleStatus(subjectSchedules[0], sessions) : null;
    const scheduleActions = subjectSchedules.map((schedule) => {
      const session = findTodayScheduleSession(sessions, schedule);
      const availability = getScheduleAttendanceAvailability(schedule);
      const label = session?.status === 'open' ? 'Resume Scanner' : session?.status === 'closed' ? 'Reopen & Scan' : availability.label;
      return {
        label: subjectSchedules.length > 1 ? `${label} (${formatSchoolScheduleParts(schedule).fullTime})` : label,
        icon: session?.status === 'closed' ? RotateCcw : Camera,
        isPrimary: true,
        disabled: !session && !availability.canStart,
        title: !session && !availability.canStart ? availability.reason : undefined,
        onClick: session ? () => onStartSession?.(session) : () => onStartSchedule?.(schedule),
      };
    });
    const actionItems = role === 'teacher'
      ? [...(scheduleActions.length ? scheduleActions : [{ label: 'No schedule set', icon: Camera, isPrimary: true, disabled: true, title: 'Attendance requires a scheduled class.' }]), { isDivider: true }, { label: 'Class List & Attendance', icon: Users, onClick: () => onDetail(section, subject.id || firstSubjectId) }, { label: 'Attendance Report', icon: FileText, onClick: () => onNavigate('section_report') }]
      : role === 'student'
        ? [{ label: 'Class List', icon: Users, onClick: () => onDetail(section, subject.id || firstSubjectId) }]
        : [{ label: 'View Details', icon: Eye, onClick: () => onDetail(section, subject.id || firstSubjectId) }, { label: 'Attendance Report', icon: FileText, onClick: () => onNavigate('section_report') }, { label: 'Edit Section', icon: Edit2, onClick: () => onEdit(section) }, { label: sectionActive ? 'Deactivate Section' : 'Activate Section', icon: Power, isSuccess: !sectionActive, onClick: () => onToggleActive?.(section) }, { isDivider: true }, { label: 'Delete Section', icon: Trash2, isDanger: true, onClick: () => onDelete(section.id, section.name) }];
    const isLastSubject = index === subjects.length - 1;

    return (
      <tr key={`${section.id}-${subject.id || index}`} className={['section-subject-row', isLastSubject ? 'is-group-end' : '', sectionActive ? '' : 'row-inactive'].filter(Boolean).join(' ')} style={{ background: 'transparent' }}>
        {index === 0 && <>
          <td rowSpan={rowSpan} className="section-group-cell" style={{ verticalAlign: 'middle', textAlign: 'center', padding: '10px 8px' }}><span className="code-tag">{section.program_details?.code || section.program?.code || '—'}</span></td>
          <td rowSpan={rowSpan} className="section-group-cell" style={{ verticalAlign: 'middle', textAlign: 'center', padding: '10px 8px' }}>{section.course ? <span className="code-tag code-tag-info">{section.course}</span> : <span className="text-muted" style={{ fontSize: '12px' }}>—</span>}</td>
          <td rowSpan={rowSpan} className="section-group-cell section-group-divider" style={{ verticalAlign: 'middle', padding: '10px 8px' }}><strong>{section.name}</strong><div className="text-muted" style={{ fontSize: '12px' }}>{section.year_level_display || `${section.year_level || 1}st Year`}</div>{isAdmin && <div style={{ marginTop: '6px' }}><StatusBadge active={sectionActive} /></div>}</td>
        </>}
        {role === 'teacher' && <td style={{ verticalAlign: 'middle', textAlign: 'center', padding: '10px 8px' }}>{attendanceStatus ? <span className={`badge badge-${attendanceStatus.key === 'live' ? 'success' : attendanceStatus.key === 'ready' ? 'info' : attendanceStatus.key === 'upcoming' ? 'warning' : 'muted'}`} title={attendanceStatus.detail} style={{ whiteSpace: 'nowrap' }}>{attendanceStatus.label}</span> : <span className="badge badge-muted">No schedule</span>}</td>}
        <td style={{ verticalAlign: 'middle', padding: '10px 8px' }}>
          <div className="subject-cell">
            <span className="code-tag" style={{ width: 'fit-content' }}>{subject.code || '—'}</span>
            <span className="subject-cell-name">{subject.name || 'No subjects'}</span>
            {isAdmin && <InstructorLine subject={subject} section={section} />}
          </div>
        </td>
        <td style={{ verticalAlign: 'middle', padding: '10px 8px' }}>{subjectSchedules.length ? <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>{subjectSchedules.map((parts, scheduleIndex) => <span key={`${section.id}-${subject.id || index}-schedule-${scheduleIndex}`} className="schedule-text">{(parts.timeLines || [parts.fullTime]).map((line, lineIndex) => <span key={lineIndex} className="schedule-text-time">{line}</span>)}{parts.room && <span className="schedule-text-room">{parts.room}</span>}</span>)}</div> : <span className="text-muted" style={{ fontSize: '12px' }}>No schedule set</span>}</td>
        <td style={{ verticalAlign: 'middle', padding: '10px 8px' }}>{section.school_year}<div className="text-muted" style={{ fontSize: '12px' }}>({section.semester})</div></td>
        <td style={{ verticalAlign: 'middle', textAlign: 'center', padding: '10px 8px' }}><button type="button" className="count-link" onClick={() => onDetail(section, subject.id || firstSubjectId)} title="View class list">{subject.student_count ?? section.student_count ?? 0}</button></td>
        <td style={{ verticalAlign: 'middle', textAlign: 'center', padding: '10px 8px', whiteSpace: 'nowrap' }}><ActionPopover items={actionItems} /></td>
      </tr>
    );
  });
}

/** Instructor for a subject row: subject's own teacher, else the section adviser. */
function InstructorLine({ subject, section }) {
  const teacher = subject.teacher_details || (section.subjects?.length ? null : section.teacher_details);
  const u = teacher?.user;
  const name = u ? [teacher.title, u.first_name, u.last_name].filter(Boolean).join(' ') || u.username : '';
  if (!name) {
    return <span className="subject-cell-instructor is-empty"><UserX size={12} aria-hidden="true" /> No instructor assigned</span>;
  }
  const initials = [u.first_name?.[0], u.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?';
  return (
    <span className="subject-cell-instructor" title={`Instructor: ${name}`}>
      <span className="subject-cell-instructor-label">Instructor:</span>
      <span className="subject-cell-avatar" aria-hidden="true">{initials}</span>
      <span className="subject-cell-instructor-name">{name}</span>
    </span>
  );
}

function getSectionSubjects(section) {
  return section.subjects?.length ? section.subjects : [{ id: section.subject || null, code: section.effective_subject_code || section.subject_details?.code || '', name: section.effective_subject_name || section.subject_details?.name || 'No subjects' }];
}

function getSubjectSchedules(section, subject, schedules) {
  const sectionSchedules = schedules.filter((item) => String(item.section) === String(section.id));
  const matchingSchedules = sectionSchedules.filter((item) => String(item.subject) === String(subject.id) || item.subject_code === subject.code);
  const resolvedSchedules = matchingSchedules.length || getSectionSubjects(section).length > 1 ? matchingSchedules : sectionSchedules;
  return resolvedSchedules.map((item) => ({ ...item, ...formatSchoolScheduleParts(item) }));
}

function getScheduleAttendanceAvailability(schedule, now = new Date()) {
  const meetingDays = getScheduleMeetingDays(schedule);
  const today = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()];
  const startMinutes = parseScheduleTime(schedule.start_time);
  const endMinutes = parseScheduleTime(schedule.end_time);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startLabel = formatSchoolScheduleParts(schedule).fullTime || 'the scheduled class time';

  if (!meetingDays.includes(today)) {
    return { canStart: false, label: 'Not scheduled today', reason: `Attendance is available only on ${meetingDays.join(' / ')}.` };
  }
  if (startMinutes !== null && nowMinutes < startMinutes) {
    return { canStart: false, label: `Available at ${formatTime(schedule.start_time)}`, reason: `This class has not started yet. Attendance opens at ${formatTime(schedule.start_time)}.` };
  }
  if (endMinutes !== null && nowMinutes > endMinutes) {
    return { canStart: false, label: 'Class time ended', reason: `Attendance for ${startLabel} has already ended.` };
  }
  return { canStart: true, label: 'Start Attendance' };
}

function getScheduleMeetingDays(schedule) {
  const rawDays = Array.isArray(schedule.meeting_days) ? schedule.meeting_days : [schedule.day_of_week, schedule.day_2].filter(Boolean);
  const dayMap = { M: 'Mon', Mon: 'Mon', Monday: 'Mon', T: 'Tue', Tue: 'Tue', Tuesday: 'Tue', W: 'Wed', Wed: 'Wed', Wednesday: 'Wed', TH: 'Thu', Th: 'Thu', Thu: 'Thu', Thursday: 'Thu', F: 'Fri', Fri: 'Fri', Friday: 'Fri', S: 'Sat', Sa: 'Sat', Sat: 'Sat', Saturday: 'Sat', SU: 'Sun', Su: 'Sun', Sun: 'Sun', Sunday: 'Sun' };
  return rawDays.map((day) => dayMap[String(day).trim()] || String(day).trim()).filter(Boolean);
}

function parseScheduleTime(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function formatTime(value) {
  const [hours = '0', minutes = '00'] = String(value || '').split(':');
  const hour = Number(hours);
  return `${String(hour % 12 || 12).padStart(2, '0')}:${minutes} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function findTodayScheduleSession(sessions, schedule) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return sessions.find((session) => String(session.schedule) === String(schedule.id) && session.date === today);
}

function uniqueSubjects(sectionList) {
  const subjects = new Map();
  sectionList.flatMap((section) => getSectionSubjects(section)).forEach((subject) => {
    if (subject?.id) subjects.set(String(subject.id), subject);
  });
  return Array.from(subjects.values()).sort((left, right) => String(left.code || '').localeCompare(String(right.code || '')));
}
