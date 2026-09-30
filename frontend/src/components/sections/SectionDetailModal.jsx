import React from 'react';
import { PageLoader, ModalBackdrop } from '../../ui';
import { AlertTriangle, CheckCircle, Clock, Filter, Layers, MapPin, UserPlus, Users, X } from 'lucide-react';
import { formatSchoolScheduleParts } from '../../utils/time';

export default function SectionDetailModal({
  section,
  role,
  isAdmin,
  schedules = [],
  enrollments = [],
  loadingEnrollments,
  allStudents = [],
  enrollStudentId,
  enrollType,
  enrollSubjectId,
  enrolling,
  rosterFilterSubjectId,
  onClose,
  onEnrollStudent,
  onStudentChange,
  onUnenrollStudent,
  onRosterFilterChange,
  onEnrollTypeChange,
  onEnrollSubjectChange,
  onStartSession,
}) {
  if (!section) return null;

  const sectionSchedules = schedules.filter((schedule) => schedule.section === section.id);
  const visibleEnrollments = enrollments.filter((enrollment) => {
    if (rosterFilterSubjectId === 'all') return true;
    const subjectId = parseInt(rosterFilterSubjectId, 10);
    return !enrollment.is_irregular || enrollment.subject === subjectId || enrollment.subject_details?.id === subjectId;
  });

  return (
    <ModalBackdrop onClose={onClose} busy={enrolling}>
      <div className="modal-card modal-lg" style={{ width: '100%', maxWidth: '920px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden', border: '1px solid var(--border)' }}>
        <div className="modal-header" style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <h3 className="modal-title" style={{ fontSize: '16px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><Layers size={18} style={{ color: 'var(--accent)' }} />{section.name}</h3>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{section.program_details?.code || section.program?.code || 'CITEC'} • {section.year_level_display || `${section.year_level || 1}st Year`} • {section.school_year} ({section.semester})</div>
          </div>
          <button type="button" className="btn btn-icon btn-outline btn-sm modal-close-btn" onClick={onClose} style={{ padding: '4px', border: 'none', background: 'none', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div className="modal-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            <SummaryCard icon={<Clock size={19} />} label="Class Schedules" value={`${sectionSchedules.length} Meetings / Week`} />
            <SummaryCard icon={<Users size={19} />} label="Enrolled Students" value={`${enrollments.length} Total`} />
          </div>

          <section className="section-detail-panel">
            <h4><Clock size={15} /> Class Meeting Schedules</h4>
            {sectionSchedules.length === 0 ? <div className="section-detail-empty">No meeting schedules assigned to this section yet.</div> : sectionSchedules.map((schedule) => {
              const parts = formatSchoolScheduleParts(schedule);
              return <div key={schedule.id} className="section-detail-schedule"><div><span className="badge badge-accent">{schedule.subject_code || 'Subject'}</span>{(parts.timeLines || [parts.fullTime]).map((line, index) => <span key={index} className="section-detail-time">{line}</span>)}</div>{parts.room && <span className="text-muted"><MapPin size={12} /> {parts.room}</span>}</div>;
            })}
          </section>

          {isAdmin && <section className="section-detail-panel"><h4><UserPlus size={15} /> Enroll Student into this Section</h4>{/* Action form: "Enroll" saves immediately, so closing never needs a discard prompt. */}<form onSubmit={onEnrollStudent} data-guard-ignore><div style={{ display: 'grid', gridTemplateColumns: enrollType === 'irregular' ? '1.5fr 1.2fr 1.2fr auto' : '2fr 1.5fr auto', gap: '10px', alignItems: 'flex-end' }}><label className="form-group" style={{ margin: 0 }}> <span className="form-label">Select Student *</span><select className="form-select" value={enrollStudentId} onChange={onStudentChange} required><option value="">Choose student...</option>{allStudents.map((student) => <option key={student.id} value={student.id}>{`${student.user?.first_name || ''} ${student.user?.last_name || ''}`.trim() || student.student_id} ({student.student_id})</option>)}</select></label><label className="form-group" style={{ margin: 0 }}><span className="form-label">Enrollment Scope *</span><select className="form-select" value={enrollType} onChange={(event) => onEnrollTypeChange(event.target.value)}><option value="regular">Regular Block (All Subjects)</option><option value="irregular">Irregular (Specific Subject)</option></select></label>{enrollType === 'irregular' && <label className="form-group" style={{ margin: 0 }}><span className="form-label">Target Subject *</span><select className="form-select" value={enrollSubjectId} onChange={(event) => onEnrollSubjectChange(event.target.value)} required><option value="">Select subject...</option>{(section.subjects || []).map((subject) => <option key={subject.id} value={subject.id}>{subject.code} - {subject.name}</option>)}</select></label>}<button type="submit" className="btn btn-primary" disabled={enrolling} style={{ height: '36px', whiteSpace: 'nowrap' }}>{enrolling ? 'Enrolling...' : 'Enroll'}</button></div></form></section>}

          <section className="section-detail-panel"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}><h4><Users size={15} /> Class Roster</h4><span className="text-muted" style={{ fontSize: '11.5px' }}>Showing <strong>{visibleEnrollments.length}</strong> students</span></div>{section.subjects?.length > 0 && <div className="section-detail-filters"><Filter size={12} /> <button type="button" className={rosterFilterSubjectId === 'all' ? 'active' : ''} onClick={() => onRosterFilterChange('all')}>All Subjects ({enrollments.length})</button>{section.subjects.map((subject) => <button type="button" className={rosterFilterSubjectId === String(subject.id) ? 'active' : ''} key={subject.id} onClick={() => onRosterFilterChange(String(subject.id))}>{subject.code}</button>)}</div>}{loadingEnrollments ? <PageLoader label="Loading roster…" compact /> : visibleEnrollments.length === 0 ? <div className="section-detail-empty">No students currently enrolled in this section.</div> : <div style={{ maxHeight: '360px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}><thead><tr><th>Student Name</th><th>ID Number</th><th>Enrollment Scope</th><th>Face Status</th>{isAdmin && <th style={{ textAlign: 'right' }}>Action</th>}</tr></thead><tbody>{visibleEnrollments.map((enrollment) => { const student = enrollment.student_details || {}; const studentUser = student.user || {}; const name = `${studentUser.first_name || ''} ${studentUser.last_name || ''}`.trim() || student.student_id; return <tr key={enrollment.id}><td><strong>{name}</strong><div className="text-muted">{student.course || student.display_academic_program || ''}</div></td><td>{student.student_id}</td><td>{enrollment.is_irregular ? <span className="badge badge-accent">Irregular</span> : <span className="badge badge-info">Block / Regular</span>}</td><td>{student.is_face_enrolled ? <span className="badge badge-success"><CheckCircle size={10} /> Enrolled</span> : <span className="badge badge-warning"><AlertTriangle size={10} /> Missing</span>}</td>{isAdmin && <td style={{ textAlign: 'right' }}><button type="button" className="btn btn-ghost btn-sm" onClick={() => onUnenrollStudent(enrollment.id)} style={{ color: 'var(--danger)' }} aria-label={`Remove ${enrollment.student_details?.student_id || 'student'} from this section`}>Remove</button></td>}</tr>; })}</tbody></table></div>}</section>
        </div>

        <div className="modal-footer" style={{ padding: '14px 22px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '10px', flexShrink: 0 }}>{role === 'instructor' && <button type="button" className="btn btn-primary" onClick={() => { onClose(); onStartSession?.(section); }}>Open Attendance Scanner</button>}<button type="button" className="btn btn-outline" data-modal-close onClick={onClose}>Close</button></div>
      </div>
    </ModalBackdrop>
  );
}

function SummaryCard({ icon, label, value }) {
  return <div style={{ padding: '12px 14px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '12px' }}><div style={{ width: '38px', height: '38px', borderRadius: '8px', background: 'rgba(37, 99, 235, 0.1)', color: 'var(--info)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</div><div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{label}</div><div style={{ fontSize: '14.5px', fontWeight: 700 }}>{value}</div></div></div>;
}
