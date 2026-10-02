/**
 * AttendFR REST API Client
 * Seamlessly interfaces with Django REST Framework backend on Render / Localhost.
 */
import { formatErrorMessage } from './utils/errorMessages';
import { beginRequest } from './ui/loadingStore';
import { cachedGet, clearApiCache, invalidateAfterMutation, invalidateApiCache } from './apiCache';

export { clearApiCache, invalidateApiCache };

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

export function getApiBaseUrl() {
  return API_BASE_URL.replace(/\/+$/, '');
}

export function resolveMediaUrl(value) {
  if (!value) return '';
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:')) return value;
  return `${getApiBaseUrl()}${value.startsWith('/') ? value : `/${value}`}`;
}

/**
 * Login, token refresh and logout go to the FRONTEND origin (relative URLs). A Cloudflare
 * Pages Function (frontend/functions/) forwards them to Render, so the refresh-token
 * cookie is first-party and httpOnly. Set VITE_AUTH_URL only to point them elsewhere.
 * Every other API call goes straight to VITE_API_URL with the in-memory access token.
 */
const AUTH_BASE_URL = (import.meta.env.VITE_AUTH_URL ?? '').replace(/\/+$/, '');
const authUrl = (path) => `${AUTH_BASE_URL}${path}`;
const AUTH_HEADERS = { 'Content-Type': 'application/json', 'X-Auth-Mode': 'cookie' };

// Tokens used to live in localStorage (readable by any script). Only a one-time migration
// reads the old refresh token; nothing is written there anymore.
const LEGACY_ACCESS_KEY = 'attendfr_access_token';
const LEGACY_REFRESH_KEY = 'attendfr_refresh_token';
try { localStorage.removeItem(LEGACY_ACCESS_KEY); } catch { /* storage unavailable */ }

// Access token: memory only (gone on reload; restored silently from the httpOnly cookie).
let accessToken = null;

