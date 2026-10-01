import React, { useState, useEffect, useCallback } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { Api, TokenStorage } from './api';
import { startLiveSync, stopLiveSync } from './liveSync';
import {
  DEFAULT_TAB, TAB_PATHS, isTabAllowed, pathForTab, pathFromLegacyHash, tabFromPath,
} from './routes';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import LoginView from './views/LoginView';
import DashboardView from './views/DashboardView';
import ProgramsView from './views/ProgramsView';
import CoursesView from './views/CoursesView';
import SectionCatalogView from './views/SectionCatalogView';
import SectionsView from './views/SectionsView';
import SubjectsView from './views/SubjectsView';
import SchedulesView from './views/SchedulesView';
import UsersView from './views/UsersView';
import FaceEnrollmentView from './views/FaceEnrollmentView';
import SectionReportView from './views/SectionReportView';
import ReportsView from './views/ReportsView';
import ProfileView from './views/ProfileView';
import StudentProfileView from './views/StudentProfileView';
import LiveScannerView from './views/LiveScannerView';
import StudentEnrollmentView from './views/StudentEnrollmentView';
import FaceEnrollmentGateView from './views/FaceEnrollmentGateView';
import { GlobalLoader, ConfirmHost, PageLoader } from './ui';

/**
 * Route guard: only renders the page when the signed-in role may open it.
 * The backend enforces the same rules on the data; this keeps the UI clean
 * when someone types an admin URL as a student.
 */
