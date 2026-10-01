/**
 * Route table: internal tab ids (used by views via onNavigate) <-> URL paths.
 * Views keep calling onNavigate('face_enrollment'); App turns that into /face-enrollment.
 */
export const TAB_PATHS = {
  dashboard: '/dashboard',
  programs: '/programs',
  courses: '/courses',
  section_catalog: '/section-catalog',
  sections: '/sections',
  subjects: '/subjects',
  schedules: '/schedules',
  users: '/users',
  face_enrollment: '/face-enrollment',
  student_enrollment: '/student-enrollment',
  section_report: '/section-report',
  session_logs: '/session-logs',
  profile: '/profile',
  scanner: '/scanner',
  registrations: '/registrations',
};

/** Public page shown when nobody is signed in (not a tab). */
export const REGISTER_PATH = '/register';

export const DEFAULT_TAB = 'dashboard';

const PATH_TABS = Object.fromEntries(Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab]));

export const ROLE_TABS = {
  admin: new Set(['dashboard', 'programs', 'courses', 'section_catalog', 'sections', 'subjects', 'schedules', 'users', 'registrations', 'face_enrollment', 'student_enrollment', 'section_report', 'session_logs', 'profile']),
  instructor: new Set(['dashboard', 'sections', 'section_report', 'profile', 'scanner']),
  student: new Set(['dashboard', 'sections', 'session_logs', 'profile']),
};

export function isTabAllowed(tab, user) {
  return Boolean(user && ROLE_TABS[user.role]?.has(tab));
}

/** Path -> tab id, or null for unknown paths. Tolerates a trailing slash. */
export function tabFromPath(pathname) {
  const clean = (pathname || '/').replace(/\/+$/, '') || '/';
  return PATH_TABS[clean] || null;
}

/** Tab id -> path (unknown tabs go to the dashboard). */
export function pathForTab(tab) {
  return TAB_PATHS[tab] || TAB_PATHS[DEFAULT_TAB];
}

/**
 * Old bookmarks used hash routes like "/#/users" or "#/face_enrollment".
 * Returns the matching new path, or null when the hash is not a legacy route.
 */
export function pathFromLegacyHash(hash) {
  const legacy = (hash || '').replace(/^#\/?/, '').trim();
  if (!legacy) return null;
  if (TAB_PATHS[legacy]) return TAB_PATHS[legacy];      // "#/face_enrollment"
  const tab = tabFromPath(`/${legacy}`);                // "#/face-enrollment"
  return tab ? TAB_PATHS[tab] : null;
}
