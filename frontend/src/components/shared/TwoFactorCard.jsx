import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, Download, ShieldCheck, Smartphone } from 'lucide-react';
import { Api } from '../../api';
import PasswordInput from './PasswordInput';

const onlyDigits = (value) => value.replace(/\D/g, '').slice(0, 6);
const groupKey = (secret = '') => secret.replace(/(.{4})/g, '$1 ').trim();

function CodeInput({ id, label, value, onChange, allowBackup = false }) {
  return (
    <div className="form-group">
      <label className="form-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="form-control"
        value={value}
        onChange={(e) => onChange(allowBackup ? e.target.value : onlyDigits(e.target.value))}
        inputMode={allowBackup ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        maxLength={allowBackup ? 20 : 6}
        placeholder={allowBackup ? '123456 or abcde-fghjk' : '123456'}
        style={{ maxWidth: '220px', letterSpacing: allowBackup ? undefined : '0.3em', fontSize: '16px' }}
      />
    </div>
  );
}

function BackupCodes({ codes, onDone }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = `AttendFR backup codes (each works once)\n\n${codes.join('\n')}\n`;

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'attendfr-backup-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="alert alert-warning" role="note" style={{ fontSize: '13px' }}>
        <AlertTriangle size={15} aria-hidden="true" style={{ marginRight: '6px', verticalAlign: '-2px' }} />
        Save these backup codes somewhere safe. Each one works once if you lose your phone.
        They will not be shown again.
      </div>
      <ul className="backup-code-grid" aria-label="Backup codes">
        {codes.map((code) => <li key={code}><code>{code}</code></li>)}
      </ul>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '12px 0' }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={copy}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} {copied ? 'Copied' : 'Copy all'}
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={download}>
          <Download size={14} aria-hidden="true" /> Download .txt
        </button>
      </div>
      <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px', marginBottom: '12px' }}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I saved my backup codes
      </label>
      <button type="button" className="btn btn-primary" disabled={!saved} onClick={onDone}>Done</button>
    </div>
  );
}

/**
 * Optional two-step sign-in with an authenticator app (any role).
 * States: off -> setup (QR + confirm code) -> backup codes -> on (new codes / turn off).
 */
