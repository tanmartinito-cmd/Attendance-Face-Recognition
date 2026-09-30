import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { clearApiCache } from '../apiCache';

afterEach(() => {
  cleanup();
  clearApiCache();
  localStorage.clear();
  sessionStorage.clear();
});

Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true,
  value: async () => {},
});

HTMLCanvasElement.prototype.getContext = () => ({
  clearRect: () => {},
  drawImage: () => {},
  measureText: () => ({ width: 40 }),
  fillRect: () => {},
  fillText: () => {},
  save: () => {},
  restore: () => {},
  strokeRect: () => {},
  beginPath: () => {},
  moveTo: () => {},
  lineTo: () => {},
});
HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,test-frame';