export const TokenStorage = {
  getAccess: () => accessToken,
  getUser: () => {
    try {
      const u = localStorage.getItem('attendfr_user');
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  },
  /** Store the access token (memory) and/or the non-secret user profile. */
  set: (access, user) => {
    if (user) clearApiCache(); // new sign-in: never show the previous user's cached data
    if (access) accessToken = access;
    if (user) localStorage.setItem('attendfr_user', JSON.stringify(user));
  },
  clear: () => {
    clearApiCache();
    accessToken = null;
    localStorage.removeItem('attendfr_user');
    localStorage.removeItem(LEGACY_ACCESS_KEY);
    localStorage.removeItem(LEGACY_REFRESH_KEY);
  },
};

/**
 * All requests go through here so the global loader (top progress bar and
 * automatic button spinners) stays in sync. Pass `{ background: true }` for
 * polling-style calls that should never show a loading indicator.
 */
export async function apiRequest(endpoint, options = {}) {
  const { background = false, fresh = false, ...fetchOptions } = options;
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const run = async (silent = background) => {
    const endLoading = beginRequest({ background: silent });
    try {
      return await performRequest(path, fetchOptions);
    } finally {
      endLoading();
    }
  };

  // Reads: served from memory; expired data is refreshed silently in the background.
  if (method === 'GET') {
    if (fresh) invalidateApiCache(path);
    return cachedGet(path, () => run(), () => run(true));
  }

  // Writes: on success, drop the cached data they affect so the next read is fresh.
  const response = await run();
  if (response?.ok) invalidateAfterMutation(path);
  return response;
}

async function performRequest(endpoint, options) {
  const url = `${getApiBaseUrl()}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const token = TokenStorage.getAccess();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response = await fetch(url, { ...options, headers });

  // Access token missing (page reload) or expired: renew it from the httpOnly cookie and retry.
  if (response.status === 401 && hasSession()) {
    const newAccess = await refreshAccessToken();
    if (newAccess) {
      headers['Authorization'] = `Bearer ${newAccess}`;
      response = await fetch(url, { ...options, headers });
    }
  }

  return response;
}

/** A signed-in user profile is kept, so an httpOnly session cookie may exist. */
function hasSession() {
  return Boolean(accessToken || TokenStorage.getUser() || readLegacyRefresh());
}

function readLegacyRefresh() {
  try { return localStorage.getItem(LEGACY_REFRESH_KEY); } catch { return null; }
}

/** Run `work` while holding a lock shared by all tabs (falls back to running it directly). */
function withTabLock(name, work) {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(name, work);
  }
  return work();
}

// Refresh tokens are single-use on the server. Concurrent 401s in THIS tab share one call,
// and the cross-tab lock makes other tabs wait, so they present the already-rotated cookie
// instead of racing with the old one (which would log a tab out).
let refreshInFlight = null;

export function refreshAccessToken() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = withTabLock('attendfr-token-refresh', async () => {
    try {
      // One-time migration from the old localStorage refresh token into the cookie.
      const legacy = readLegacyRefresh();
      const refreshRes = await fetch(authUrl('/api/token/refresh/'), {
        method: 'POST',
        credentials: 'include',
        headers: AUTH_HEADERS,
        body: JSON.stringify(legacy ? { refresh: legacy } : {}),
      });
      if (legacy) localStorage.removeItem(LEGACY_REFRESH_KEY);
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        TokenStorage.set(data.access, null);
        return data.access;
      }
      if (refreshRes.status === 401 || refreshRes.status === 400) {
        TokenStorage.clear(); // session over: sign in again
      }
      return null;
    } catch {
      // Network failure: keep the session; the next request tries again.
      return null;
    }
  }).finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

/** Store the new access token and load the signed-in user (after password or 2FA step). */
async function finishSignIn(data) {
  try { localStorage.removeItem(LEGACY_REFRESH_KEY); } catch { /* ignore */ }
  TokenStorage.set(data.access, null);
  const meRes = await apiRequest('/api/auth/me/');
  if (meRes.ok) {
    const meData = await meRes.json();
    TokenStorage.set(data.access, meData);
    return { tokens: { access: data.access }, user: meData };
  }
  return { tokens: { access: data.access }, user: null };
}

async function twoFactorPost(endpoint, body = {}) {
  const res = await apiRequest(endpoint, { method: 'POST', body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(res.status === 429
      ? 'Too many attempts. Please wait a minute and try again.'
      : data.error || data.detail || 'Something went wrong. Please try again.');
  }
  return data;
}

export const Api = {
  // Auth
  login: async (username, password) => {
    const endLoading = beginRequest();
    let res;
    try {
      // Through the proxy: the refresh token comes back only as an httpOnly cookie.
      res = await fetch(authUrl('/api/token/'), {
        method: 'POST',
        credentials: 'include',
        headers: AUTH_HEADERS,
        body: JSON.stringify({ username, password }),
      });
    } finally {
      endLoading();
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const error = new Error(formatErrorMessage(err.detail || err.error || 'Invalid credentials'));
      error.code = err.code || null; // 'registration_pending' / 'registration_rejected'
      throw error;
    }
    const data = await res.json();
    // Two-step sign-in: the password was right, now the authenticator code is needed.
    if (data.two_factor_required) {
      return { twoFactorRequired: true, challenge: data.challenge, user: null };
    }
    return finishSignIn(data);
  },

  /** Second sign-in step: 6-digit authenticator code or a backup code. */
  loginTwoFactor: async (challenge, code) => {
    const endLoading = beginRequest();
    let res;
    try {
      res = await fetch(authUrl('/api/token/2fa/'), {
        method: 'POST',
        credentials: 'include',
        headers: AUTH_HEADERS,
        body: JSON.stringify({ challenge, code }),
      });
    } finally {
      endLoading();
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const error = new Error(formatErrorMessage(err.detail || err.error || 'That code is not correct.'));
      error.code = err.code || null; // 'challenge_expired' -> back to the password step
      throw error;
    }
    return finishSignIn(await res.json());
  },

  // Public registration (no sign-in; goes straight to the API)
  getRegisterOptions: async () => {
    const res = await fetch(`${API_BASE_URL}/api/register/options/`);
    if (!res.ok) throw new Error('Could not load programs and courses. Please try again.');
    return res.json();
  },
  register: async (payload) => {
    const endLoading = beginRequest();
    let res;
    try {
      res = await fetch(`${API_BASE_URL}/api/register/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } finally {
      endLoading();
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(res.status === 429
        ? 'Too many registrations from this network. Please try again later.'
        : data.error || data.detail || 'Registration failed. Please try again.');
      error.field = data.field || null;
      throw error;
    }
    return data;
  },

  // Admin: registration approvals
  getRegistrations: async (status = 'pending') => {
    const res = await apiRequest(`/api/registrations/?status=${encodeURIComponent(status)}`, { fresh: true });
    if (!res.ok) throw new Error('Could not load registrations.');
    return res.json();
  },
  approveRegistration: (userId) => twoFactorPost(`/api/registrations/${userId}/approve/`),
  rejectRegistration: (userId, reason) => twoFactorPost(`/api/registrations/${userId}/reject/`, { reason }),

  /** A student enrolls their own face (required first step after approval). */
  enrollOwnFace: async (frames) => {
    const res = await apiRequest('/api/face/enroll/self/', {
      background: true,
      method: 'POST',
      body: JSON.stringify({ frames }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data.message || data.error || 'Face enrollment failed. Please try again.');
      error.code = data.code || null;
      throw error;
    }
    return data;
  },

  // Two-step sign-in management (Profile -> Security)
  getTwoFactorStatus: async () => {
    const res = await apiRequest('/api/auth/2fa/', { fresh: true });
    if (!res.ok) throw new Error('Could not load two-step sign-in status.');
    return res.json();
  },
  startTwoFactorSetup: () => twoFactorPost('/api/auth/2fa/setup/'),
  enableTwoFactor: (code) => twoFactorPost('/api/auth/2fa/enable/', { code }),
  disableTwoFactor: (password, code) => twoFactorPost('/api/auth/2fa/disable/', { password, code }),
  regenerateBackupCodes: (code) => twoFactorPost('/api/auth/2fa/backup-codes/', { code }),

  /**
   * Clears the local session immediately, then asks the server to revoke the tokens and
   * delete the httpOnly cookie. Returns the revoke promise (callers need not await it).
   */
  logout: () => {
    const access = TokenStorage.getAccess();
    const hadSession = hasSession();
    TokenStorage.clear();
    if (!hadSession) return Promise.resolve();
    return fetch(authUrl('/api/auth/logout/'), {
      method: 'POST',
      credentials: 'include', // sends the refresh cookie so the server can revoke + clear it
      keepalive: true, // still sent if the page is closing
      headers: {
        ...AUTH_HEADERS,
        ...(access ? { Authorization: `Bearer ${access}` } : {}),
      },
      body: JSON.stringify({}),
    }).catch(() => {
      // Offline: local tokens are already gone; the server copy expires on its own.
    });
  },

  getMe: async () => {
    const res = await apiRequest('/api/auth/me/');
    if (!res.ok) throw new Error('Failed to load user profile');
    return res.json();
  },

  getDashboardStats: async () => {
    const res = await apiRequest('/api/dashboard/stats/');
    if (!res.ok) throw new Error('Failed to load dashboard statistics');
    return res.json();
  },

  // Users Management
  getUsers: async (role = null, search = '') => {
    const params = new URLSearchParams();
    if (role && role !== 'all') params.append('role', role);
    if (search) params.append('search', search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await apiRequest(`/api/users/${qs}`);
    if (!res.ok) return [];
    return res.json();
  },

  createUser: async (userData) => {
    const res = await apiRequest('/api/users/', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(formatErrorMessage(err));
    }
    return res.json();
  },

  updateUser: async (id, userData) => {
    const res = await apiRequest(`/api/users/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(userData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(formatErrorMessage(err));
    }
    return res.json();
  },

  deleteUser: async (id) => {
    const res = await apiRequest(`/api/users/${id}/`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(formatErrorMessage(err));
    }
    return true;
  },

  // Academic Catalog
  getPrograms: async () => {
    const res = await apiRequest('/api/programs/');
    if (!res.ok) return [];
    return res.json();
  },

  createProgram: async (programData) => {
    const res = await apiRequest('/api/programs/', {
      method: 'POST',
      body: JSON.stringify(programData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || 'Failed to create program');
    }
    return res.json();
  },

  getCourses: async (programId = null) => {
    const q = programId ? `?program=${encodeURIComponent(programId)}` : '';
    const res = await apiRequest(`/api/courses/${q}`);
    if (!res.ok) return [];
    return res.json();
  },

  createCourse: async (courseData) => {
    const res = await apiRequest('/api/courses/', {
      method: 'POST',
      body: JSON.stringify(courseData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || 'Failed to create course');
    }
    return res.json();
  },

  updateCourse: async (id, courseData) => {
    const res = await apiRequest(`/api/courses/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(courseData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || 'Failed to update course');
    }
    return res.json();
  },

  deleteCourse: async (id) => {
    const res = await apiRequest(`/api/courses/${id}/`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete course');
    return true;
  },

  getSections: async (filters = null) => {
    const params = new URLSearchParams();
    if (filters && typeof filters === 'object') {
      if (filters.program_id) params.append('program_id', filters.program_id);
      if (filters.course_id) params.append('course_id', filters.course_id);
      if (filters.section_id) params.append('section_id', filters.section_id);
      if (filters.subject_id) params.append('subject_id', filters.subject_id);
      if (filters.year_level) params.append('year_level', filters.year_level);
    }
    const query = params.toString();
    const res = await apiRequest(`/api/sections/${query ? `?${query}` : ''}`);
    if (!res.ok) return [];
    return res.json();
  },

  createSection: async (sectionData) => {
    const res = await apiRequest('/api/sections/', {
      method: 'POST',
      body: JSON.stringify(sectionData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || 'Failed to create section');
    }
    return res.json();
  },

  getSchedules: async (sectionId = null) => {
    const q = sectionId ? `?section_id=${sectionId}` : '';
    const res = await apiRequest(`/api/schedules/${q}`);
    if (!res.ok) return [];
    return res.json();
  },

  createSchedule: async (scheduleData) => {
    const res = await apiRequest('/api/schedules/', {
      method: 'POST',
      body: JSON.stringify(scheduleData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || 'Failed to create schedule');
    }
    return res.json();
  },

  updateSchedule: async (id, scheduleData) => {
    const res = await apiRequest(`/api/schedules/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(scheduleData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || (Array.isArray(err) ? err[0] : 'Failed to update schedule'));
    }
    return res.json();
  },

  getProgramSections: async (filters = null) => {
    let q = '';
    if (typeof filters === 'number' || (typeof filters === 'string' && filters)) {
      q = `?program=${filters}`;
    } else if (filters && typeof filters === 'object') {
      const params = new URLSearchParams();
      if (filters.program_id || filters.program) params.append('program_id', filters.program_id || filters.program);
      if (filters.course_id || filters.course) params.append('course_id', filters.course_id || filters.course);
      if (filters.section_id || filters.section) params.append('section_id', filters.section_id || filters.section);
      if (filters.year_level) params.append('year_level', filters.year_level);
      const str = params.toString();
      if (str) q = `?${str}`;
    }
    const res = await apiRequest(`/api/program-sections/${q}`);
    if (!res.ok) return [];
    return res.json();
  },

  createProgramSection: async (sectionData) => {
    const res = await apiRequest('/api/program-sections/', {
      method: 'POST',
      body: JSON.stringify(sectionData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || 'Failed to create section definition');
    }
    return res.json();
  },

  getSubjects: async (filters = null) => {
    const params = new URLSearchParams();
    if (filters && typeof filters === 'object') {
      if (filters.program_id) params.append('program_id', filters.program_id);
      if (filters.course_id) params.append('course_id', filters.course_id);
      if (filters.section_id) params.append('section_id', filters.section_id);
    }
    const query = params.toString();
    const res = await apiRequest(`/api/subjects/${query ? `?${query}` : ''}`);
    if (!res.ok) return [];
    return res.json();
  },

  createSubject: async (subjectData) => {
    const res = await apiRequest('/api/subjects/', {
      method: 'POST',
      body: JSON.stringify(subjectData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || 'Failed to create subject offering');
    }
    return res.json();
  },

  updateSubject: async (id, subjectData) => {
    const res = await apiRequest(`/api/subjects/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(subjectData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || 'Failed to update subject');
    }
    return res.json();
  },

  updateProgram: async (id, programData) => {
    const res = await apiRequest(`/api/programs/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(programData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || 'Failed to update program');
    }
    return res.json();
  },

  updateSection: async (id, sectionData) => {
    const res = await apiRequest(`/api/sections/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(sectionData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || 'Failed to update section');
    }
    return res.json();
  },

  deleteProgram: async (id) => {
    const res = await apiRequest(`/api/programs/${id}/`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete program');
    return true;
  },

  updateProgramSection: async (id, sectionData) => {
    const res = await apiRequest(`/api/program-sections/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(sectionData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(formatErrorMessage(err.detail || err.error ? (err.detail || err.error) : err) || 'Failed to update section definition');
    }
    return res.json();
  },

  deleteProgramSection: async (id) => {
    const res = await apiRequest(`/api/program-sections/${id}/`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete section definition');
    return true;
  },

  deleteSection: async (id) => {
    const res = await apiRequest(`/api/sections/${id}/`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete section');
    return true;
  },

  getSectionEnrollments: async (sectionId, filters = null) => {
    const params = new URLSearchParams();
    if (filters && typeof filters === 'object' && filters.subject_id) params.append('subject_id', filters.subject_id);
    const query = params.toString();
    const res = await apiRequest(`/api/sections/${sectionId}/enrollments/${query ? `?${query}` : ''}`);
    if (!res.ok) return [];
    return res.json();
  },

  enrollStudent: async (sectionId, studentId, subjectId = null) => {
    const res = await apiRequest(`/api/sections/${sectionId}/enrollments/`, {
      method: 'POST',
      body: JSON.stringify({
        student_id: Number(studentId),
        student: Number(studentId),
        subject_id: subjectId ? Number(subjectId) : null,
        subject: subjectId ? Number(subjectId) : null,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err.error || err.detail || (err.student_id ? err.student_id[0] : null) || 'Failed to enroll student';
      throw new Error(msg);
    }
    return res.json();
  },

  unenrollStudent: async (sectionId, enrollmentId) => {
    const res = await apiRequest(`/api/sections/${sectionId}/enrollments/${enrollmentId}/`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || err.detail || 'Failed to unenroll student');
    }
    return true;
  },

  deleteSchedule: async (id) => {
    const res = await apiRequest(`/api/schedules/${id}/`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete schedule');
    return true;
  },

  deleteSubject: async (id) => {
    const res = await apiRequest(`/api/subjects/${id}/`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete subject');
    return true;
  },

  getInstructors: async () => {
    const res = await apiRequest('/api/users/?role=instructor');
    if (!res.ok) return [];
    return res.json();
  },

  getStudents: async (search = '') => {
    const q = search ? `?search=${encodeURIComponent(search)}` : '';
    const res = await apiRequest(`/api/students/${q}`);
    if (!res.ok) return [];
    return res.json();
  },

  getNextStudentId: async () => {
    const res = await apiRequest('/api/students/next-id/');
    if (!res.ok) return { next_student_id: '' };
    return res.json();
  },

  updateProfile: async (profileData) => {
    const res = await apiRequest('/api/auth/me/', {
      method: 'PATCH',
      body: JSON.stringify(profileData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || 'Failed to update profile');
    }
    const data = await res.json();
    TokenStorage.set(null, data);
    return data;
  },

  /** Change own password. On success the server signs out every device (including this one). */
  changePassword: async ({ currentPassword, newPassword, confirmPassword }) => {
    const res = await apiRequest('/api/auth/password/', {
      method: 'POST',
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(
        res.status === 429
          ? 'Too many attempts. Please wait a minute and try again.'
          : data.error || data.detail || 'Failed to change password.',
      );
      error.field = data.field || null;
      throw error;
    }
    return data;
  },

  // Attendance Sessions
  getSessions: async () => {
    const res = await apiRequest('/api/attendance/sessions/');
    if (!res.ok) return [];
    return res.json();
  },

  /**
   * Start (or resume) today's attendance for a schedule.
   * Starting late answers 409 with code 'late_start' (error.details has minutes_late,
   * scheduled_start, late_threshold_minutes); call again with
   * { start_mode: 'present' } or { start_mode: 'late', reason }.
   * Use startAttendanceSession() (utils/startAttendance.js) to ask the instructor.
   */
  startSession: async (scheduleId, options = {}) => {
    const res = await apiRequest('/api/attendance/sessions/start/', {
      method: 'POST',
      body: JSON.stringify({ schedule_id: scheduleId, ...options }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const error = new Error(err.error || err.reason?.[0] || 'Failed to start session');
      if (err.code) { error.code = err.code; error.details = err; }
      throw error;
    }
    return res.json();
  },

  closeSession: async (sessionId) => {
    const res = await apiRequest(`/api/attendance/sessions/${sessionId}/close/`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to close session');
    return res.json();
  },

  reopenSession: async (sessionId, reason) => {
    const res = await apiRequest(`/api/attendance/sessions/${sessionId}/reopen/`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to reopen attendance session');
    }
    return res.json();
  },

  getSessionDetail: async (sessionId) => {
    const res = await apiRequest(`/api/attendance/sessions/${sessionId}/`);
    if (!res.ok) throw new Error('Failed to load session details');
    return res.json();
  },

  // Face Recognition & Enrollment
  recognizeFace: async (sessionId, frameBase64) => {
    const res = await apiRequest('/api/face/recognize/', {
      background: true,
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, frame: frameBase64 }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (err.session_closed) {
        return { success: false, session_closed: true, error: err.error };
      }
      if (err.attendance_unavailable) {
        return { success: false, attendance_unavailable: true, error: err.error };
      }
      throw new Error(err.error || 'Face recognition service error');
    }
    return res.json();
  },

  /**
   * Enroll a student's face. Pass `{ replace: true }` only after the admin confirms
   * replacing a face that does not match the one already enrolled.
   * Errors carry `code`: 'duplicate_face' (face belongs to another student) or
   * 'face_mismatch' (different person than this student's current face).
   */
  enrollFace: async (studentId, frames, { replace = false } = {}) => {
    // One capture = the 3 checked frames; the server combines them into one face identity.
    const list = Array.isArray(frames) ? frames : [frames];
    const res = await apiRequest('/api/face/enroll/', {
      background: true, // the camera view shows its own "Processing" state
      method: 'POST',
      body: JSON.stringify({ student_id: studentId, frames: list, ...(replace ? { replace: true } : {}) }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const error = new Error(err.error || err.message || 'Face enrollment failed');
      error.code = err.code || null;
      error.conflictStudent = err.conflict_student || null;
      throw error;
    }
    return res.json();
  },

  /**
   * Live check of one enrollment frame (eyes open, head straight, face in the oval...).
   * Resolves { ok, message }; nothing is stored on the server.
   */
  checkEnrollFrame: async (frameBase64) => {
    const res = await apiRequest('/api/face/enroll/check/', {
      background: true, // the camera view shows the progress itself
      method: 'POST',
      body: JSON.stringify({ frame: frameBase64 }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: Boolean(data.ok), message: data.message || '' };
    if (res.status === 400) return { ok: false, message: data.message || 'Frame could not be read.' };
    const error = new Error(data.error || data.message || 'Face check unavailable.');
    error.status = res.status;
    throw error;
  },

  /** Enroll a face; if it differs from the student's current face, ask before replacing. */
  enrollFaceWithConfirm: async (studentId, frames, confirmReplace = (message) => window.confirm(message)) => {
    try {
      return await Api.enrollFace(studentId, frames);
    } catch (error) {
      if (error.code === 'face_mismatch' && confirmReplace(`${error.message}\n\nReplace the existing face?`)) {
        return Api.enrollFace(studentId, frames, { replace: true });
      }
      throw error;
    }
  },
  markAttendance: async (sessionId, studentId, status = 'present') => {
    const res = await apiRequest('/api/attendance/records/mark/', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, student_id: studentId, status }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to mark attendance');
    }
    return res.json();
  },

  // Student Attendance Overview & Monthly Calendar
  getStudentAttendanceOverview: async (studentId = null) => {
    let endpoint = '/api/attendance/student/overview/';
    if (studentId) endpoint += `?student_id=${studentId}`;
    const res = await apiRequest(endpoint);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to load student attendance overview');
    }
    return res.json();
  },

  getStudentAttendanceCalendar: async (sectionId, year = null, month = null, studentId = null) => {
    let endpoint = `/api/attendance/student/calendar/${sectionId}/?format=json`;
    if (year && month) endpoint += `&year=${year}&month=${month}`;
    if (studentId) endpoint += `&student_id=${studentId}`;
    const res = await apiRequest(endpoint);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to load attendance calendar');
    }
    return res.json();
  },
};