export default function TwoFactorCard() {
  const [status, setStatus] = useState(null);
  const [mode, setMode] = useState('view'); // view | setup | codes | disable | regenerate
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState([]);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    try { setStatus(await Api.getTwoFactorStatus()); } catch (err) { setError(err.message); }
  };
  useEffect(() => { load(); }, []);

  const reset = (nextMode = 'view') => { setMode(nextMode); setCode(''); setPassword(''); setError(''); };

  const run = async (action) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (err) { setError(err.message || 'Something went wrong.'); setCode(''); } finally { setBusy(false); }
  };

  const startSetup = () => run(async () => { setSetup(await Api.startTwoFactorSetup()); reset('setup'); });
  const confirmSetup = (e) => { e.preventDefault(); run(async () => {
    const data = await Api.enableTwoFactor(code);
    setStatus(data); setCodes(data.backup_codes || []); setSetup(null); reset('codes');
  }); };
  const turnOff = (e) => { e.preventDefault(); run(async () => {
    setStatus(await Api.disableTwoFactor(password, code)); reset('view'); setNotice('Two-step sign-in is off. You now sign in with your password only.');
  }); };
  const regenerate = (e) => { e.preventDefault(); run(async () => {
    const data = await Api.regenerateBackupCodes(code);
    setStatus(data); setCodes(data.backup_codes || []); reset('codes');
  }); };

  const enabled = Boolean(status?.enabled);

  return (
    <section className="card" aria-labelledby="two-factor-title">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span id="two-factor-title" className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Smartphone size={16} aria-hidden="true" /> Two-step sign-in
        </span>
        {status && <span className={`badge ${enabled ? 'badge-success' : 'badge-neutral'}`}>{enabled ? 'On' : 'Off'}</span>}
      </div>
      <div className="card-body" style={{ maxWidth: '620px' }}>
        {error && <div className="alert alert-danger" role="alert" style={{ marginBottom: '12px' }}>{error}</div>}
        {notice && <div className="alert alert-success" role="status" style={{ marginBottom: '12px' }}>{notice}</div>}

        {!status && !error && <p className="text-muted">Loading…</p>}

        {status && mode === 'view' && !enabled && (
          <>
            <p style={{ fontSize: '13px', marginTop: 0 }}>
              Add a second step when you sign in: after your password, enter a 6-digit code from an
              authenticator app on your phone (Google Authenticator, Microsoft Authenticator, or similar).
              Even if someone learns your password, they cannot sign in without your phone.
            </p>
            <button type="button" className="btn btn-primary" onClick={startSetup} disabled={busy}>
              <ShieldCheck size={15} aria-hidden="true" /> {busy ? 'Preparing…' : 'Turn on two-step sign-in'}
            </button>
          </>
        )}

        {mode === 'setup' && setup && (
          <form onSubmit={confirmSetup} noValidate>
            <ol className="two-factor-steps">
              <li>Install an authenticator app on your phone (Google Authenticator or Microsoft Authenticator).</li>
              <li>In the app, tap <strong>+</strong> and scan this QR code.</li>
            </ol>
            <img src={setup.qr_svg} alt="QR code to add AttendFR to your authenticator app" width="180" height="180" className="two-factor-qr" />
            <p style={{ fontSize: '12px' }} className="text-muted">
              Can&apos;t scan? Enter this key in the app instead (account: {setup.account}):
              <br /><code className="two-factor-key">{groupKey(setup.secret)}</code>
            </p>
            <ol className="two-factor-steps" start={3}>
              <li>Type the 6-digit code the app shows for AttendFR.</li>
            </ol>
            <CodeInput id="two-factor-setup-code" label="6-digit code" value={code} onChange={setCode} />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Confirm and turn on'}</button>
              <button type="button" className="btn btn-outline" onClick={() => { setSetup(null); reset(); }}>Cancel</button>
            </div>
          </form>
        )}

        {mode === 'codes' && <BackupCodes codes={codes} onDone={() => { setCodes([]); reset(); }} />}

        {status && mode === 'view' && enabled && (
          <>
            <p style={{ fontSize: '13px', marginTop: 0 }}>
              <Check size={14} aria-hidden="true" style={{ color: '#16a34a', verticalAlign: '-2px' }} /> Signing in asks for a code from your authenticator app
              {status.enabled_at && <> (on since {new Date(status.enabled_at).toLocaleDateString()})</>}.
            </p>
            <p style={{ fontSize: '13px' }} className={status.backup_codes_left <= 3 ? 'text-danger' : 'text-muted'}>
              Backup codes left: <strong>{status.backup_codes_left}</strong>
              {status.backup_codes_left <= 3 && ' — get new ones so you are not locked out.'}
            </p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-outline" onClick={() => reset('regenerate')}>Get new backup codes</button>
              <button type="button" className="btn btn-outline" style={{ color: 'var(--danger)' }} onClick={() => reset('disable')}>Turn off</button>
            </div>
          </>
        )}

        {mode === 'regenerate' && (
          <form onSubmit={regenerate} noValidate>
            <p style={{ fontSize: '13px', marginTop: 0 }}>Your old backup codes will stop working.</p>
            <CodeInput id="two-factor-regen-code" label="Current 6-digit code from your app" value={code} onChange={setCode} />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>Get new codes</button>
              <button type="button" className="btn btn-outline" onClick={() => reset()}>Cancel</button>
            </div>
          </form>
        )}

        {mode === 'disable' && (
          <form onSubmit={turnOff} noValidate style={{ maxWidth: '420px' }}>
            <p style={{ fontSize: '13px', marginTop: 0 }}>To turn it off, confirm your password and a code.</p>
            <div className="form-group">
              <label className="form-label" htmlFor="two-factor-disable-password">Password</label>
              <PasswordInput id="two-factor-disable-password" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password" showStrength={false} placeholder="Your password" />
            </div>
            <CodeInput id="two-factor-disable-code" label="Code from your app (or a backup code)" value={code} onChange={setCode} allowBackup />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="submit" className="btn btn-danger" disabled={busy || !password || !code.trim()}>Turn off</button>
              <button type="button" className="btn btn-outline" onClick={() => reset()}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
