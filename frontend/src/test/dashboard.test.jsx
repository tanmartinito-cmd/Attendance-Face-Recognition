import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import DashboardView from '../views/DashboardView';
import { Api } from '../api';

vi.mock('../api', () => ({
  Api: {
    getSections: vi.fn(),
    getSchedules: vi.fn(),
    getSessions: vi.fn(),
    getDashboardStats: vi.fn(),
    getStudentAttendanceOverview: vi.fn(),
  },
}));

vi.mock('../components/dashboard/DashboardAdmin', () => ({ default: ({ stats }) => <div data-testid="admin-dashboard">admin:{stats.totalStudents}</div> }));
vi.mock('../components/dashboard/DashboardInstructor', () => ({ default: ({ sections }) => <div data-testid="teacher-dashboard">teacher:{sections.length}</div> }));
vi.mock('../components/dashboard/DashboardStudent', () => ({ default: ({ studentOverview }) => <div data-testid="student-dashboard">student:{studentOverview?.overall_stats?.rate ?? 'loading'}</div> }));

describe('Dashboard feature workflow', () => {
  it.each([
    ['admin', 'admin-dashboard'],
    ['instructor', 'teacher-dashboard'],
    ['student', 'student-dashboard'],
  ])('routes the %s role to its dashboard', async (role, testId) => {
    Api.getSections.mockResolvedValue([{ id: 1 }]);
    Api.getSchedules.mockResolvedValue([{ id: 2 }]);
    Api.getSessions.mockResolvedValue([{ id: 3 }]);
    Api.getDashboardStats.mockResolvedValue({ total_students: 42 });
    Api.getStudentAttendanceOverview.mockResolvedValue({ overall_stats: { rate: 96 } });

    render(<DashboardView user={{ role }} onNavigate={vi.fn()} onSetHeaderInfo={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument());
    expect(Api.getSections).toHaveBeenCalledOnce();
    expect(Api.getSchedules).toHaveBeenCalledOnce();
    expect(Api.getSessions).toHaveBeenCalledOnce();
    expect(Api.getDashboardStats).toHaveBeenCalledOnce();
    if (role === 'student') expect(Api.getStudentAttendanceOverview).toHaveBeenCalledOnce();
    else expect(Api.getStudentAttendanceOverview).not.toHaveBeenCalled();
  });
});


  it('shows a retryable error instead of silently rendering empty data', async () => {
    Api.getSections.mockRejectedValue(new Error('Network unavailable'));
    Api.getSchedules.mockResolvedValue([]);
    Api.getSessions.mockResolvedValue([]);
    Api.getDashboardStats.mockResolvedValue({});

    render(<DashboardView user={{ role: 'admin' }} onNavigate={vi.fn()} onSetHeaderInfo={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
