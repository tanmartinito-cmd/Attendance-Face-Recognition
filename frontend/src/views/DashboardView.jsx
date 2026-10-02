import React, { useCallback, useEffect, useState } from 'react';
import { Api } from '../api';
import { startAttendanceSession } from '../utils/startAttendance';
import DashboardAdmin from '../components/dashboard/DashboardAdmin';
import DashboardInstructor from '../components/dashboard/DashboardInstructor';
import DashboardStudent from '../components/dashboard/DashboardStudent';
import { usePageLoading } from '../ui';

const EMPTY_STATS = {
  totalInstructors: 0,
  totalStudents: 0,
  totalSubjects: 0,
  totalSections: 0,
  liveSessions: 0,
  sessionsToday: 0,
  finalizedToday: 0,
  enrolledPct: 0,
  enrolledCount: 0,
};

export default function DashboardView({ user, onNavigate, onStartSession, onSetHeaderInfo }) {
  const role = user?.role || 'admin';
  const [stats, setStats] = useState(EMPTY_STATS);
  const [sections, setSections] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [studentOverview, setStudentOverview] = useState(null);
  const [loading, setLoading] = usePageLoading(() => loadData());
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [sectionData, scheduleData, sessionData, dashboardStats] = await Promise.all([
        Api.getSections(),
        Api.getSchedules(),
        Api.getSessions(),
        Api.getDashboardStats(),
      ]);
      setSections(sectionData || []);
      setSchedules(scheduleData || []);
      setSessions(sessionData || []);
      setStats({
        totalInstructors: dashboardStats?.total_instructors || 0,
        totalStudents: dashboardStats?.total_students || 0,
        totalSubjects: dashboardStats?.total_subjects || 0,
        totalSections: dashboardStats?.total_sections || 0,
        liveSessions: dashboardStats?.open_sessions_count || 0,
        sessionsToday: dashboardStats?.sessions_today_count || 0,
        finalizedToday: dashboardStats?.sessions_today_closed || 0,
        enrolledPct: dashboardStats?.face_enrollment_pct ?? 0,
        enrolledCount: dashboardStats?.face_enrolled_count || 0,
      });
      if (role === 'student') {
        setStudentOverview(await Api.getStudentAttendanceOverview());
      }
    } catch (loadError) {
      setError(loadError.message || 'Unable to load the dashboard. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!onSetHeaderInfo) return;

    const todayStr = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    if (role === 'admin') {
      onSetHeaderInfo({
        title: 'Admin Dashboard',
        subtitle: `System overview — ${todayStr}`,
        headerActions: null,
      });
      return;
    }

    if (role === 'instructor') {
      const teacherName = `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || user?.username;
      const department = user?.instructor_profile?.department || 'Faculty';
      onSetHeaderInfo({
        title: 'Instructor Dashboard',
        subtitle: `Welcome back, ${teacherName} • Department: ${department}`,
        headerActions: (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" className="btn btn-outline" onClick={() => onNavigate('sections')} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <span>Section &amp; Schedule</span>
            </button>
            <button type="button" className="btn btn-outline" onClick={() => onNavigate('section_report')} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <span>Attendance Reports</span>
            </button>
          </div>
        ),
      });
      return;
    }

    const course = user?.student_profile?.course || 'Student';
    onSetHeaderInfo({
      title: 'My Dashboard',
      subtitle: `Your attendance overview — ${course}`,
      headerActions: (
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="btn btn-outline" onClick={() => onNavigate('sections')} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span>My Schedule</span>
          </button>
          <button type="button" className="btn btn-outline" onClick={() => onNavigate('session_logs')} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span>Full Record</span>
          </button>
        </div>
      ),
    });
  }, [role, user?.id, user?.first_name, user?.last_name, user?.username, user?.instructor_profile?.department, user?.student_profile?.course, onNavigate, onSetHeaderInfo]);

  const startAttendanceForSchedule = async (schedule) => {
    try {
      const session = await startAttendanceSession(schedule.id); // asks Present / Late when starting late
      if (!session) return;
      setSessions((current) => [session, ...current.filter((item) => String(item.id) !== String(session.id))]);
      onStartSession?.(session);
    } catch (startError) {
      setError(startError.message || 'Failed to start attendance.');
    }
  };

  const recoveryBanner = error ? (
    <div className="ui-recovery-banner" role="alert">
      <span>{error}</span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={loadData}>Try again</button>
    </div>
  ) : null;

  if (loading) {
    return <div className="page-content ui-page-loading" role="status">Loading your dashboard…</div>;
  }

  if (role === 'admin') {
    return <>{recoveryBanner}<DashboardAdmin stats={stats} sessions={sessions} sections={sections} onNavigate={onNavigate} /></>;
  }

  if (role === 'instructor') {
    return <>{recoveryBanner}<DashboardInstructor stats={stats} sections={sections} schedules={schedules} sessions={sessions} onNavigate={onNavigate} onStartSession={onStartSession} onStartSchedule={startAttendanceForSchedule} /></>;
  }

  return <>{recoveryBanner}<DashboardStudent user={user} studentOverview={studentOverview} onNavigate={onNavigate} /></>;
}
