import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RegisterView from '../views/RegisterView';
import RegistrationsView from '../views/RegistrationsView';
import LoginView from '../views/LoginView';
import FaceEnrollmentGateView from '../views/FaceEnrollmentGateView';
import { Api } from '../api';

vi.mock('../api', () => ({
  Api: {
    getRegisterOptions: vi.fn(), register: vi.fn(), getRegistrations: vi.fn(),
    approveRegistration: vi.fn(), rejectRegistration: vi.fn(), login: vi.fn(), enrollOwnFace: vi.fn(),
    checkEnrollFrame: vi.fn(), getPrograms: vi.fn(), getCourses: vi.fn(),
  },
}));
vi.mock('../ui', async (orig) => ({ ...(await orig()), confirmAction: vi.fn(() => Promise.resolve(true)) }));
vi.mock('../components/faceCapture/FaceCaptureStage', () => ({
  default: () => <div data-testid="capture-stage" />,
  FaceGuidanceChecklist: () => null,
}));

const OPTIONS = {
  programs: [{ id: 1, code: 'CITEC', name: 'Computing' }, { id: 2, code: 'CBA', name: 'Business' }],
  courses: [{ id: 10, code: 'BSIT', name: 'BS IT', program: 1 }, { id: 20, code: 'BSA', name: 'BS Accountancy', program: 2 }],
  turnstile_site_key: '',
};
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

async function fillStudent() {
  render(<RegisterView onBackToLogin={vi.fn()} />);
  await screen.findByRole('option', { name: 'CITEC - Computing' });
  type('Student ID *', '23100000777');
  type('Given Name (First Name) *', 'ANA');
  type('Family Name (Last Name) *', 'REYES');
  type('Date of Birth *', '2000-01-01');
  type('Place of Birth *', 'MANILA');
  fireEvent.change(screen.getAllByLabelText(/Mobile Number/)[0], { target: { value: '09123456789' } });
  type('Personal Email Address *', 'ana@gmail.com');
  type('Academic Program *', '1');
  type('Degree Course *', '10');
  type('Year Level *', '2');
  fireEvent.change(screen.getAllByLabelText(/Account Password/)[0], { target: { value: 'Strong-Pass-2026!' } });
  fireEvent.change(screen.getAllByLabelText(/Confirm Password/)[0], { target: { value: 'Strong-Pass-2026!' } });
}

describe('RegisterView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Api.getRegisterOptions.mockResolvedValue(OPTIONS);
    Api.getPrograms.mockResolvedValue(OPTIONS.programs);
    Api.getCourses.mockResolvedValue(OPTIONS.courses);
  });

  it('shows only the courses of the chosen program', async () => {
    render(<RegisterView onBackToLogin={vi.fn()} />);
    await screen.findByRole('option', { name: 'CITEC - Computing' });
    const courseSelect = screen.getByLabelText('Degree Course *');
    expect(courseSelect).toBeDisabled();
    type('Academic Program *', '2');
    await waitFor(() => expect(screen.getByRole('option', { name: 'BSA - BS Accountancy' })).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: 'BSIT - BS IT' })).toBeNull();
  });

  it('submits the student registration', async () => {
    Api.register.mockResolvedValue({ success: true });
    await fillStudent();
    fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));
    await waitFor(() => expect(Api.register).toHaveBeenCalledWith(expect.objectContaining({
      role: 'student', student_id: '23100000777', course_ref: 10, program: 'CITEC', face_consent: true,
    })));
    expect(await screen.findByText('Registration submitted')).toBeInTheDocument();
  });

  it('faculty registration has no course', async () => {
    Api.register.mockResolvedValue({ success: true });
    render(<RegisterView onBackToLogin={vi.fn()} />);
    await screen.findByRole('option', { name: 'CITEC - Computing' });
    fireEvent.click(screen.getByRole('radio', { name: 'Faculty' }));
    expect(screen.queryByLabelText('Degree Course *')).toBeNull();
    type('Faculty ID *', 'FAC-0099');
    type('Given Name (First Name) *', 'JUAN');
    type('Family Name (Last Name) *', 'CRUZ');
    type('Date of Birth *', '1980-01-01');
    type('Place of Birth *', 'MANILA');
    fireEvent.change(screen.getAllByLabelText(/Mobile Number/)[0], { target: { value: '09123456789' } });
    type('Personal Email Address *', 'juan@gmail.com');
    fireEvent.change(screen.getAllByLabelText(/Account Password/)[0], { target: { value: 'Strong-Pass-2026!' } });
    fireEvent.change(screen.getAllByLabelText(/Confirm Password/)[0], { target: { value: 'Strong-Pass-2026!' } });
    fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));
    await waitFor(() => expect(Api.register).toHaveBeenCalledWith(expect.objectContaining({ role: 'instructor', faculty_id: 'FAC-0099' })));
  });

  it('shows the server error for a taken Student ID', async () => {
    Api.register.mockRejectedValue(Object.assign(new Error('This Student ID already has an account.'), { field: 'student_id' }));
    await fillStudent();
    fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));
    expect(await screen.findByText(/Student ID already has an account/i)).toBeInTheDocument();
  });
});

