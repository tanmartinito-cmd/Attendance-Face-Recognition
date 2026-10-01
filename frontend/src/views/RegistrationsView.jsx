import React, { useCallback, useEffect, useState } from 'react';
import { Check, UserPlus, X } from 'lucide-react';
import { Api } from '../api';
import Toast from '../components/shared/Toast';
import Avatar from '../components/shared/Avatar';
import Tabs from '../components/shared/Tabs';
import { confirmAction, EmptyTableRow, ModalBackdrop, TableLoadingRow } from '../ui';

const STATUS_TABS = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
];

const EMPTY_COPY = {
  pending: ['No pending registrations', 'New student and faculty sign-ups appear here for your approval.'],
  approved: ['No approved registrations yet', 'Registrations you approve are listed here.'],
  rejected: ['No rejected registrations', 'Registrations you reject are listed here with the reason.'],
};

function fullName(r) {
  return [r.first_name, r.last_name].filter(Boolean).join(' ') || r.username;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

/** Admin: approve or reject public sign-ups (students and faculty). */
export default function RegistrationsView({ onSetHeaderInfo, onNavigate }) {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    onSetHeaderInfo?.({ title: 'Registrations', subtitle: 'Approve new student and faculty accounts', headerActions: null });
  }, [onSetHeaderInfo]);

  const load = useCallback(async (which = status) => {
    try {
      setLoading(true);
      const data = await Api.getRegistrations(which);
      setRows(data.results || []);
      setCounts(data.counts || {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(status); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const approve = async (row) => {
    const ok = await confirmAction({
      title: `Approve ${fullName(row)}?`,
      message: row.role === 'student'
        ? 'The student can sign in and will be asked to enroll their face. Assign their section and subjects in Class Sections.'
        : 'The faculty member can sign in. Assign their subjects in Subjects.',
      details: `${row.role === 'student' ? `Student ID ${row.student_id}` : `Faculty ID ${row.faculty_id}`} · ${row.email}`,
      confirmLabel: 'Approve',
    });
    if (!ok) return;
    try {
      const data = await Api.approveRegistration(row.user_id);
      setCounts(data.counts);
      setRows((prev) => prev.filter((r) => r.user_id !== row.user_id));
      setSuccess(`${fullName(row)} approved.`);
    } catch (err) {
      setError(err.message);
    }
  };

  const submitReject = async (event) => {
    event.preventDefault();
    try {
      setBusy(true);
      const data = await Api.rejectRegistration(rejecting.user_id, reason);
      setCounts(data.counts);
      setRows((prev) => prev.filter((r) => r.user_id !== rejecting.user_id));
      setSuccess(`${fullName(rejecting)} rejected.`);
      setRejecting(null);
      setReason('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const tabs = STATUS_TABS.map((t) => ({ ...t, label: `${t.label} (${counts[t.id] || 0})` }));
  const [emptyTitle, emptyMessage] = EMPTY_COPY[status];
  const colSpan = status === 'pending' ? 5 : 6;

  return (
    <div className="page-content">
      <Toast message={success} type="success" onClose={() => setSuccess('')} />
      <Toast message={error} type="error" onClose={() => setError('')} />

      <Tabs idPrefix="registrations" label="Registration status" tabs={tabs} active={status} onChange={setStatus} />

      <div className="card">
        <div className="table-container" style={{ border: 'none', margin: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Role &amp; ID</th>
                <th>Program / Department</th>
                <th>Submitted</th>
                {status !== 'pending' && <th>{status === 'rejected' ? 'Reason' : 'Reviewed'}</th>}
                <th style={{ textAlign: 'right' }}>{status === 'pending' ? 'Decision' : 'By'}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <TableLoadingRow colSpan={colSpan} label="Loading registrations…" />
                : rows.length === 0 ? <EmptyTableRow colSpan={colSpan} icon={UserPlus} title={emptyTitle} message={emptyMessage} />
                  : rows.map((row) => (
                    <tr key={row.user_id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <Avatar name={fullName(row)} size={34} />
                          <div><strong>{fullName(row)}</strong><div className="text-muted" style={{ fontSize: '12px' }}>{row.email}</div></div>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${row.role === 'student' ? 'badge-neutral' : 'badge-info'}`}>{row.role === 'student' ? 'Student' : 'Faculty'}</span>
                        <div><code>{row.student_id || row.faculty_id}</code></div>
                      </td>
                      <td>
                        {row.role === 'student'
                          ? <>{row.program?.code} · {row.course?.code}<div className="text-muted" style={{ fontSize: '12px' }}>Year {row.year_level}</div></>
                          : row.department || <span className="text-muted">—</span>}
                      </td>
                      <td>{formatDate(row.submitted_at)}</td>
                      {status !== 'pending' && <td>{status === 'rejected' ? row.rejection_reason : formatDate(row.reviewed_at)}</td>}
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {status === 'pending' ? (
                          <div style={{ display: 'inline-flex', gap: '6px' }}>
                            <button type="button" className="btn btn-success btn-sm" onClick={() => approve(row)}><Check size={14} aria-hidden="true" /> Approve</button>
                            <button type="button" className="btn btn-outline btn-sm" style={{ color: 'var(--danger)' }} onClick={() => { setRejecting(row); setReason(''); }}><X size={14} aria-hidden="true" /> Reject</button>
                          </div>
                        ) : (row.reviewed_by || '—')}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>

      {status === 'approved' && rows.length > 0 && (
        <p className="text-muted" style={{ fontSize: '12px', marginTop: '10px' }}>
          Next step: enroll approved students in their sections from{' '}
          <button type="button" className="btn-link" onClick={() => onNavigate?.('sections')}>Class Sections</button>.
        </p>
      )}

      {rejecting && (
        <ModalBackdrop onClose={() => !busy && setRejecting(null)} busy={busy} role="dialog" aria-modal="true" aria-labelledby="reject-title"
          style={{ alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}>
          <form className="modal-card" style={{ maxWidth: '460px', width: '100%' }} onSubmit={submitReject}>
            <div className="modal-header"><h3 className="modal-title" id="reject-title">Reject {fullName(rejecting)}?</h3></div>
            <div className="modal-body" style={{ padding: '20px' }}>
              <label className="form-label" htmlFor="reject-reason">Reason (shown to the person when they sign in) *</label>
              <textarea id="reject-reason" className="form-control" rows={3} maxLength={300} value={reason}
                onChange={(e) => setReason(e.target.value)} placeholder="e.g. Student ID does not match our records." autoFocus />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setRejecting(null)} disabled={busy}>Cancel</button>
              <button type="submit" className="btn btn-danger" disabled={busy || reason.trim().length < 3}>{busy ? 'Rejecting…' : 'Reject'}</button>
            </div>
          </form>
        </ModalBackdrop>
      )}
    </div>
  );
}
