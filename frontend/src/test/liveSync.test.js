import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from '../api';
import { subscribeCacheUpdates } from '../apiCache';
import { changedPrefixes, pollOnce, stopLiveSync } from '../liveSync';

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('live sync', () => {
  afterEach(() => stopLiveSync());

  it('maps changed server groups to browser cache prefixes', () => {
    expect(changedPrefixes({ academic: 1, people: 1 }, { academic: 2, people: 1 })).toContain('/api/programs/');
    expect(changedPrefixes({ academic: 1 }, { academic: 1 })).toEqual([]);
    expect(changedPrefixes(null, { academic: 1 })).toEqual([]); // first poll only learns versions
  });

  it("another user's database change silently updates the cached page data", async () => {
    let versions = { academic: 1, people: 1, attendance: 1, dashboard: 1, reports: 1 };
    let programs = [{ id: 1, code: 'OLD' }];
    global.fetch = vi.fn().mockImplementation(async (url) => (
      url.includes('/api/sync/versions/') ? json({ versions }) : json(programs)
    ));
    const updated = vi.fn();
    const unsubscribe = subscribeCacheUpdates(updated);

    await Api.getPrograms(); // page visited, now cached
    await pollOnce(); // first poll: learn the current versions

    // Someone else adds a program: the server bumps "academic".
    programs = [{ id: 1, code: 'OLD' }, { id: 2, code: 'NEW' }];
    versions = { ...versions, academic: 2 };
    await pollOnce();

    await vi.waitFor(() => expect(updated).toHaveBeenCalledWith('/api/programs/'));
    expect((await Api.getPrograms()).map((p) => p.code)).toEqual(['OLD', 'NEW']); // from memory, fresh
    unsubscribe();
  });

  it('after your own save the next read waits for fresh data (never shows pre-save data)', async () => {
    let programs = [{ id: 1 }];
    global.fetch = vi.fn().mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') { programs = [{ id: 1 }, { id: 2 }]; return json({ id: 2 }); }
      return json(programs);
    });
    await Api.getPrograms();
    await Api.createProgram({ code: 'X', name: 'X' });
    expect(await Api.getPrograms()).toHaveLength(2);
  });
});
