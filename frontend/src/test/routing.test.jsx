import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { isTabAllowed, pathForTab, pathFromLegacyHash, tabFromPath } from '../routes';

// Lightweight stand-ins so the routing test does not depend on every page's API calls.
const stub = (name) => ({ default: ({ onNavigate }) => (
  <div data-testid={`view-${name}`}>
    {onNavigate && <button onClick={() => onNavigate('users')}>go users</button>}
  </div>
) });
vi.mock('../views/DashboardView', () => stub('dashboard'));
vi.mock('../views/ProgramsView', () => stub('programs'));
vi.mock('../views/CoursesView', () => stub('courses'));
vi.mock('../views/SectionCatalogView', () => stub('section_catalog'));
vi.mock('../views/SectionsView', () => stub('sections'));
vi.mock('../views/SubjectsView', () => stub('subjects'));
vi.mock('../views/SchedulesView', () => stub('schedules'));
vi.mock('../views/UsersView', () => stub('users'));
vi.mock('../views/FaceEnrollmentView', () => stub('face_enrollment'));
vi.mock('../views/StudentEnrollmentView', () => stub('student_enrollment'));
vi.mock('../views/SectionReportView', () => stub('section_report'));
vi.mock('../views/ReportsView', () => stub('session_logs'));
vi.mock('../views/ProfileView', () => stub('profile'));
vi.mock('../views/StudentProfileView', () => stub('student_profile'));
vi.mock('../views/LiveScannerView', () => stub('scanner'));
vi.mock('../views/LoginView', () => ({ default: () => <div data-testid="view-login" /> }));
vi.mock('../components/Sidebar', () => ({ default: () => <nav /> }));
vi.mock('../components/Header', () => ({ default: ({ title }) => <h1>{title}</h1> }));

const mockUser = { current: null };
vi.mock('../api', () => ({
  Api: {
    getMe: vi.fn(() => (mockUser.current ? Promise.resolve(mockUser.current) : Promise.reject(new Error('no')))),
    logout: vi.fn(),
  },
  TokenStorage: {
    getUser: () => mockUser.current,
    getAccess: () => (mockUser.current ? 'token' : null),
    set: vi.fn(),
    clear: vi.fn(),
  },
}));

const { default: App } = await import('../App');

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.hash}</div>;
}

function renderAt(url, role) {
  mockUser.current = role ? { username: 'u', role } : null;
  return render(
    <MemoryRouter initialEntries={[url]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('route helpers', () => {
  it('maps tabs and paths both ways', () => {
    expect(pathForTab('face_enrollment')).toBe('/face-enrollment');
    expect(tabFromPath('/face-enrollment')).toBe('face_enrollment');
    expect(tabFromPath('/users/')).toBe('users');
    expect(tabFromPath('/nope')).toBeNull();
    expect(pathForTab('nope')).toBe('/dashboard');
  });

  it('converts old hash links to new paths', () => {
    expect(pathFromLegacyHash('#/users')).toBe('/users');
    expect(pathFromLegacyHash('#/face_enrollment')).toBe('/face-enrollment');
    expect(pathFromLegacyHash('#/section-report')).toBe('/section-report');
    expect(pathFromLegacyHash('#/unknown')).toBeNull();
    expect(pathFromLegacyHash('')).toBeNull();
  });

  it('applies role rules', () => {
    expect(isTabAllowed('users', { role: 'admin' })).toBe(true);
    expect(isTabAllowed('users', { role: 'student' })).toBe(false);
    expect(isTabAllowed('scanner', { role: 'teacher' })).toBe(true);
    expect(isTabAllowed('scanner', { role: 'admin' })).toBe(false);
    expect(isTabAllowed('dashboard', null)).toBe(false);
  });
});

describe('App routing', () => {
  beforeEach(() => {
    mockUser.current = null;
  });

  it('renders the page for a clean URL', async () => {
    renderAt('/users', 'admin');
    expect(await screen.findByTestId('view-users')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/users');
  });

  it('redirects / to /dashboard', async () => {
    renderAt('/', 'admin');
    expect(await screen.findByTestId('view-dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/dashboard');
  });

  it('sends a student who types an admin URL to the dashboard', async () => {
    renderAt('/users', 'student');
    expect(await screen.findByTestId('view-dashboard')).toBeInTheDocument();
    expect(screen.queryByTestId('view-users')).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/dashboard');
  });

  it('redirects unknown URLs to the dashboard', async () => {
    renderAt('/does-not-exist', 'teacher');
    expect(await screen.findByTestId('view-dashboard')).toBeInTheDocument();
  });

  it('upgrades old /#/ bookmarks to clean URLs', async () => {
    renderAt('/#/face_enrollment', 'admin');
    expect(await screen.findByTestId('view-face_enrollment')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/face-enrollment$/));
  });

  it('onNavigate from a view changes the URL', async () => {
    renderAt('/dashboard', 'admin');
    (await screen.findByText('go users')).click();
    expect(await screen.findByTestId('view-users')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/users');
  });

  it('shows the login screen at any URL when signed out', async () => {
    renderAt('/users', null);
    expect(await screen.findByTestId('view-login')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/users');
  });
});
