import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Api, TokenStorage, apiRequest } from '../api';;

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: vi.fn().mockResolvedValue(body),
});

describe('AttendFR API client feature contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn();
    TokenStorage.clear();
  });

  it('logs in through the same-origin proxy; no token is ever written to storage', async () => {
    fetch
      .mockResolvedValueOnce(response({ access: 'access-1' }))
      .mockResolvedValueOnce(response({ username: 'admin', role: 'admin' }));

    const result = await Api.login('admin', 'secret');

    expect(result.user.role).toBe('admin');
    expect(TokenStorage.getAccess()).toBe('access-1'); // memory only
    expect(Object.keys(localStorage)).toEqual(['attendfr_user']); // profile only, no tokens
    const [loginUrl, loginOptions] = fetch.mock.calls[0];
    expect(loginUrl).toBe('/api/token/'); // relative -> Cloudflare Pages Function
    expect(loginOptions).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(loginOptions.headers['X-Auth-Mode']).toBe('cookie');
    expect(fetch).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:8000/api/auth/me/', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer access-1' }) }));
  });

  it('refreshes an expired access token from the cookie and retries the original request', async () => {
    TokenStorage.set('expired', { username: 'teacher' });
    fetch
      .mockResolvedValueOnce(response({ detail: 'token expired' }, 401))
      .mockResolvedValueOnce(response({ access: 'access-new' }))
      .mockResolvedValueOnce(response({ status: 'healthy' }));

    const result = await apiRequest('/api/health/');

    expect(result.ok).toBe(true);
    expect(TokenStorage.getAccess()).toBe('access-new');
    const [refreshUrl, refreshOptions] = fetch.mock.calls[1];
    expect(refreshUrl).toBe('/api/token/refresh/');
    expect(refreshOptions.credentials).toBe('include'); // browser attaches the httpOnly cookie
    expect(JSON.parse(refreshOptions.body)).toEqual({}); // no token in JavaScript
    expect(fetch).toHaveBeenNthCalledWith(3, 'http://127.0.0.1:8000/api/health/', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer access-new' }) }));
  });

  it('after a page reload (no access token in memory) the session is restored from the cookie', async () => {
    TokenStorage.set(null, { username: 'teacher' }); // only the saved profile survives a reload
    fetch
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(response({ access: 'access-restored' }))
      .mockResolvedValueOnce(response({ username: 'teacher' }));

    const me = await Api.getMe();
    expect(me.username).toBe('teacher');
    expect(TokenStorage.getAccess()).toBe('access-restored');
  });

  it('migrates an old localStorage refresh token into the cookie once, then deletes it', async () => {
    localStorage.setItem('attendfr_refresh_token', 'legacy-refresh');
    fetch.mockResolvedValueOnce(response({ access: 'access-2' }));
    await expect(Promise.resolve().then(() => import('../api')).then((m) => m.refreshAccessToken())).resolves.toBe('access-2');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ refresh: 'legacy-refresh' });
    expect(localStorage.getItem('attendfr_refresh_token')).toBeNull();
  });

  it('clears credentials when refresh is rejected', async () => {
    TokenStorage.set('expired', { username: 'teacher' });
    fetch.mockResolvedValueOnce(response({}, 401)).mockResolvedValueOnce(response({}, 401));

    await apiRequest('/api/protected/');

    expect(TokenStorage.getAccess()).toBeNull();
    expect(TokenStorage.getUser()).toBeNull();
  });

  it('maps a closed scanner session without throwing', async () => {
    fetch.mockResolvedValueOnce(response({ session_closed: true, error: 'Session is closed' }, 403));

    await expect(Api.recognizeFace(12, 'frame')).resolves.toEqual({
      success: false,
      session_closed: true,
      error: 'Session is closed',
    });
  });
});

describe('Face enrollment: one student = one face', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn();
    TokenStorage.clear();
  });

  it('surfaces duplicate_face without retrying', async () => {
    fetch.mockResolvedValueOnce(response({
      success: false, code: 'duplicate_face', message: 'This face is already enrolled to Alice (STU-A).',
      conflict_student: { id: 1, student_id: 'STU-A', name: 'Alice' },
    }, 409));
    const confirm = vi.fn();

    await expect(Api.enrollFaceWithConfirm(2, 'frame', confirm)).rejects.toMatchObject({
      code: 'duplicate_face', conflictStudent: { student_id: 'STU-A' },
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries with replace=true only after the admin confirms a face_mismatch', async () => {
    fetch
      .mockResolvedValueOnce(response({ success: false, code: 'face_mismatch', message: 'Does not match.' }, 409))
      .mockResolvedValueOnce(response({ success: true, message: 'Face enrolled' }));

    const result = await Api.enrollFaceWithConfirm(1, 'frame', () => true);

    expect(result.success).toBe(true);
    expect(JSON.parse(fetch.mock.calls[0][1].body).replace).toBeUndefined();
    expect(JSON.parse(fetch.mock.calls[1][1].body).replace).toBe(true);
  });

  it('does not replace when the admin cancels', async () => {
    fetch.mockResolvedValueOnce(response({ success: false, code: 'face_mismatch', message: 'Does not match.' }, 409));

    await expect(Api.enrollFaceWithConfirm(1, 'frame', () => false)).rejects.toMatchObject({ code: 'face_mismatch' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('Session end and refresh', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn();
    TokenStorage.clear();
  });

  it('logout clears the local session and asks the server to revoke tokens and delete the cookie', async () => {
    TokenStorage.set('access-1', { username: 'u' });
    fetch.mockResolvedValueOnce(response({ success: true }));

    await Api.logout();

    expect(TokenStorage.getAccess()).toBeNull();
    expect(TokenStorage.getUser()).toBeNull();
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/auth/logout/');
    expect(options.credentials).toBe('include');
    expect(options.headers.Authorization).toBe('Bearer access-1');
  });

  it('parallel 401s share a single refresh call (refresh tokens are single-use)', async () => {
    TokenStorage.set('expired', { username: 'u' });
    fetch.mockImplementation(async (url, options) => {
      if (url.endsWith('/api/token/refresh/')) return response({ access: 'access-new' });
      return options?.headers?.Authorization === 'Bearer access-new' ? response({ ok: true }) : response({}, 401);
    });

    const results = await Promise.all([apiRequest('/api/a/'), apiRequest('/api/b/'), apiRequest('/api/c/')]);

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/api/token/refresh/'))).toHaveLength(1);
  });

  it('refreshes run one tab at a time (cross-tab lock)', async () => {
    const request = vi.fn((name, work) => work());
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
    TokenStorage.set('expired', { username: 'u' });
    fetch
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(response({ access: 'access-new' }))
      .mockResolvedValueOnce(response({ ok: true }));
    await apiRequest('/api/x/');
    expect(request).toHaveBeenCalledWith('attendfr-token-refresh', expect.any(Function));
    delete navigator.locks;
  });
});
