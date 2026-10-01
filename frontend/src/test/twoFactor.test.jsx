import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TwoFactorCard from '../components/shared/TwoFactorCard';
import LoginView from '../views/LoginView';
import Tabs, { TabPanel } from '../components/shared/Tabs';
import { Api } from '../api';

vi.mock('../api', () => ({
  Api: {
    getTwoFactorStatus: vi.fn(),
    startTwoFactorSetup: vi.fn(),
    enableTwoFactor: vi.fn(),
    disableTwoFactor: vi.fn(),
    regenerateBackupCodes: vi.fn(),
    login: vi.fn(),
    loginTwoFactor: vi.fn(),
  },
}));

const CODES = Array.from({ length: 10 }, (_, i) => `abcde-fgh${i}k`);

describe('TwoFactorCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets up with a QR code, confirms a code, then shows backup codes once', async () => {
    Api.getTwoFactorStatus.mockResolvedValue({ enabled: false, backup_codes_left: 0 });
    Api.startTwoFactorSetup.mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP', qr_svg: 'data:image/svg+xml,<svg/>', account: 'me@gmail.com', issuer: 'AttendFR',
    });
    Api.enableTwoFactor.mockResolvedValue({ enabled: true, backup_codes_left: 10, backup_codes: CODES });
    render(<TwoFactorCard />);

    fireEvent.click(await screen.findByRole('button', { name: /turn on two-step sign-in/i }));
    expect(await screen.findByAltText(/QR code/)).toHaveAttribute('src', 'data:image/svg+xml,<svg/>');
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();

    const input = screen.getByLabelText('6-digit code');
    fireEvent.change(input, { target: { value: '12a34 56' } });
    expect(input).toHaveValue('123456'); // digits only
    fireEvent.click(screen.getByRole('button', { name: /confirm and turn on/i }));

    await waitFor(() => expect(Api.enableTwoFactor).toHaveBeenCalledWith('123456'));
    expect(await screen.findByText(CODES[0])).toBeInTheDocument();
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toBeDisabled(); // must confirm the codes were saved
    fireEvent.click(screen.getByLabelText('I saved my backup codes'));
    fireEvent.click(done);
    expect(screen.queryByText(CODES[0])).toBeNull();
    expect(screen.getByText('On')).toBeInTheDocument();
  });

  it('turning off needs the password and a code', async () => {
    Api.getTwoFactorStatus.mockResolvedValue({ enabled: true, backup_codes_left: 2, enabled_at: '2026-10-01T00:00:00Z' });
    Api.disableTwoFactor.mockResolvedValue({ enabled: false, backup_codes_left: 0 });
    render(<TwoFactorCard />);

    expect(await screen.findByText(/get new ones so you are not locked out/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    const submit = screen.getAllByRole('button', { name: 'Turn off' }).find((b) => b.type === 'submit');
    expect(submit).toBeDisabled();
    fireEvent.change(document.getElementById('two-factor-disable-password'), { target: { value: 'My-Pass-123!' } });
    fireEvent.change(screen.getByLabelText(/Code from your app/), { target: { value: 'abcde-fghjk' } });
    fireEvent.click(submit);
    await waitFor(() => expect(Api.disableTwoFactor).toHaveBeenCalledWith('My-Pass-123!', 'abcde-fghjk'));
    expect(await screen.findByText(/Two-step sign-in is off/)).toBeInTheDocument();
  });
});

describe('LoginView two-step sign-in', () => {
  beforeEach(() => vi.clearAllMocks());

  const signInWithPassword = async () => {
    fireEvent.change(document.getElementById('id_username'), { target: { value: '23100000450' } });
    fireEvent.change(document.getElementById('id_password'), { target: { value: 'My-Pass-123!' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
  };

  it('asks for the code after a correct password, then signs in', async () => {
    Api.login.mockResolvedValue({ twoFactorRequired: true, challenge: 'signed-challenge' });
    Api.loginTwoFactor.mockResolvedValue({ user: { username: '23100000450' } });
    const onLoginSuccess = vi.fn();
    render(<LoginView onLoginSuccess={onLoginSuccess} />);
    await signInWithPassword();

    expect(await screen.findByText('Two-step sign-in')).toBeInTheDocument();
    fireEvent.change(document.getElementById('id_otp'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and sign in/i }));
    await waitFor(() => expect(Api.loginTwoFactor).toHaveBeenCalledWith('signed-challenge', '654321'));
    expect(onLoginSuccess).toHaveBeenCalledWith({ username: '23100000450' });
  });

  it('can use a backup code, and an expired challenge goes back to the password step', async () => {
    Api.login.mockResolvedValue({ twoFactorRequired: true, challenge: 'old' });
    Api.loginTwoFactor.mockRejectedValue(Object.assign(new Error('This sign-in expired.'), { code: 'challenge_expired' }));
    render(<LoginView onLoginSuccess={vi.fn()} />);
    await signInWithPassword();

    fireEvent.click(await screen.findByRole('button', { name: /use a backup code/i }));
    fireEvent.change(document.getElementById('id_otp'), { target: { value: 'abcde-fghjk' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and sign in/i }));
    expect(await screen.findByText('This sign-in expired.')).toBeInTheDocument();
    expect(document.getElementById('id_password')).toBeInTheDocument();
  });
});

describe('Tabs', () => {
  it('switches panels by click and arrow keys', () => {
    const tabs = [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }];
    function Demo() {
      const [tab, setTab] = React.useState('a');
      return <><Tabs idPrefix="t" tabs={tabs} active={tab} onChange={setTab} />
        <TabPanel idPrefix="t" id="a" active={tab}>Panel A</TabPanel>
        <TabPanel idPrefix="t" id="b" active={tab}>Panel B</TabPanel></>;
    }
    render(<Demo />);
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel A');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Alpha' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel B');
    fireEvent.click(screen.getByRole('tab', { name: 'Alpha' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel A');
  });
});
