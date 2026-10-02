import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { useUnsavedChangesGuard } from '../../ui';

export default function ReopenSessionModal({ session, isOpen, loading, error, onClose, onConfirm }) {
  if (!isOpen) return null;
  return <ReopenSessionDialog session={session} loading={loading} error={error} onClose={onClose} onConfirm={onConfirm} />;
}

function ReopenSessionDialog({ session, loading, error, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const inputRef = useRef(null);
  const pressedOnBackdropRef = useRef(false);
  const { containerRef, requestClose, isPrompting } = useUnsavedChangesGuard(onClose, { busy: loading });

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !isPrompting() && !document.querySelector('.confirm-backdrop')) requestClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [requestClose, isPrompting]);

  const section = session?.schedule_details?.section_name || session?.section_name || 'this class';
  const subject = session?.schedule_details?.subject_code || session?.subject_code || 'Attendance';

  const submit = (event) => {
    event.preventDefault();
    const trimmedReason = reason.trim();
    if (trimmedReason) onConfirm(trimmedReason);
  };

  return (
    <div
      ref={containerRef}
      className="app-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => { pressedOnBackdropRef.current = event.target === event.currentTarget; }}
      onClick={(event) => { if (event.target === event.currentTarget && pressedOnBackdropRef.current) requestClose(); }}
    >
      <section className="app-modal reopen-modal" role="dialog" aria-modal="true" aria-labelledby="reopen-session-title" aria-describedby="reopen-session-description">
        <header className="app-modal-header">
          <div>
            <span className="modal-eyebrow">Attendance audit</span>
            <h2 id="reopen-session-title">Reopen attendance session</h2>
          </div>
          <button type="button" className="icon-button" onClick={requestClose} disabled={loading} aria-label="Cancel reopen attendance"><X size={18} /></button>
        </header>
        <form onSubmit={submit}>
          <div className="app-modal-body">
            <p id="reopen-session-description">You are reopening <strong>{subject}</strong> for <strong>{section}</strong>. Students scanned after reopening are marked <strong>Late</strong>, and this reason is saved on their record. Students already marked keep their status. This action is recorded with your name, time, and reason.</p>
            <label className="form-label" htmlFor="reopen-reason">Reason for reopening <span aria-hidden="true">*</span></label>
            <textarea
              ref={inputRef}
              id="reopen-reason"
              className="form-control"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Example: Late-arriving students"
              minLength={3}
              maxLength={300}
              required
              disabled={loading}
            />
            <p className="form-help">Reopening is available only during the scheduled class time.</p>
            {error && <p className="modal-error" role="alert"><AlertCircle size={16} /> {error}</p>}
          </div>
          <footer className="app-modal-footer">
            <button type="button" className="btn btn-secondary" onClick={requestClose} disabled={loading}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading || reason.trim().length < 3}>
              {loading ? 'Reopening…' : 'Reopen session'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
