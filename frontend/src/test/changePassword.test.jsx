import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChangePasswordCard from '../components/shared/ChangePasswordCard';
import { Api } from '../api';

vi.mock('../api', () => ({ Api: { changePassword: vi.fn() } }));

const type = (id, value) => fireEvent.change(document.getElementById(id), { target: { value } });
const submitButton = () => screen.getByRole('button', { name: /change password/i });

describe('ChangePasswordCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a live match / no-match indicator for the confirmation', () => {
    render(<ChangePasswordCard />);
    type('new-password', 'Brand-New-Pass-42');

    type('confirm-password', 'Brand-New');
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();

    type('confirm-password', 'Brand-New-Pass-42');
    expect(screen.getByText('Passwords match')).toBeInTheDocument();
    expect(screen.queryByText('Passwords do not match')).toBeNull();
  });

  it('keeps the button disabled until the strict rules are met', () => {
    render(<ChangePasswordCard />);
    type('current-password', 'Old-Pass-123!');
    type('new-password', 'weakpass');
    type('confirm-password', 'weakpass');
    expect(submitButton()).toBeDisabled();

    type('new-password', 'Old-Pass-123!');   // strong but same as current
    type('confirm-password', 'Old-Pass-123!');
    expect(screen.getByText(/must be different/)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    type('new-password', 'Brand-New-Pass-42');
    type('confirm-password', 'Brand-New-Pass-42');
    expect(submitButton()).toBeEnabled();
  });

  it('submits, then signs the user out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Api.changePassword.mockResolvedValue({ success: true });
    const onSignedOut = vi.fn();
    render(<ChangePasswordCard onSignedOut={onSignedOut} />);
    type('current-password', 'Old-Pass-123!');
    type('new-password', 'Brand-New-Pass-42');
    type('confirm-password', 'Brand-New-Pass-42');
    fireEvent.click(submitButton());

    expect(await screen.findByText(/Please sign in again with your new password/)).toBeInTheDocument();
    expect(Api.changePassword).toHaveBeenCalledWith({
      currentPassword: 'Old-Pass-123!', newPassword: 'Brand-New-Pass-42', confirmPassword: 'Brand-New-Pass-42',
    });
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(onSignedOut).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('shows the server error under the current password field', async () => {
    const err = Object.assign(new Error('Current password is incorrect.'), { field: 'current_password' });
    Api.changePassword.mockRejectedValue(err);
    render(<ChangePasswordCard />);
    type('current-password', 'Wrong-Pass-1!');
    type('new-password', 'Brand-New-Pass-42');
    type('confirm-password', 'Brand-New-Pass-42');
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByText('Current password is incorrect.')).toBeInTheDocument());
  });
});
