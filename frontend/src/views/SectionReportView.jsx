import React, { useEffect, useMemo, useState } from 'react';
import { TableLoadingRow } from '../ui';
import { Calendar, CheckCircle2, Clock, FileText, Filter, Users, XCircle } from 'lucide-react';
import { Api } from '../api';

export default function SectionReportView({ user, onSetHeaderInfo }) {
  const [sections, setSections] = useState([]); const [sessions, setSessions] = useState([]); const [records, setRecords] = useState([]);
  const [sectionId, setSectionId] = useState(''); const [subjectId, setSubjectId] = useState(''); const [date, setDate] = useState(''); const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  useEffect(() => { if (!onSetHeaderInfo) return; onSetHeaderInfo({ title: user?.role === 'instructor' ? 'Attendance reports' : 'Section attendance report', subtitle: 'Review attendance trends, late arrivals, and session records.', headerActions: <button type="button" className="btn btn-primary" onClick={() => window.print()}>Print / Save PDF</button> }); }, [onSetHeaderInfo, user?.role]);
  useEffect(() => { (async () => { try { setLoading(true); setError(''); const [nextSections, nextSessions] = await Promise.all([Api.getSections(), Api.getSessions()]); setSections(nextSections || []); setSessions(nextSessions || []); setSectionId((current) => current || String(nextSections?.[0]?.id || '')); } catch (loadError) { setError(loadError.message || 'Unable to load attendance reports.'); } finally { setLoading(false); } })(); }, []);
  const selectedSection = sections.find((section) => String(section.id) === String(sectionId));
  const subjects = selectedSection?.subjects || [];
  const filteredSessions = useMemo(() => sessions.filter((session) => { const detail = session.schedule_details || {}; return (!sectionId || String(detail.section || session.section) === String(sectionId)) && (!subjectId || String(detail.subject) === String(subjectId)) && (!date || session.date === date) && (!status || session.status === status); }), [sessions, sectionId, subjectId, date, status]);
  useEffect(() => { (async () => { if (!filteredSessions.length) { setRecords([]); return; } try { setLoading(true); const details = await Promise.all(filteredSessions.slice(0, 20).map((session) => Api.getSessionDetail(session.id).catch(() => null))); setRecords(details.flatMap((detail) => (detail?.records || []).map((record) => ({ ...record, session_date: detail.session?.date, session_id: detail.session?.id, subject_code: detail.session?.subject_code || detail.session?.schedule_details?.subject_code || '—' })))); } finally { setLoading(false); } })(); }, [filteredSessions]);
  const summary = useMemo(() => records.reduce((total, record) => ({ ...total, total: total.total + 1, present: total.present + (record.status === 'present' ? 1 : 0), late: total.late + (record.status === 'late' ? 1 : 0), absent: total.absent + (record.status === 'absent' ? 1 : 0), excused: total.excused + (record.status === 'excused' ? 1 : 0) }), { total: 0, present: 0, late: 0, absent: 0, excused: 0 }), [records]);
  const rate = summary.total ? Math.round(((summary.present + summary.late + summary.excused) / summary.total) * 100) : 0;
  const reset = () => { setSectionId(String(sections[0]?.id || '')); setSubjectId(''); setDate(''); setStatus(''); };
  return <div className="page-content teacher-report-page"><section className="teacher-report-filter card"><div><span className="eyebrow"><Filter size={14} /> Report filters</span><h2>Attendance performance</h2></div><div className="teacher-report-controls"><label>Section<select className="form-select" value={sectionId} onChange={(event) => { setSectionId(event.target.value); setSubjectId(''); }}><option value="">All assigned sections</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label><label>Subject<select className="form-select" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">All subjects</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.code} — {subject.name}</option>)}</select></label><label>Date<input className="form-control" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Session<select className="form-select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All sessions</option><option value="open">Open</option><option value="closed">Finalized</option></select></label><button type="button" className="btn btn-outline btn-sm" onClick={reset}>Reset</button></div></section>
    {error && <div className="ui-recovery-banner" role="alert">{error}</div>}
    <section className="report-stat-grid mb-3" aria-label="Attendance overview">
      <article className="report-stat-card report-rate-card">
        <span className="eyebrow"><Users size={14} /> Attendance overview</span>
        <strong>{rate}%</strong>
        <small>attendance rate</small>
        <div className="report-rate-bar" role="progressbar" aria-valuenow={rate} aria-valuemin={0} aria-valuemax={100} aria-label="Attendance rate"><span style={{ width: `${rate}%` }} /></div>
      </article>
      <ReportStat icon={Calendar} tone="slate" value={filteredSessions.length} label="Sessions" note="Matching your filters" />
      <ReportStat icon={CheckCircle2} tone="green" value={summary.present} label="Present" total={summary.total} />
      <ReportStat icon={Clock} tone="amber" value={summary.late} label="Late" total={summary.total} />
      <ReportStat icon={XCircle} tone="red" value={summary.absent} label="Absent" total={summary.total} />
      <ReportStat icon={FileText} tone="blue" value={summary.excused} label="Excused" total={summary.total} />
    </section>
    <section className="card teacher-report-table"><div className="teacher-card-heading"><div><span className="eyebrow"><Calendar size={14} /> {filteredSessions.length} matching session{filteredSessions.length === 1 ? '' : 's'}</span><h2>Student attendance records</h2></div><span className="text-muted" style={{ fontSize: '12px' }}>Showing up to 20 sessions</span></div><div className="table-container"><table><thead><tr><th>Student</th><th>Student ID</th><th>Subject</th><th>Session date</th><th>Status</th><th>Time marked</th></tr></thead><tbody>{loading ? <TableLoadingRow colSpan={6} label="Loading attendance records…" /> : !records.length ? <tr><td colSpan="6" className="text-center text-muted">No records match these filters.</td></tr> : records.map((record) => { const student = record.student_details || record.student_info || {}; return <tr key={record.id}><td><strong>{record.student_name || `${student.user?.first_name || ''} ${student.user?.last_name || ''}`.trim() || 'Student'}</strong></td><td>{record.student_id_number || student.student_id || '—'}</td><td><span className="badge badge-accent">{record.subject_code}</span></td><td>{record.session_date || '—'}</td><td><StatusBadge status={record.status} /></td><td>{record.recognized_at ? new Date(record.recognized_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td></tr>; })}</tbody></table></div></section></div>;
}
function StatusBadge({ status }) { const labels = { present: ['success', 'Present'], late: ['warning', 'Late'], absent: ['danger', 'Absent'], excused: ['info', 'Excused'] }; const [tone, label] = labels[status] || ['muted', status || '—']; return <span className={`badge badge-${tone}`}>{label}</span>; }

// One standalone stat card; `total` adds a share-of-records hint when provided.
function ReportStat({ icon: Icon, tone, value, label, total, note }) {
  const share = total ? `${Math.round((value / total) * 100)}% of records` : note || 'of records';
  return <article className={`report-stat-card report-tone-${tone}`}>
    <span className="report-stat-icon" aria-hidden="true"><Icon size={16} /></span>
    <strong>{value}</strong>
    <span className="report-stat-label">{label}</span>
    <small>{total !== undefined && !total ? 'No records yet' : share}</small>
  </article>;
}
