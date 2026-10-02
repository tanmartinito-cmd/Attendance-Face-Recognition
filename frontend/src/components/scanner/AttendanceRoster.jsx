import React from 'react';
import { PageLoader } from '../../ui';
import { CheckCircle2, Search, User } from 'lucide-react';

export default function AttendanceRoster({ records, filteredRecords, loading, searchQuery, onSearchChange, justMarkedId, presentCount, lateCount, onManualMark }) {
  return <div className="card roster-card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
    <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
      <strong>Students ({records.length})</strong>
      <span className="badge badge-success" aria-live="polite"><CheckCircle2 size={12} /> Present: {presentCount + lateCount}</span>
    </div>
    <div style={{ padding: '8px 14px', background: 'var(--bg-secondary)' }}>
      <label htmlFor="scanner-roster-search" className="sr-only">Search enrolled students</label>
      <div style={{ position: 'relative' }}>
        <Search size={13} aria-hidden="true" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
        <input id="scanner-roster-search" className="form-control filter-control" placeholder="Search student name or ID" value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} style={{ paddingLeft: '28px' }} />
      </div>
    </div>
    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
      {loading ? <PageLoader label="Loading section roster…" compact /> : filteredRecords.length === 0 ? <div className="text-center text-muted">No students match this search.</div> : filteredRecords.map((record) => <RosterItem key={record.id || record.student} record={record} justMarked={justMarkedId === (record.student || record.student_details?.id)} onManualMark={onManualMark} />)}
    </div>
  </div>;
}

function RosterItem({ record, justMarked, onManualMark }) {
  const student = record.student_details || record.student_info || {};
  const name = record.student_name || (student.user ? `${student.user.first_name || ''} ${student.user.last_name || ''}`.trim() : '') || 'Student';
  const studentId = record.student || student.id;
  const marked = record.status === 'present' || record.status === 'late';
  return <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', marginBottom: '6px', borderRadius: 'var(--radius)', background: justMarked ? 'rgba(16,185,129,.18)' : marked ? 'rgba(16,185,129,.08)' : 'var(--bg-card)', border: '1px solid var(--border)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><User size={16} aria-hidden="true" /><div><strong>{name}</strong><div className="text-muted" style={{ fontSize: '11px' }}>{record.student_id_number || student.student_id || '—'}</div>{record.status === 'late' && record.remarks && <div className="text-muted" style={{ fontSize: '10.5px' }}>{record.remarks}</div>}</div></div>
    {marked ? <span className={`badge ${record.status === 'late' ? 'badge-warning' : 'badge-success'}`}>{record.status}</span> : <div style={{ display: 'flex', gap: '4px' }}><button type="button" className="btn btn-outline btn-sm" onClick={() => onManualMark(studentId, 'present')} aria-label={`Mark ${name} present`}>Present</button><button type="button" className="btn btn-outline btn-sm" onClick={() => onManualMark(studentId, 'late')} aria-label={`Mark ${name} late`}>Late</button></div>}
  </div>;
}
