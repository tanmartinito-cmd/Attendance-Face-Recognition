import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../api', () => ({
  Api: {
    getSessionDetail: vi.fn().mockResolvedValue({ session: { id: 9, status: 'open', date: '2026-09-29', schedule_details: { section_name: 'BSIT-1A', subject_code: 'IT101', room: '101' } }, records: [] }),
    getSessions: vi.fn().mockResolvedValue([]),
    startSession: vi.fn(),
    closeSession: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('../ui', () => ({ confirmAction: vi.fn().mockResolvedValue(true) }));
vi.mock('../components/scanner/ScannerShell', () => ({ default: () => <div data-testid="shell" /> }));
vi.mock('../components/scanner/useFaceOverlay', () => ({ default: () => {} }));
vi.mock('../components/scanner/useFaceDetection', () => {
  const init = async () => true;
  const detect = async () => null;
  const detectAll = async () => [];
  return { default: () => ({ initLocalFaceDetector: init, detectLocalFace: detect, detectLocalFaces: detectAll }) };
});

const { default: ScannerRuntime } = await import('../components/scanner/ScannerRuntime');

/** Mimics App: every header update re-renders the parent (this used to loop forever). */
function Host({ onNavigate, headerSpy }) {
  const [header, setHeader] = useState(null);
  const onSetHeaderInfo = React.useCallback((info) => { headerSpy(info); setHeader(info); }, [headerSpy]);
  return <>
    <div data-testid="header">{header?.title}{header?.headerActions}</div>
    <ScannerRuntime activeSessionId={9} onNavigate={onNavigate} onSetHeaderInfo={onSetHeaderInfo} />
  </>;
}

describe('scanner header', () => {
  it('does not loop and the Back button navigates', async () => {
    const onNavigate = vi.fn();
    const headerSpy = vi.fn();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Host onNavigate={onNavigate} headerSpy={headerSpy} />);

    await waitFor(() => expect(screen.getByTestId('header')).toHaveTextContent('Live Attendance'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(headerSpy.mock.calls.length).toBeLessThan(10);
    expect(errors.mock.calls.some(([msg]) => String(msg).includes('Maximum update depth'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Back to Sections' }));
    expect(onNavigate).toHaveBeenCalledWith('sections');
    errors.mockRestore();
  });
});
