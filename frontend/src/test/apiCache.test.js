import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api, TokenStorage } from '../api';
import { subscribeCacheUpdates, ttlFor } from '../apiCache';

const jsonResponse = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('API cache', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('switching back to a module reuses cached data (one network call)', async () => {
    global.fetch = vi.fn().mockImplementation(async () => jsonResponse([{ id: 1, code: 'CITEC' }]));
    const first = await Api.getPrograms();
    const second = await Api.getPrograms();
    expect(first).toEqual(second);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('shares one call between identical requests in flight', async () => {
    global.fetch = vi.fn().mockImplementation(async () => jsonResponse([]));
    await Promise.all([Api.getCourses(), Api.getCourses(), Api.getCourses()]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('after the TTL: shows the saved copy instantly and refreshes silently in the background', async () => {
    vi.useFakeTimers();
    let version = 1;
    global.fetch = vi.fn().mockImplementation(async () => jsonResponse([{ id: 1, v: version }]));
    const updated = vi.fn();
    const unsubscribe = subscribeCacheUpdates(updated);

    await Api.getSubjects();
    version = 2; // someone changed the data on the server
    vi.advanceTimersByTime(ttlFor('/api/subjects/') + 1);

    const shown = await Api.getSubjects();
    expect(shown[0].v).toBe(1); // no waiting: old copy right away
    await vi.waitFor(() => expect(updated).toHaveBeenCalledWith('/api/subjects/'));
    expect((await Api.getSubjects())[0].v).toBe(2); // silent refresh stored the new data
    expect(fetch).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('a silent refresh with unchanged data does not re-render pages', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockImplementation(async () => jsonResponse([{ id: 1 }]));
    const updated = vi.fn();
    const unsubscribe = subscribeCacheUpdates(updated);
    await Api.getSubjects();
    vi.advanceTimersByTime(ttlFor('/api/subjects/') + 1);
    await Api.getSubjects();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(10);
    expect(updated).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('a successful change invalidates cached data', async () => {
    global.fetch = vi.fn().mockImplementation(async (_url, init) => jsonResponse(init?.method === 'POST' ? { id: 2 } : []));
    await Api.getPrograms();
    await Api.createProgram({ code: 'NEW', name: 'New' });
    await Api.getPrograms();
    expect(fetch.mock.calls.filter(([, init]) => !init?.method || init.method === 'GET')).toHaveLength(2);
  });

  it('face enrollment refreshes student data; the per-frame check does not', async () => {
    global.fetch = vi.fn().mockImplementation(async () => jsonResponse({ ok: true, success: true }));
    await Api.getStudents();
    await Api.checkEnrollFrame('x');
    await Api.getStudents();
    expect(fetch.mock.calls.filter(([url]) => url.includes('/api/students/'))).toHaveLength(1);
    await Api.enrollFace(1, ['a', 'b', 'c']);
    await Api.getStudents();
    expect(fetch.mock.calls.filter(([url]) => url.includes('/api/students/'))).toHaveLength(2);
  });

  it('signing out wipes the cache', async () => {
    global.fetch = vi.fn().mockImplementation(async () => jsonResponse([]));
    await Api.getPrograms();
    TokenStorage.clear();
    await Api.getPrograms();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('usePageLoading (silent page refresh)', () => {
  it('re-runs the page load silently when cached data changes, without showing the loader', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const { default: usePageLoading } = await import('../ui/usePageLoading');
    const seen = [];
    const reload = vi.fn();
    const { result } = renderHook(() => {
      const [loading, setLoading] = usePageLoading(async () => { setLoading(true); reload(); setLoading(false); }, false);
      seen.push(loading);
      return loading;
    });
    // Simulate a silent background refresh bringing new data.
    global.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{ v: 1 }]))
      .mockResolvedValueOnce(jsonResponse([{ v: 2 }]));
    vi.useFakeTimers();
    await Api.getSubjects();
    vi.advanceTimersByTime(ttlFor('/api/subjects/') + 1);
    await act(async () => { await Api.getSubjects(); await vi.advanceTimersByTimeAsync(200); });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(seen.every((loading) => loading === false)).toBe(true);
    expect(result.current).toBe(false);
  });
});
