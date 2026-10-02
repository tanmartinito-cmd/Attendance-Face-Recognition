import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useAutoFaceCapture, { AUTO_MESSAGES, FRAME_COUNT, isFaceGood, shortReason } from '../components/faceCapture/useAutoFaceCapture';
import { GUIDANCE_MESSAGES, pickOvalFace } from '../components/faceCapture/useFaceGuidance';
import { Api, TokenStorage } from '../api';

vi.mock('../utils/faceCapture', async (importOriginal) => {
  const actual = await importOriginal();
  let n = 0;
  return { ...actual, grabFrame: () => `frame-${++n}` };
});

const READY = { status: 'ready', message: GUIDANCE_MESSAGES.ready };
const NOFACE = { status: 'noface', message: GUIDANCE_MESSAGES.noface };
const video = { videoWidth: 640, videoHeight: 480 };
const OK = { ok: true, message: '' };

function setup({
  guidance = READY,
  onSubmit = vi.fn().mockResolvedValue({ message: 'Face enrolled!' }),
  onCheck = vi.fn().mockResolvedValue(OK),
} = {}) {
  const onFlash = vi.fn();
  const props = (g) => ({ active: true, guidance: g, videoRef: { current: video }, onSubmit, onFlash, onCheck });
  const hook = renderHook((p) => useAutoFaceCapture(p), { initialProps: props(guidance) });
  return { ...hook, onSubmit, onFlash, onCheck, props };
}

// Step in small slices so React re-renders (and schedules the next timer) between ticks.
const advance = async (ms) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(50, ms - elapsed)); });
  }
};

describe('hands-free face capture (no countdown)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('collects 3 checked frames, fills progress, then enrolls once', async () => {
    const { result, onSubmit, onFlash, onCheck } = setup();
    expect(result.current.phase).toBe('collecting');
    expect(result.current.progress).toBe(0);
    await advance(3000);
    expect(onCheck).toHaveBeenCalledTimes(FRAME_COUNT);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toHaveLength(FRAME_COUNT);
    expect(new Set(onSubmit.mock.calls[0][0]).size).toBe(FRAME_COUNT); // distinct live frames
    expect(onFlash).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('done');
    expect(result.current.progress).toBe(1);
    expect(result.current.prompt).toBe(AUTO_MESSAGES.done);
    expect(result.current.message).toBe('Face enrolled!');
  });

  it('never grabs a frame without a face', async () => {
    const { result, onCheck, onSubmit } = setup({ guidance: NOFACE });
    await advance(5000);
    expect(onCheck).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(result.current.prompt).toBe(GUIDANCE_MESSAGES.noface);
  });

  it('keeps progress when the face moves away and continues when it is back', async () => {
    const { result, rerender, props, onSubmit } = setup();
    await advance(450); // 1-2 frames accepted (300 ms gap), capture not finished yet
    const before = result.current.collected;
    expect(before).toBeGreaterThanOrEqual(1);
    expect(before).toBeLessThan(FRAME_COUNT);
    rerender(props(NOFACE));
    await advance(3000);
    expect(result.current.collected).toBe(before); // nothing lost, no reset
    expect(result.current.phase).toBe('collecting');
    rerender(props(READY));
    await advance(2000);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('a rejected frame shows the reason live and does not count', async () => {
    const onCheck = vi.fn()
      .mockResolvedValueOnce({ ok: false, message: 'Keep your eyes open.' })
      .mockResolvedValue(OK);
    const { result } = setup({ onCheck });
    await advance(200);
    expect(result.current.collected).toBe(0);
    expect(result.current.prompt).toBe('Open your eyes');
    await advance(3000);
    expect(result.current.phase).toBe('done');
  });

  it('collects again by itself when enrollment is rejected for quality', async () => {
    const onSubmit = vi.fn()
      .mockRejectedValueOnce(new Error('The capture does not look like the same person throughout.'))
      .mockResolvedValueOnce({ message: 'ok' });
    const { result } = setup({ onSubmit });
    await advance(2000);
    expect(result.current.phase).toBe('error');
    expect(result.current.prompt).toBe(AUTO_MESSAGES.retrying);
    await advance(2500 + 2500);
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe('done');
  });

  it('stops and waits for "Try again" when a person must act (e.g. duplicate face)', async () => {
    const duplicate = Object.assign(new Error('This face is already enrolled to Alice.'), { code: 'duplicate_face' });
    const onSubmit = vi.fn().mockRejectedValue(duplicate);
    const { result } = setup({ onSubmit });
    await advance(2000 + 10000);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(result.current.canRetry).toBe(true);
    act(() => result.current.retry());
    expect(result.current.phase).toBe('collecting');
    expect(result.current.collected).toBe(0);
  });

  it('starting the camera again after success is a fresh capture (re-enroll)', async () => {
    const { result, rerender, props } = setup();
    await advance(3000);
    expect(result.current.phase).toBe('done');
    rerender({ ...props(READY), active: false });
    rerender(props(NOFACE));
    expect(result.current.phase).toBe('collecting');
    expect(result.current.progress).toBe(0);
  });

  it('helpers', () => {
    expect(isFaceGood(READY)).toBe(true);
    expect(isFaceGood({ status: 'unavailable' })).toBe(true);
    expect(isFaceGood(NOFACE)).toBe(false);
    expect(shortReason('Look straight at the camera (face is turned sideways).')).toBe('Look straight');
    expect(shortReason('Use your real face, not a photo or screen.')).toBe('Use your real face');
    expect(shortReason('Too dark. Add light in front of the face.')).toBe('Too dark');
  });
});

describe('only the face in the oval counts', () => {
  const box = (cx, cy, size) => ({ left: cx - size / 2, right: cx + size / 2, top: cy - size / 2, bottom: cy + size / 2 });

  it('ignores people in the background', () => {
    const student = box(320, 250, 200);
    const background = [box(60, 100, 60), box(580, 120, 70)];
    const { box: picked, crowded } = pickOvalFace([...background, student], 640, 480);
    expect(picked).toBe(student);
    expect(crowded).toBe(false);
  });

  it('ignores small faces far off when nobody is in the oval', () => {
    expect(pickOvalFace([box(60, 100, 60)], 640, 480).box).toBeNull();
  });

  it('flags a second person of similar size inside the oval', () => {
    expect(pickOvalFace([box(300, 240, 200), box(400, 250, 170)], 640, 480).crowded).toBe(true);
  });
});

describe('enroll API payload', () => {
  it('sends all captured frames as "frames"', async () => {
    TokenStorage.clear();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) });
    await Api.enrollFace(5, ['a', 'b', 'c']);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ student_id: 5, frames: ['a', 'b', 'c'] });
  });

  it('checks a single frame', async () => {
    TokenStorage.clear();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: false, message: 'Keep your eyes open.' }) });
    const result = await Api.checkEnrollFrame('x');
    expect(fetch.mock.calls[0][0]).toContain('/api/face/enroll/check/');
    expect(result).toEqual({ ok: false, message: 'Keep your eyes open.' });
  });
});