describe('LoginView pending registration', () => {
  it('shows an info message instead of an error', async () => {
    Api.login.mockRejectedValue(Object.assign(new Error('Your registration is waiting for administrator approval.'), { code: 'registration_pending' }));
    const onRegister = vi.fn();
    render(<LoginView onLoginSuccess={vi.fn()} onRegister={onRegister} />);
    fireEvent.change(screen.getByLabelText(/Username/), { target: { value: '23100000777' } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'Strong-Pass-2026!' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('status')).toHaveTextContent('waiting for administrator approval');
    fireEvent.click(screen.getByRole('button', { name: /create an account/i }));
    expect(onRegister).toHaveBeenCalled();
  });
});

describe('RegistrationsView', () => {
  const row = {
    user_id: 5, role: 'student', username: '23100000777', first_name: 'Ana', last_name: 'Reyes', email: 'ana@gmail.com',
    student_id: '23100000777', program: { code: 'CITEC' }, course: { code: 'BSIT' }, year_level: 2, status: 'pending',
    submitted_at: '2026-10-01T05:00:00Z',
  };
  beforeEach(() => {
    vi.clearAllMocks();
    Api.getRegistrations.mockResolvedValue({ results: [row], counts: { pending: 1, approved: 0, rejected: 0 } });
  });

  it('approves a pending registration', async () => {
    Api.approveRegistration.mockResolvedValue({ counts: { pending: 0, approved: 1, rejected: 0 } });
    render(<RegistrationsView onSetHeaderInfo={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /approve/i }));
    await waitFor(() => expect(Api.approveRegistration).toHaveBeenCalledWith(5));
    expect(await screen.findByText('No pending registrations')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Approved (1)' })).toBeInTheDocument();
  });

  it('rejecting requires a reason', async () => {
    Api.rejectRegistration.mockResolvedValue({ counts: { pending: 0, approved: 0, rejected: 1 } });
    render(<RegistrationsView onSetHeaderInfo={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /^reject$/i }));
    const submit = screen.getAllByRole('button', { name: /^reject$/i }).find((b) => b.type === 'submit');
    expect(submit).toBeDisabled();
    fireEvent.change(document.getElementById('reject-reason'), { target: { value: 'Unknown Student ID' } });
    fireEvent.click(submit);
    await waitFor(() => expect(Api.rejectRegistration).toHaveBeenCalledWith(5, 'Unknown Student ID'));
  });
});

describe('FaceEnrollmentGateView', () => {
  it('has no skip, only sign out', () => {
    const onSignOut = vi.fn();
    render(<FaceEnrollmentGateView user={{ first_name: 'Ana', last_name: 'Reyes' }} onEnrolled={vi.fn()} onSignOut={onSignOut} />);
    expect(screen.getByRole('heading', { name: /enroll your face to continue/i })).toBeInTheDocument();
    expect(screen.getByText(/will not be recognized in class/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /skip|later|close/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalled();
  });
});
