import { resolveMediaUrl } from '../../api';
import React from 'react';
import { EmptyTableRow, TableLoadingRow } from '../../ui';
import Avatar from '../shared/Avatar';
import { AlertTriangle, CheckCircle, GraduationCap, Search } from 'lucide-react';

// The Register button lives in the page header once students exist; when there are none
// it is the single button centered in the table (see ui/EmptyTableRow.jsx).
export default function StudentEnrollmentTable({ students, hasStudents = students.length > 0, loading, search, onSearchChange, onOpenFaceModal, onRegister }) {
  let emptyRow = null;
  if (!loading && students.length === 0) {
    emptyRow = hasStudents
      ? <EmptyTableRow colSpan={5} icon={GraduationCap} title="No students match your search" message="Try another name, Student ID or course." secondary={<button type="button" className="btn btn-outline" onClick={() => onSearchChange('')}>Clear search</button>} />
      : <EmptyTableRow colSpan={5} icon={GraduationCap} title="No students yet" message="Register a student first, then enroll their face for attendance." actionLabel="Register Student" onAction={onRegister} />;
  }
  return <div className="card"><div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}><span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><GraduationCap size={16} /> Registered Students <span className="badge badge-info">{students.length}</span></span>{hasStudents && <div style={{ position: 'relative' }}><Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} /><input className="form-control filter-control" placeholder="Search student or ID..." aria-label="Search students" value={search} onChange={(event) => onSearchChange(event.target.value)} style={{ paddingLeft: '32px', width: '220px', maxWidth: '100%' }} /></div>}</div><div className="table-container" style={{ border: 'none', margin: 0 }}><table><thead><tr><th>Student</th><th>Student ID</th><th>Course &amp; Year</th><th>Face Status</th><th style={{ textAlign: 'right' }}>Action</th></tr></thead><tbody>{loading ? <TableLoadingRow colSpan={5} label="Loading students…" /> : emptyRow || students.map((student) => <StudentRow key={student.id} student={student} onOpenFaceModal={onOpenFaceModal} />)}</tbody></table></div></div>;
}

function StudentRow({ student, onOpenFaceModal }) {
  const imageUrl = resolveMediaUrl(student.face_image);
  const enrolled = !!student.face_image; // Student is enrolled if they have a face image
  const name = `${student.user?.first_name || ''} ${student.user?.last_name || ''}`.trim() || student.student_id;
  return <tr><td><div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Avatar src={imageUrl} name={name} size={36} ring /><div><strong>{student.user?.first_name} {student.user?.last_name}</strong><div className="text-muted" style={{ fontSize: '11px' }}>{student.user?.email}</div></div></div></td><td><code>{student.student_id}</code></td><td><strong>{student.display_academic_program || student.course || 'BSIT'}</strong><span className="text-muted"> — Year {student.year_level || 1}</span></td><td>{enrolled ? <span className="badge badge-success"><CheckCircle size={13} /> Enrolled</span> : <span className="badge badge-warning"><AlertTriangle size={13} /> Not Enrolled</span>}</td><td style={{ textAlign: 'right' }}><button type="button" className={`btn btn-sm ${enrolled ? 'btn-outline' : 'btn-success'}`} onClick={() => onOpenFaceModal(student)}>{enrolled ? 'Re-enroll' : 'Enroll Face'}</button></td></tr>;
}
