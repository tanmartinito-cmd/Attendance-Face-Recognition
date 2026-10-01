import React, { useState } from 'react';
import { Check, KeyRound, X } from 'lucide-react';
import { Api } from '../../api';
import PasswordInput from './PasswordInput';
import { checkPasswordCriteria } from '../../utils/validation';

const EMPTY = { current: '', next: '', confirm: '' };

function LiveCheck({ ok, okText, badText, id }) {
  const Icon = ok ? Check : X;
  return (
    <div
      id={id}
      role="status"
      aria-live="polite"
      style={{
        marginTop: '6px', fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px',
        color: ok ? '#16a34a' : '#dc2626',
      }}
    >
      <Icon size={13} style={{ strokeWidth: 2.5 }} aria-hidden="true" />
      <span>{ok ? okText : badText}</span>
    </div>
  );
}

/**
 * Change your own password (every role). Same strict rules as the server:
 * 8+ chars, upper, lower, digit, symbol; must differ from the current one; confirmation must match.
 * On success every device is signed out, so `onSignedOut` sends the user to the sign-in page.
 */
export default function ChangePasswordCard({ onSignedOut }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const strong = checkPasswordCriteria(form.next).isStrong;
  const differs = !form.next || form.next !== form.current;
  const matches = form.confirm.length > 0 && form.confirm === form.next;
  const canSubmit = Boolean(form.current) && strong && differs && matches && !submitting;

  const update = (key) => (event) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
    setError('');
    setErrorField(null);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    try {
      setSubmitting(true);
      await Api.changePassword({ currentPassword: form.current, newPassword: form.next, confirmPassword: form.confirm });
      setForm(EMPTY);
      setDone(true);
      // Give the user a moment to read the message, then send them to sign in again.
      setTimeout(() => onSignedOut?.(), 2500);
    } catch (err) {
      setError(err.message || 'Failed to change password.');
      setErrorField(err.field || null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="card" aria-labelledby="change-password-title">
      <div className="card-header">
        <span id="change-password-title" className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <KeyRound size={16} aria-hidden="true" /> Change password
        </span>
      </div>
      <div className="card-body">
        {done ? (
          <div className="alert alert-success" role="status">
            Password changed. You have been signed out on every device. Please sign in again with your new password.
          </div>
        ) : (
          <form onSubmit={submit} noValidate style={{ maxWidth: '460px' }}>
            {error && errorField !== 'current_password' && (
              <div className="alert alert-danger" role="alert" style={{ marginBottom: '14px' }}>{error}</div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="current-password">Current password *</label>
              <PasswordInput
                id="current-password"
                name="current-password"
                value={form.current}
                onChange={update('current')}
                placeholder="Enter your current password"
                autoComplete="current-password"
                showStrength={false}
                required
              />
              {errorField === 'current_password' && <LiveCheck ok={false} badText={error} />}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="new-password">New password *</label>
              <PasswordInput
                id="new-password"
                name="new-password"
                value={form.next}
                onChange={update('next')}
                placeholder="Create a strong password"
                autoComplete="new-password"
                showStrength
                required
              />
              {form.next && !differs && (
                <LiveCheck ok={false} badText="New password must be different from your current password" />
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="confirm-password">Confirm new password *</label>
              <PasswordInput
                id="confirm-password"
                name="confirm-password"
                value={form.confirm}
                onChange={update('confirm')}
                placeholder="Type the new password again"
                autoComplete="new-password"
                showStrength={false}
                required
              />
              {form.confirm && (
                <LiveCheck id="confirm-password-status" ok={matches} okText="Passwords match" badText="Passwords do not match" />
              )}
            </div>

            <p className="text-muted" style={{ fontSize: '12px', margin: '4px 0 14px' }}>
              After changing it you will be signed out on every device, including this one.
            </p>
            <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
              {submitting ? 'Changing…' : 'Change password'}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
