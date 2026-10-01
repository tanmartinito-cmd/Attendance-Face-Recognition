import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FaceEnrollmentView from '../views/FaceEnrollmentView';
import { Api } from '../api';

vi.mock('../api', () => ({
  Api: { getStudents: vi.fn(), createUser: vi.fn() },
  resolveMediaUrl: (url) => url || null,
}));
vi.mock('../components/faceEnrollment/FaceEnrollmentModal', () => ({ default: () => null }));

// Without onNavigate the page falls back to the quick "Register Student" form.
async function openQuickRegister() {
  render(<FaceEnrollmentView onSetHeaderInfo={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Register Student' }));
  const fill = (label, value) => fireEvent.change(screen.getByText(label).parentElement.querySelector('input, select'), { target: { value } });
  fill('Student ID Number *', '23100000777');
  fill('First Name *', 'Ana');
  fill('Last Name *', 'Reyes');
  fill('Degree Course *', 'BSIT');
  fill('Year Level *', '1');
}

const submit = () => fireEvent.submit(document.getElementById('register-student-password').closest('form'));

describe('Face Enrollment quick register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Api.getStudents.mockResolvedValue([]);
    Api.createUser.mockResolvedValue({ id: 1 });
  });

  it('has no default password and refuses to submit without one', async () => {
    await openQuickRegister();
    expect(screen.queryByText(/student123/)).toBeNull();

    submit();

    expect(await screen.findByText('Please set a password for the student.')).toBeInTheDocument();
    expect(Api.createUser).not.toHaveBeenCalled();
  });

  it('rejects a weak password before calling the API', async () => {
    await openQuickRegister();
    fireEvent.change(document.getElementById('register-student-password'), { target: { value: 'student123' } });

    submit();

    expect(await screen.findByText(/Password must have:/)).toBeInTheDocument();
    expect(Api.createUser).not.toHaveBeenCalled();
  });

  it('sends exactly the password that was typed', async () => {
    await openQuickRegister();
    fireEvent.change(document.getElementById('register-student-password'), { target: { value: 'Str0ng!Pass' } });

    submit();

    await waitFor(() => expect(Api.createUser).toHaveBeenCalledWith(expect.objectContaining({
      role: 'student', student_id: '23100000777', password: 'Str0ng!Pass',
    })));
  });
});
