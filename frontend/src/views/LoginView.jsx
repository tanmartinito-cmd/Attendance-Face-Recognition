import React, { useState } from 'react';
import { GraduationCap, AlertCircle } from 'lucide-react';
import { Api } from '../api';
import PasswordInput from '../components/shared/PasswordInput';

export default function LoginView({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingNotice, setPendingNotice] = useState(''); // registration waiting for approval
  // Two-step sign-in: set after a correct password when the account has it turned on.
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Please enter both username and password.');
      return;
    }

    setLoading(true);
    setError('');
    setPendingNotice('');

    try {
      const result = await Api.login(username, password);
      if (result.twoFactorRequired) {
        setChallenge(result.challenge);
        setCode('');
        setUseBackup(false);
        return;
      }
      onLoginSuccess(result.user);
    } catch (err) {
      if (err.code === 'registration_pending') setPendingNotice(err.message);
      else setError(err.message || 'Incorrect username or password.');
    } finally {
      setLoading(false);
    }
  };

  const backToPassword = (message = '') => {
    setChallenge(null);
    setCode('');
    setPassword('');
    setError(message);
  };

  const handleCode = async (e) => {
    e.preventDefault();
    const value = code.trim();
    if (!value) {
      setError(useBackup ? 'Enter one of your backup codes.' : 'Enter the 6-digit code from your app.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { user } = await Api.loginTwoFactor(challenge, value);
      onLoginSuccess(user);
    } catch (err) {
      if (err.code === 'challenge_expired') backToPassword(err.message);
      else { setError(err.message || 'That code is not correct.'); setCode(''); }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon">
            <GraduationCap size={28} />
          </div>
          <h1>AttendFR</h1>
          <p>Facial Recognition Attendance System</p>
        </div>

        {error && (
          <div
            className="alert alert-danger"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '16px',
              padding: '10px 14px',
              fontSize: '13px',
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {pendingNotice && (
          <div className="alert alert-info" role="status" style={{ marginBottom: '16px', fontSize: '13px' }}>
            {pendingNotice}
          </div>
        )}

        {challenge ? (
          <form onSubmit={handleCode} id="two-factor-form" noValidate>
            <h2 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 4px' }}>Two-step sign-in</h2>
            <p className="text-muted" style={{ fontSize: '13px', margin: '0 0 16px' }}>
              {useBackup
                ? 'Enter one of the backup codes you saved when you turned on two-step sign-in.'
                : 'Open your authenticator app and enter the 6-digit code for AttendFR.'}
            </p>
            <div className="form-group">
              <div className="floating-field">
                <input
                  key={useBackup ? 'backup' : 'totp'}
                  type="text"
                  id="id_otp"
                  className="floating-input"
                  placeholder=" "
                  value={code}
                  onChange={(e) => setCode(useBackup ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode={useBackup ? 'text' : 'numeric'}
                  autoComplete="one-time-code"
                  maxLength={useBackup ? 20 : 6}
                  autoFocus
                  required
                  style={useBackup ? undefined : { letterSpacing: '0.35em', fontSize: '18px' }}
                />
                <label className="floating-label" htmlFor="id_otp">
                  {useBackup ? 'Backup code (e.g. abcde-fghjk)' : '6-digit code'}
                </label>
              </div>
            </div>
            <button
              type="submit"
              className="btn btn-primary w-full btn-lg"
              disabled={loading || (!useBackup && code.length !== 6)}
              style={{ justifyContent: 'center', marginTop: '8px', display: 'flex' }}
            >
              {loading ? 'Verifying…' : 'Verify and sign in'}
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '14px', fontSize: '13px' }}>
              <button type="button" className="btn-link" onClick={() => { setUseBackup((v) => !v); setCode(''); setError(''); }}>
                {useBackup ? 'Use authenticator code' : 'Use a backup code'}
              </button>
              <button type="button" className="btn-link" onClick={() => backToPassword()}>Back</button>
            </div>
          </form>
        ) : (
        <form onSubmit={handleSubmit} id="login-form">
          <div className="form-group">
            <div className="floating-field">
              <input
                type="text"
                id="id_username"
                className="floating-input"
                placeholder=" "
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
              <label className="floating-label" htmlFor="id_username">
                Username, Faculty ID, or Student ID
              </label>
            </div>
          </div>

          <div className="form-group">
            <PasswordInput
              id="id_password"
              floatingLabel="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              showStrength={false}
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            id="btn-login"
            className="btn btn-primary w-full btn-lg"
            disabled={loading}
            style={{
              justifyContent: 'center',
              marginTop: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {loading ? (
              <>
                <span>Signing In...</span>
              </>
            ) : (
              <>
                <span>Sign In</span>
              </>
            )}
          </button>
        </form>
        )}
      </div>
    </div>
  );
}
