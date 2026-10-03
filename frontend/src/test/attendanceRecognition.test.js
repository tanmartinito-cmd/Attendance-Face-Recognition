import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useAttendanceRecognition, { holdDecision, isSameFace } from '../components/scanner/useAttendanceRecognition';
import { Api } from '../api';

vi.mock('../api', () => ({ Api: { recognizeFace: vi.fn(), markAttendance: vi.fn() } }));

function createProps() {
  return {
    session: { id: 7 },
    setSession: vi.fn(),
    videoRef: { current: { videoWidth: 640, videoHeight: 480 } },
    captureCanvasRef: { current: { getContext: () => ({ drawImage: vi.fn() }), toDataURL: () => 'frame' } },
    setRecords: vi.fn(),
    setStatusText: vi.fn(),
    setStatusState: vi.fn(),
    markedStudentIdsRef: { current: new Set() },
    setJustMarkedId: vi.fn(),
    stopCamera: vi.fn(),
    playAttendanceChime: vi.fn(),
    overlayStateRef: { current: 'idle' },
    overlayLabelRef: { current: '' },
    faceBoxTargetRef: { current: null },
    lastFaceSeenRef: { current: 0 },
  };
}

describe('scanner recognition workflow', () => {
  it('updates attendance state after a matched face', () => {
    const props = createProps();
    const { result } = renderHook(() => useAttendanceRecognition(props));

    act(() => result.current.applyRecognition({ recognized: [{ student_id: 21, name: 'Ada Lovelace', matched: true, new_status: 'late' }] }, 640, 480));

    expect(props.setStatusText).toHaveBeenCalledWith('Recorded Late: Ada Lovelace');
    expect(props.setStatusState).toHaveBeenCalledWith('success');
    expect(props.markedStudentIdsRef.current.has(21)).toBe(true);
    expect(props.setRecords).toHaveBeenCalled();
  });

  it('shows the quality-gate prompt and does not mark', () => {
    const props = createProps();
    const { result } = renderHook(() => useAttendanceRecognition(props));

    act(() => result.current.applyRecognition({ recognized: [{
      student_id: null, name: '', matched: false, quality_failed: true, message: 'Keep your eyes open.',
    }] }, 640, 480));

    expect(props.setStatusText).toHaveBeenCalledWith('Keep your eyes open.');
    expect(props.setStatusState).toHaveBeenCalledWith('verifying');
    expect(props.setRecords).not.toHaveBeenCalled();
  });

  it('shows the server reason when liveness fails', () => {
    const props = createProps();
    const { result } = renderHook(() => useAttendanceRecognition(props));

    act(() => result.current.applyRecognition({ recognized: [{
      student_id: 21, name: 'Ada', liveness_failed: true, message: 'Photo or screen detected. Please use your real face',
    }] }, 640, 480));

    expect(props.setStatusText).toHaveBeenCalledWith('Photo or screen detected. Please use your real face');
    expect(props.setStatusState).toHaveBeenCalledWith('error');
  });

  it('marks a student manually through the current session API', async () => {
    const props = createProps();
    Api.markAttendance.mockResolvedValue({ success: true, student_name: 'Ada Lovelace' });
    const { result } = renderHook(() => useAttendanceRecognition(props));

    await act(async () => result.current.markAttendance(21, 'present'));

    expect(Api.markAttendance).toHaveBeenCalledWith(7, 21, 'present');
    expect(props.setStatusText).toHaveBeenCalledWith('Recorded: Ada Lovelace');
    expect(props.setRecords).toHaveBeenCalled();
  });
});

describe('pause after a student is finished (queue of students)', () => {
  const box = (left = 200, top = 120, size = 160) => ({ left, top, right: left + size, bottom: top + size });
  const fresh = (now, faceBox) => ({ ready: true, at: now, box: faceBox });
  const start = (now, faceBox = box()) => ({ box: faceBox, at: now, missSince: null });

  it('keeps pausing while the same face stays, even if it sways a little', () => {
    const now = 10_000;
    const swayed = box(215, 128, 166);
    const decision = holdDecision(start(now - 1000), fresh(now, swayed), now);
    expect(decision.hold).toBe(true);
    expect(decision.held.box).toEqual(swayed); // follows slow drift
  });

  it('resumes scanning when the next student in line steps in (different position or size)', () => {
    const now = 10_000;
    expect(holdDecision(start(now - 500), fresh(now, box(420, 130, 160)), now).reason).toBe('changed'); // moved sideways
    expect(holdDecision(start(now - 500), fresh(now, box(230, 150, 90)), now).reason).toBe('changed');  // smaller, farther back
    expect(holdDecision(start(now - 500), fresh(now, box(200, 120, 240)), now).hold).toBe(false);      // much closer
  });

  it('tolerates a one-tick detector miss, but resumes once the student has left', () => {
    const now = 10_000;
    const miss = holdDecision(start(now - 500), fresh(now, null), now);
    expect(miss.hold).toBe(true);
    const later = holdDecision(miss.held, fresh(now + 600, null), now + 600);
    expect(later).toMatchObject({ hold: false, reason: 'left' });
  });

  it('never pauses longer than 3 seconds, and never without a working detector', () => {
    const now = 10_000;
    expect(holdDecision(start(now - 3100), fresh(now, box()), now)).toMatchObject({ hold: false, reason: 'expired' });
    expect(holdDecision(start(now - 200), { ready: false, at: now, box: box() }, now).hold).toBe(false);
    expect(holdDecision(start(now - 200), { ready: true, at: now - 5000, box: box() }, now).hold).toBe(false);
    expect(holdDecision(null, fresh(now, box()), now).hold).toBe(false);
  });

  it('isSameFace rejects missing boxes', () => {
    expect(isSameFace(null, box())).toBe(false);
    expect(isSameFace(box(), box())).toBe(true);
  });

  it('does not upload while the finished student stays, and uploads for the next student', async () => {
    const props = createProps();
    const localFaceRef = { current: null };
    props.localFaceRef = localFaceRef;
    Api.recognizeFace.mockReset();
    Api.recognizeFace.mockResolvedValue({ success: true, recognized: [{ student_id: 5, name: 'Kristan', already_marked: true, box: { left: 200, top: 120, right: 360, bottom: 280 } }] });
    const { result } = renderHook(() => useAttendanceRecognition(props));
    act(() => result.current.setRecognitionActive(true));
    const stay = () => { localFaceRef.current = { ready: true, at: Date.now(), width: 640, height: 480, box: box() }; };

    stay();
    await act(async () => { vi.useFakeTimers(); result.current.scheduleScan(0); await vi.advanceTimersByTimeAsync(10); });
    expect(Api.recognizeFace).toHaveBeenCalledTimes(1); // Kristan: already marked -> pause starts

    for (let i = 0; i < 5; i += 1) { stay(); await act(async () => { await vi.advanceTimersByTimeAsync(400); }); }
    expect(Api.recognizeFace).toHaveBeenCalledTimes(1); // same face still there: nothing uploaded

    localFaceRef.current = { ready: true, at: Date.now(), width: 640, height: 480, box: box(420, 130, 150) }; // Angie steps in
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(Api.recognizeFace.mock.calls.length).toBeGreaterThan(1);
    vi.useRealTimers();
  });
});
