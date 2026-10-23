import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Api, TokenStorage, apiError } from '../api';
import { formatErrorMessage, scheduleErrorText } from '../utils/errorMessages';

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: vi.fn().mockResolvedValue(body),
});

describe('API error format', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn();
    TokenStorage.set('token', { username: 'admin', role: 'admin' });
  });

  it('uses the readable summary and keeps code / fields / conflicts', async () => {
    const err = await apiError(response({
      error: 'Instructor conflict: Prof. Santos already teaches IT202 (BSIT-2B).',
      code: 'schedule_conflict',
      fields: {},
      conflicts: [{ type: 'instructor', message: 'Instructor conflict: Prof. Santos already teaches IT202 (BSIT-2B).' }],
    }, 409), 'fallback');
    expect(err.message).toContain('Prof. Santos');
    expect(err.status).toBe(409);
    expect(err.code).toBe('schedule_conflict');
    expect(err.conflicts).toHaveLength(1);
  });

  it('still reads older shapes: field errors and plain lists', async () => {
    const fieldErr = await apiError(response({ day_of_week: ['"Xyz" is not a valid choice.'] }, 400), 'fallback');
    expect(fieldErr.message).toContain('"Xyz" is not a valid choice.');
    const listErr = await apiError(response(['End time must be after start time.'], 400), 'fallback');
    expect(listErr.message).toBe('End time must be after start time.');
    const empty = await apiError({ ok: false, status: 500, json: vi.fn().mockRejectedValue(new Error('no json')) }, 'Failed to save');
    expect(empty.message).toBe('Failed to save');
  });

  it('createSchedule surfaces the backend conflict message instead of a generic one', async () => {
    fetch.mockResolvedValueOnce(response({
      error: 'Room conflict: Room 226 is already used by IT201 (BSIT-2A) on Mon 8:00 AM–9:30 AM in Room 226.',
      code: 'schedule_conflict', conflicts: [{ type: 'room', message: 'Room conflict' }], fields: {},
    }, 409));
    await expect(Api.createSchedule({ section: 1 })).rejects.toMatchObject({
      code: 'schedule_conflict', message: expect.stringContaining('Room 226'),
    });
  });

  it('enrollStudent exposes alternatives for a student schedule conflict', async () => {
    fetch.mockResolvedValueOnce(response({
      error: 'Schedule conflict: Juan already has IT201.', code: 'student_schedule_conflict',
      conflicts: [{ type: 'student', message: 'x' }], alternatives: [{ section: 'BSCS-2A', schedule: 'Tue 1:00 PM–2:30 PM' }],
    }, 409));
    await expect(Api.enrollStudent(3, 7, 9)).rejects.toMatchObject({
      code: 'student_schedule_conflict', alternatives: [{ section: 'BSCS-2A', schedule: 'Tue 1:00 PM–2:30 PM' }],
    });
  });

  it('deleteSchedule reports attendance history protection', async () => {
    fetch.mockResolvedValueOnce(response({
      error: 'This schedule has 3 attendance sessions and cannot be deleted.', code: 'has_attendance',
    }, 409));
    await expect(Api.deleteSchedule(5)).rejects.toMatchObject({ code: 'has_attendance' });
  });

  it('formatErrorMessage keeps specific backend messages', () => {
    expect(formatErrorMessage({ error: 'Name: Section "BSIT-1A" already exists for BSIT.', code: 'validation_error' }))
      .toBe('Name: Section "BSIT-1A" already exists for BSIT.');
    expect(formatErrorMessage('Both start time and end time are required.'))
      .toBe('Both start time and end time are required.');
  });

  it('scheduleErrorText lists every conflict on its own line', () => {
    const err = Object.assign(new Error('summary'), {
      conflicts: [{ message: 'Room conflict: A.' }, { message: 'Instructor conflict: B.' }],
    });
    expect(scheduleErrorText(err, 'x')).toBe('• Room conflict: A.\n• Instructor conflict: B.');
    expect(scheduleErrorText(new Error('single'), 'x')).toBe('single');
  });
});
