import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SectionsView from '../views/SectionsView';
import { Api } from '../api';

vi.mock('../api', () => ({
  Api: {
    getSections: vi.fn(),
    getSchedules: vi.fn(),
    getPrograms: vi.fn(),
    getCourses: vi.fn(),
    getProgramSections: vi.fn(),
    getSessions: vi.fn(),
    startSession: vi.fn(),
    getSectionEnrollments: vi.fn(),
    getStudents: vi.fn(),
    enrollStudent: vi.fn(),
    unenrollStudent: vi.fn(),
  },
}));
vi.mock('../components/shared/ActionPopover', () => ({ default: ({ items }) => <div>{items.filter((item) => !item.isDivider).map((item) => <button type="button" key={item.label} disabled={item.disabled} title={item.title} onClick={item.onClick}>{item.label}</button>)}</div> }));
vi.mock('../components/shared/Toast', () => ({ default: ({ message }) => message ? <div role="status">{message}</div> : null }));
vi.mock('../components/sections/AddSectionModal', () => ({ default: () => null }));
vi.mock('../components/sections/EditSectionModal', () => ({ default: () => null }));
vi.mock('../components/sections/TimetableGrid', () => ({ default: () => <div data-testid="timetable" /> }));
vi.mock('../components/sections/SectionDetailModal', () => ({ default: ({ section, enrollStudentId, onStudentChange, enrollType, enrollSubjectId, onEnrollTypeChange, onEnrollSubjectChange, onEnrollStudent }) => section ? (
  <div data-testid="section-detail">
    <select aria-label="student" value={enrollStudentId} onChange={onStudentChange}><option value="">Choose</option><option value="10">Student 10</option></select>
    <select aria-label="scope" value={enrollType} onChange={(event) => onEnrollTypeChange(event.target.value)}><option value="regular">regular</option><option value="irregular">irregular</option></select>
    <select aria-label="subject" value={enrollSubjectId} onChange={(event) => onEnrollSubjectChange(event.target.value)}><option value="">Select subject</option><option value="5">CS201</option></select>
    <button type="button" onClick={() => onEnrollStudent({ preventDefault: vi.fn() })}>Enroll Student</button>
  </div>
) : null }));

function configureApi() {
  Api.getSections.mockResolvedValue([{ id: 1, name: 'CS-1A', course: 'BSIT', school_year: '2025-2026', semester: '1st', student_count: 2, subjects: [{ id: 5, code: 'CS201', name: 'Data Structures', student_count: 2 }] }]);
  Api.getSchedules.mockResolvedValue([]);
  Api.getPrograms.mockResolvedValue([]);
  Api.getCourses.mockResolvedValue([]);
  Api.getProgramSections.mockResolvedValue([]);
  Api.getSessions.mockResolvedValue([]);
  Api.getSectionEnrollments.mockResolvedValue([]);
  Api.getStudents.mockResolvedValue([{ id: 10, student_id: 'STU-10' }]);
  Api.enrollStudent.mockResolvedValue({ id: 99 });
}

describe('sections and roster feature workflow', () => {
  beforeEach(() => vi.clearAllMocks());
  it('loads a section roster and rejects irregular enrollment without a subject', async () => {
    configureApi();
    render(<SectionsView user={{ role: 'admin' }} onNavigate={vi.fn()} onSetHeaderInfo={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => expect(screen.getByTestId('section-detail')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('student'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('subject'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enroll Student' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Please select a target subject.');
    expect(Api.enrollStudent).not.toHaveBeenCalled();
  });

  it('sends the selected subject for an irregular enrollment and refreshes the roster', async () => {
    configureApi();
    render(<SectionsView user={{ role: 'admin' }} onNavigate={vi.fn()} onSetHeaderInfo={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => expect(screen.getByTestId('section-detail')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('student'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enroll Student' }));

    await waitFor(() => expect(Api.enrollStudent).toHaveBeenCalledWith(1, '10', '5'));
    expect(Api.getSectionEnrollments).toHaveBeenCalledTimes(2);
  });
});


describe('instructor schedule attendance actions', () => {
  it('gives each subject schedule its own attendance action and disables it before class starts', async () => {
    const today = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];
    Api.getSections.mockResolvedValue([{ id: 1, name: 'CS-1A', course: 'BSIT', school_year: '2025-2026', semester: '1st', subjects: [{ id: 5, code: 'CS201', name: 'Data Structures', student_count: 1 }, { id: 6, code: 'CS202', name: 'Networks', student_count: 2 }] }]);
    Api.getSchedules.mockResolvedValue([{ id: 101, section: 1, subject: 5, day_of_week: today, start_time: '23:59:00', end_time: '23:59:59' }, { id: 102, section: 1, subject: 6, day_of_week: today, start_time: '00:00:00', end_time: '23:59:59' }]);
    Api.getPrograms.mockResolvedValue([]); Api.getCourses.mockResolvedValue([]); Api.getProgramSections.mockResolvedValue([]); Api.getSessions.mockResolvedValue([]); Api.getStudents.mockResolvedValue([]);
    Api.startSession.mockResolvedValue({ id: 501, schedule: 102, status: 'open' });
    const onStartSession = vi.fn();

    render(<SectionsView user={{ role: 'instructor' }} onNavigate={vi.fn()} onStartSession={onStartSession} onSetHeaderInfo={vi.fn()} />);

    const unavailable = await screen.findByRole('button', { name: 'Available at 11:59 PM' });
    expect(unavailable).toBeDisabled();
    expect(unavailable).toHaveAttribute('title', 'This class has not started yet. Attendance opens at 11:59 PM.');
    fireEvent.click(unavailable);
    expect(Api.startSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Start Attendance' }));
    await waitFor(() => expect(Api.startSession).toHaveBeenCalledWith(102));
    expect(onStartSession).toHaveBeenCalledWith(expect.objectContaining({ id: 501, schedule: 102 }));
  });
});