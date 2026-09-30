import React from 'react';
import {
  Contact,
  GraduationCap,
  BookOpen,
  Building,
  Radio,
  CalendarCheck,
  Lock,
  ScanFace,
} from 'lucide-react';

/**
 * DashboardStats - Reusable statistics grid component
 * Displays KPI cards for dashboard metrics
 */
export default function DashboardStats({ stats, variant = 'admin' }) {
  if (variant === 'admin') {
    return (
      <>
        {/* Primary KPIs */}
        <div className="stats-grid mb-3">
          <div className="stat-card blue">
            <div className="stat-icon blue"><Contact size={20} /></div>
            <div className="stat-info">
              <div className="value">{stats.totalInstructors}</div>
              <div className="label">Faculty</div>
            </div>
          </div>

          <div className="stat-card green">
            <div className="stat-icon green"><GraduationCap size={20} /></div>
            <div className="stat-info">
              <div className="value">{stats.totalStudents}</div>
              <div className="label">Students</div>
            </div>
          </div>

          <div className="stat-card yellow">
            <div className="stat-icon yellow"><BookOpen size={20} /></div>
            <div className="stat-info">
              <div className="value">{stats.totalSubjects}</div>
              <div className="label">Subjects</div>
            </div>
          </div>

          <div className="stat-card red">
            <div className="stat-icon red"><Building size={20} /></div>
            <div className="stat-info">
              <div className="value">{stats.totalSections}</div>
              <div className="label">Class Sections</div>
            </div>
          </div>
        </div>

        {/* Today's operations */}
        <div className="stats-grid mb-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="stat-card" style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-xs)' }}>
            <div className="stat-icon" style={{ background: 'var(--success-light)', color: 'var(--success)' }}>
              <Radio size={18} />
            </div>
            <div className="stat-info">
              <div className="value">{stats.liveSessions}</div>
              <div className="label">Live Sessions Now</div>
            </div>
          </div>

          <div className="stat-card" style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-xs)' }}>
            <div className="stat-icon" style={{ background: 'var(--info-light)', color: 'var(--info)' }}>
              <CalendarCheck size={18} />
            </div>
            <div className="stat-info">
              <div className="value">{stats.sessionsToday}</div>
              <div className="label">Sessions Today</div>
            </div>
          </div>

          <div className="stat-card" style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-xs)' }}>
            <div className="stat-icon" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
              <Lock size={18} />
            </div>
            <div className="stat-info">
              <div className="value">{stats.finalizedToday}</div>
              <div className="label">Finalized Today</div>
            </div>
          </div>

          <div className="stat-card" style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-xs)' }}>
            <div className="stat-icon" style={{ background: 'var(--warning-light)', color: 'var(--warning)' }}>
              <ScanFace size={18} />
            </div>
            <div className="stat-info">
              <div className="value">{stats.enrolledPct}%</div>
              <div className="label">Face Enrolled ({stats.enrolledCount}/{stats.totalStudents})</div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return null;
}