function RequireRole({ tab, user, children }) {
  if (!isTabAllowed(tab, user)) {
    return <Navigate to={pathForTab(DEFAULT_TAB)} replace />;
  }
  return children;
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(TokenStorage.getUser());
  const [loading, setLoading] = useState(true);
  // The URL is the source of truth for the current page.
  const routeTab = tabFromPath(location.pathname);
  const activeTab = routeTab && isTabAllowed(routeTab, user) ? routeTab : DEFAULT_TAB;
  const [activeSessionId, setActiveSessionId] = useState(() => {
    try {
      return localStorage.getItem('attendfr_active_session_id') || null;
    } catch {
      return null;
    }
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Header details set by the current page; tagged with the tab that set them so
  // a new page never shows the previous page's subtitle/actions.
  const [headerInfo, setHeaderInfo] = useState({
    tab: null,
    title: '',
    subtitle: '',
    headerActions: null,
  });

  // While signed in, keep every open screen equal to the database (silent live sync).
  const signedInId = user?.id ?? user?.username ?? null;
  useEffect(() => {
    if (!signedInId) return undefined;
    startLiveSync();
    return () => stopLiveSync();
  }, [signedInId]);

  // Old "/#/users" bookmarks -> "/users"
  useEffect(() => {
    const legacyPath = pathFromLegacyHash(location.hash);
    if (legacyPath) navigate(legacyPath, { replace: true });
  }, [location.hash, navigate]);

  useEffect(() => {
    async function checkAuth() {
      const cachedUser = TokenStorage.getUser();

      // A saved profile means an httpOnly session cookie may exist. The access token lives
      // only in memory, so the first call silently renews it from the cookie.
      if (cachedUser) {
        setUser(cachedUser); // optimistic: no login flash while the session is restored
        try {
          const profile = await Api.getMe();
          setUser(profile);
          TokenStorage.set(null, profile);
        } catch {
          // Session rejected (profile cleared) -> login screen; offline -> keep the cached user.
          if (!TokenStorage.getUser()) setUser(null);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    }
    checkAuth();
  }, []);

  const getTitle = useCallback((tab) => {
    switch (tab) {
      case 'dashboard':
        return user?.role === 'admin'
          ? 'Admin Dashboard'
          : user?.role === 'instructor'
          ? 'Instructor Dashboard'
          : 'My Dashboard';
      case 'programs':
        return 'Academic Programs';
      case 'courses':
        return 'Courses';
      case 'section_catalog':
        return 'Section Catalog (Master List)';
      case 'sections':
        return user?.role === 'student'
          ? 'My Schedule'
          : user?.role === 'instructor'
          ? 'Sections & Schedules'
          : 'Class Sections';
      case 'subjects':
        return 'Subjects';
      case 'schedules':
        return 'Schedules';
      case 'users':
        return 'Users';
      case 'face_enrollment':
        return 'Select Student to Enroll';
      case 'student_enrollment':
        return 'Student Admission & Enrollment';
      case 'section_report':
        return user?.role === 'instructor' ? 'Attendance Reports' : 'Section Attendance Report';
      case 'session_logs':
        return user?.role === 'student' ? 'My Records' : 'Session Logs';
      case 'profile':
        return 'My Profile';
      case 'scanner':
        return 'Live Attendance';
      default:
        return 'AttendFR';
    }
  }, [user?.role]);

  // Bound to the current tab: each page only ever updates its own header.
  const updateHeaderInfo = useCallback((info) => {
    const tab = activeTab;
    setHeaderInfo((prev) => {
      const base = prev.tab === tab ? prev : { tab, title: '', subtitle: '', headerActions: null };
      if (
        base === prev &&
        prev.title === info.title &&
        prev.subtitle === info.subtitle &&
        prev.headerActions === info.headerActions
      ) {
        return prev;
      }
      return { ...base, ...info, tab };
    });
  }, [activeTab]);

  // Views call onNavigate('tab_id'); this turns it into a real URL (history + back button work).
  const handleTabChange = useCallback((requestedTab, principal = user) => {
    const newTab = isTabAllowed(requestedTab, principal) ? requestedTab : DEFAULT_TAB;
    const path = pathForTab(newTab);
    if (location.pathname !== path) navigate(path);
  }, [location.pathname, navigate, user]);

  const currentHeader = headerInfo.tab === activeTab
    ? headerInfo
    : { title: '', subtitle: '', headerActions: null };

  const handleStartSession = useCallback((sec) => {
    const secId = sec?.id || null;
    setActiveSessionId(secId);
    try {
      if (secId) {
        localStorage.setItem('attendfr_active_session_id', String(secId));
      } else {
        localStorage.removeItem('attendfr_active_session_id');
      }
    } catch {
      // ignore
    }
    handleTabChange('scanner');
  }, [handleTabChange]);

  // Stay on the URL the user asked for (e.g. a /users deep link); the route guard
  // sends them to the dashboard if their role may not open it.
  const handleLoginSuccess = (userData) => {
    setUser(userData);
  };

  // After the required face enrollment: reload the profile so the normal app opens.
  const refreshUser = useCallback(async () => {
    try {
      const profile = await Api.getMe();
      TokenStorage.set(null, profile);
      setUser(profile);
    } catch {
      setUser((current) => (current ? { ...current, face_enrollment_required: false } : current));
    }
  }, []);

  const handleLogout = () => {
    Api.logout();
    try {
      localStorage.removeItem('attendfr_active_tab'); // left over from the old hash router
      localStorage.removeItem('attendfr_active_session_id');
    } catch {
      // ignore
    }
    setUser(null);
    setActiveSessionId(null);
    navigate('/', { replace: true });
  };

  const guarded = (tab, element) => (
    <Route key={tab} path={TAB_PATHS[tab]} element={<RequireRole tab={tab} user={user}>{element}</RequireRole>} />
  );

  // Global overlays stay mounted at one stable position for every role and
  // screen (boot, login, app) so confirmations always use the in-app dialog.
  let screen;
  if (loading) {
    screen = (
      <div className="app-boot-screen">
        <div className="app-boot-brand">AttendFR</div>
        <PageLoader label="Preparing your workspace…" hint="Checking your session" />
      </div>
    );
  } else if (!user) {
    screen = location.pathname === '/register'
      ? <div className="app-boot-screen">
          <div className="app-boot-brand">AttendFR</div>
          <PageLoader label="Redirecting..." hint="Public registration disabled" />
        </div>
      : <LoginView onLoginSuccess={handleLoginSuccess} />;
  } else if (user.face_enrollment_required) {
    // Required, cannot be skipped (the server also refuses other requests until it is done).
    screen = <FaceEnrollmentGateView user={user} onEnrolled={refreshUser} onSignOut={handleLogout} />;
  } else {
    screen = renderApp();
  }

  return (
    <>
      <GlobalLoader />
      <ConfirmHost />
      {screen}
    </>
  );

  function renderApp() {
  return (
    <div className="app-layout">
      {/* Sidebar Navigation (100% copycat of templates/base.html) */}
      <Sidebar
        user={user}
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        onLogout={handleLogout}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Backdrop for Mobile Drawer */}
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          style={{ display: 'block' }}
        />
      )}

      {/* Main Content Area */}
      <main className="main-content">
        <Header
          title={currentHeader.title || getTitle(activeTab)}
          subtitle={currentHeader.subtitle}
          headerActions={currentHeader.headerActions}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />

        <div style={{ minHeight: 'calc(100vh - 64px)' }}>
          <Routes>
            <Route path="/" element={<Navigate to={pathForTab(DEFAULT_TAB)} replace />} />

            {guarded('dashboard', (
              <DashboardView
                user={user}
                onNavigate={handleTabChange}
                onSetHeaderInfo={updateHeaderInfo}
                onStartSession={handleStartSession}
              />
            ))}
            {guarded('programs', <ProgramsView user={user} onSetHeaderInfo={updateHeaderInfo} />)}
            {guarded('courses', <CoursesView user={user} onSetHeaderInfo={updateHeaderInfo} />)}
            {guarded('section_catalog', (
              <SectionCatalogView user={user} onNavigate={handleTabChange} onSetHeaderInfo={updateHeaderInfo} />
            ))}
            {guarded('sections', (
              <SectionsView
                user={user}
                onNavigate={handleTabChange}
                onSetHeaderInfo={updateHeaderInfo}
                onStartSession={handleStartSession}
              />
            ))}
            {guarded('subjects', <SubjectsView user={user} onSetHeaderInfo={updateHeaderInfo} />)}
            {guarded('schedules', <SchedulesView user={user} onSetHeaderInfo={updateHeaderInfo} />)}
            {guarded('users', <UsersView user={user} onNavigate={handleTabChange} onSetHeaderInfo={updateHeaderInfo} />)}
            {guarded('face_enrollment', (
              <FaceEnrollmentView user={user} onNavigate={handleTabChange} onSetHeaderInfo={updateHeaderInfo} />
            ))}
            {guarded('student_enrollment', (
              <StudentEnrollmentView user={user} onNavigate={handleTabChange} onSetHeaderInfo={updateHeaderInfo} />
            ))}
            {guarded('section_report', <SectionReportView user={user} onSetHeaderInfo={updateHeaderInfo} />)}
            {guarded('session_logs', (
              <ReportsView
                user={user}
                onNavigate={handleTabChange}
                onSetHeaderInfo={updateHeaderInfo}
                onStartSession={handleStartSession}
              />
            ))}
            {guarded('profile', user?.role === 'student'
              ? <StudentProfileView user={user} onUserUpdated={setUser} onSetHeaderInfo={updateHeaderInfo} onSignedOut={handleLogout} />
              : <ProfileView user={user} onUserUpdated={setUser} onSetHeaderInfo={updateHeaderInfo} onSignedOut={handleLogout} />)}
            {guarded('scanner', (
              <LiveScannerView
                user={user}
                onNavigate={handleTabChange}
                onSetHeaderInfo={updateHeaderInfo}
                activeSessionId={activeSessionId}
              />
            ))}

            {/* Unknown URLs */}
            <Route path="*" element={<Navigate to={pathForTab(DEFAULT_TAB)} replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
  }
}
