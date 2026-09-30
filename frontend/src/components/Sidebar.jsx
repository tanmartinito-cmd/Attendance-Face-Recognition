import React from 'react';
import {
  GraduationCap,
  Home,
  Award,
  Layers,
  Building,
  BookOpen,
  Calendar,
  Users,
  Camera,
  FileText,
  BarChart2,
  Settings,
  LogOut,
  X,
} from 'lucide-react';
import { confirmAction } from '../ui';

const ROLE_LABELS = { admin: 'Administrator', instructor: 'Instructor', student: 'Student' };

function NavLink({ id, label, icon: Icon, activeTab, onSelect }) {
  const isActive = activeTab === id;
  return (
    <button
      type="button"
      className={`nav-item ${isActive ? 'active' : ''}`}
      aria-current={isActive ? 'page' : undefined}
      onClick={() => onSelect(id)}
    >
      <span className="icon" aria-hidden="true"><Icon size={17} /></span>
      <span className="nav-item-label">{label}</span>
    </button>
  );
}

export default function Sidebar({ user, activeTab, setActiveTab, onLogout, isOpen, onClose }) {
  const role = user?.role || 'admin';
  const displayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || 'User';
  const initials = displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const roleLabel = ROLE_LABELS[role] || role;

  const handleSelect = (id) => {
    setActiveTab(id);
    onClose?.();
  };
  const link = (id, label, icon) => <NavLink id={id} label={label} icon={icon} activeTab={activeTab} onSelect={handleSelect} />;

  const handleSignOut = async () => {
    const ok = await confirmAction({
      title: 'Sign out?',
      message: 'You will be returned to the sign-in page. Any unsaved changes on this page will be lost.',
      details: (
        <div className="confirm-account">
          <span className="sidebar-user-avatar" aria-hidden="true">{initials}</span>
          <span>
            <strong>{displayName}</strong>
            <small>Signed in as {roleLabel}{user?.username ? ` · @${user.username}` : ''}</small>
          </span>
        </div>
      ),
      confirmLabel: 'Sign out',
      cancelLabel: 'Stay signed in',
    });
    if (ok) onLogout();
  };

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`} id="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-brand">
          <div className="sidebar-logo-icon">
            <GraduationCap size={22} />
          </div>
          <div className="sidebar-logo-text">
            <h2>AttendFR</h2>
            <p>Attendance System</p>
          </div>
        </div>
        {onClose && (
          <button type="button" className="sidebar-close-btn" onClick={onClose} aria-label="Close navigation">
            <X size={18} />
          </button>
        )}
      </div>

      <nav className="sidebar-nav" aria-label="Main navigation">
        <div className="nav-section-label">Main</div>
        {link('dashboard', 'Dashboard', Home)}

        {role === 'admin' && (
          <>
            <div className="nav-section-label">Academic Structure</div>
            {link('programs', 'Programs', Award)}
            {link('courses', 'Courses', BookOpen)}
            {link('section_catalog', 'Section Catalog', Layers)}
            {link('sections', 'Class Sections', Building)}
            {link('subjects', 'Subjects', BookOpen)}
            {link('schedules', 'Schedules', Calendar)}

            <div className="nav-section-label">Management</div>
            {link('users', 'Users', Users)}
            {link('face_enrollment', 'Face Enrollment', Camera)}

            <div className="nav-section-label">Reports</div>
            {link('section_report', 'Section Report', FileText)}
            {link('session_logs', 'Session Logs', BarChart2)}
          </>
        )}

        {role === 'instructor' && (
          <>
            <div className="nav-section-label">Teaching</div>
            {link('sections', 'Section & Schedule', Calendar)}

            <div className="nav-section-label">Reports</div>
            {link('section_report', 'Attendance Reports', FileText)}
          </>
        )}

        {role === 'student' && (
          <>
            <div className="nav-section-label">Academics</div>
            {link('sections', 'My Schedule', Calendar)}

            <div className="nav-section-label">My Attendance</div>
            {link('session_logs', 'My Records', BarChart2)}
          </>
        )}

        <div className="nav-section-label">Account</div>
        {link('profile', 'Profile', Settings)}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user-card">
          <div className="sidebar-user-avatar" aria-hidden="true">{initials}</div>
          <div className="sidebar-user-meta">
            <strong title={displayName}>{displayName}</strong>
            <span>{roleLabel}</span>
          </div>
        </div>
        <button type="button" className="nav-item nav-item-danger" onClick={handleSignOut}>
          <span className="icon" aria-hidden="true"><LogOut size={17} /></span>
          <span className="nav-item-label">Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
