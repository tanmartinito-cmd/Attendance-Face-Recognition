import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock } from 'lucide-react';

/**
 * Asked when an instructor starts attendance after the scheduled time:
 *
 *   const choice = await askLateStartChoice({ minutes_late: 60, scheduled_start: '18:00', late_threshold_minutes: 15 });
 *   // { start_mode: 'present' }  or  { start_mode: 'late', reason: '…' }  or  null (cancelled)
 *
 * "Present" is the default: the delay was the instructor's, so the late clock starts now.
 */

let hostHandler = null;

export function askLateStartChoice(details = {}) {
  if (!hostHandler) return Promise.resolve({ start_mode: 'present' });
  return new Promise((resolve) => hostHandler({ details, resolve }));
}

function formatClock(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (Number.isNaN(h)) return hhmm || '';
  return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function LateStartHost() {
  const [request, setRequest] = useState(null);
  const [mode, setMode] = useState('present');
  const [reason, setReason] = useState('');
  const firstRef = useRef(null);

  useEffect(() => {
    const handler = (next) => { setMode('present'); setReason(''); setRequest(next); };
    hostHandler = handler;
    return () => { if (hostHandler === handler) hostHandler = null; };
  }, []);

  useEffect(() => { if (request) firstRef.current?.focus(); }, [request]);

  useEffect(() => {
    if (!request) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') { request.resolve(null); setRequest(null); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [request]);

  if (!request) return null;
  const { minutes_late: minutesLate = 0, scheduled_start: scheduledStart, late_threshold_minutes: grace = 15 } = request.details;
  const finish = (value) => { request.resolve(value); setRequest(null); };
  const canStart = mode === 'present' || reason.trim().length >= 3;

  const submit = (event) => {
    event.preventDefault();
    if (!canStart) return;
    finish(mode === 'present' ? { start_mode: 'present' } : { start_mode: 'late', reason: reason.trim() });
  };

  return createPortal(
    <div className="confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) finish(null); }}>
      <form className="confirm-dialog late-start-dialog" role="dialog" aria-modal="true" aria-labelledby="late-start-title" aria-describedby="late-start-desc" onSubmit={submit}>
        <div className="confirm-dialog-body">
          <h2 id="late-start-title"><Clock size={18} aria-hidden="true" /> Starting attendance {minutesLate} min late</h2>
          <p id="late-start-desc">
            This class was scheduled at <strong>{formatClock(scheduledStart)}</strong>. How should students be counted?
          </p>
          <fieldset className="late-start-options">
            <legend className="sr-only">Attendance mode</legend>
            <label className={`late-start-option${mode === 'present' ? ' selected' : ''}`}>
              <input ref={firstRef} type="radio" name="late-start-mode" value="present" checked={mode === 'present'} onChange={() => setMode('present')} />
              <span>
                <strong>Present (recommended)</strong>
                <span className="text-muted">The late start is not the students' fault. Students scanned in the next {grace} minutes are Present; after that, Late.</span>
              </span>
            </label>
            <label className={`late-start-option${mode === 'late' ? ' selected' : ''}`}>
              <input type="radio" name="late-start-mode" value="late" checked={mode === 'late'} onChange={() => setMode('late')} />
              <span>
                <strong>Late, with a reason</strong>
                <span className="text-muted">Every student scanned in this session is marked Late. The reason is saved on each record.</span>
              </span>
            </label>
          </fieldset>
          {mode === 'late' && (
            <div className="form-group" style={{ marginTop: '10px' }}>
              <label className="form-label" htmlFor="late-start-reason">Reason <span aria-hidden="true">*</span></label>
              <textarea id="late-start-reason" className="form-control" rows={2} minLength={3} maxLength={300} required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Example: Class started at 6:00 PM; attendance opened after the quiz" />
            </div>
          )}
        </div>
        <div className="confirm-dialog-footer">
          <button type="button" className="btn btn-outline" onClick={() => finish(null)}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!canStart}>Start attendance</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export default LateStartHost;
