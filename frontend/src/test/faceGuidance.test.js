import { describe, expect, it } from 'vitest';
import { evaluateFaceFrame, GUIDANCE_MESSAGES, canCaptureWith } from '../components/faceCapture/useFaceGuidance';
import { cleanToastMessage } from '../utils/toastText';

const frame = { width: 640, height: 480, brightness: 120, detectorReady: true };
const box = (cx, cy, w) => ({ left: cx - w / 2, right: cx + w / 2, top: cy - w * 0.65, bottom: cy + w * 0.65 });

describe('evaluateFaceFrame', () => {
  it('reports no face when nothing is detected', () => {
    const result = evaluateFaceFrame({ ...frame, box: null });
    expect(result.status).toBe('noface');
    expect(result.message).toBe(GUIDANCE_MESSAGES.noface);
    expect(canCaptureWith(result.status)).toBe(false);
  });

  it('asks the user to center an off-center face', () => {
    const result = evaluateFaceFrame({ ...frame, box: box(120, 240, 200) });
    expect(result.status).toBe('adjust');
    expect(result.message).toBe('Center your face');
    expect(result.checks.centered).toBe('bad');
  });

  it('asks to move closer or back based on face size', () => {
    expect(evaluateFaceFrame({ ...frame, box: box(320, 240, 90) }).message).toBe(GUIDANCE_MESSAGES.closer);
    expect(evaluateFaceFrame({ ...frame, box: box(320, 240, 420) }).message).toBe(GUIDANCE_MESSAGES.farther);
  });

  it('flags poor lighting', () => {
    expect(evaluateFaceFrame({ ...frame, brightness: 30, box: box(320, 240, 200) }).message).toBe(GUIDANCE_MESSAGES.dark);
  });

  it('is ready when centered, sized, and lit', () => {
    const result = evaluateFaceFrame({ ...frame, box: box(320, 240, 200) });
    expect(result.status).toBe('ready');
    expect(Object.values(result.checks).every((check) => check === 'ok')).toBe(true);
  });

  it('accepts a face that is a little off-centre inside the oval', () => {
    expect(evaluateFaceFrame({ ...frame, box: box(360, 260, 200) }).status).toBe('ready');
  });

  it('once centered, a small movement keeps it centered (hysteresis)', () => {
    const nudged = box(398, 250, 200); // just past the "become centered" limit
    expect(evaluateFaceFrame({ ...frame, box: nudged }).checks.centered).toBe('bad');
    const previous = evaluateFaceFrame({ ...frame, box: box(320, 250, 200) });
    const after = evaluateFaceFrame({ ...frame, box: nudged, previous });
    expect(after.checks.centered).toBe('ok');
    expect(after.status).toBe('ready');
  });

  it('measures against the displayed (cropped) view, not the raw video', () => {
    // Wide stage crops the top/bottom of a 4:3 video; a face at the video centre is still in the oval.
    const result = evaluateFaceFrame({ ...frame, viewWidth: 800, viewHeight: 480, box: box(320, 245, 160) });
    expect(result.checks.centered).toBe('ok');
  });

  it('falls back to manual alignment when the detector is unavailable', () => {
    const result = evaluateFaceFrame({ ...frame, detectorReady: false, box: null });
    expect(result.status).toBe('unavailable');
    expect(canCaptureWith(result.status)).toBe(true);
  });
});

describe('cleanToastMessage', () => {
  it('removes filler wording and exclamation marks', () => {
    expect(cleanToastMessage('Class schedule created successfully!')).toBe('Class schedule created.');
    expect(cleanToastMessage('Subject "IT101" updated successfully!')).toBe('Subject "IT101" updated.');
    expect(cleanToastMessage('failed to delete course')).toBe('Failed to delete course.');
    expect(cleanToastMessage('')).toBe('');
  });
});
