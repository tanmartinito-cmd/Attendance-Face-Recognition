import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { ModalBackdrop } from '../ui';

function Demo({ onClose }) {
  const [name, setName] = useState('Original');
  return (
    <ModalBackdrop onClose={onClose} data-testid="backdrop">
      <div className="modal-card">
        <input aria-label="name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" data-modal-close onClick={onClose}>Cancel</button>
      </div>
    </ModalBackdrop>
  );
}

const clickBackdrop = () => {
  const backdrop = screen.getByTestId('backdrop');
  fireEvent.mouseDown(backdrop);
  fireEvent.click(backdrop);
};

describe('ModalBackdrop unsaved-changes guard', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('closes immediately when nothing was edited', async () => {
    const onClose = vi.fn();
    render(<Demo onClose={onClose} />);
    clickBackdrop();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('asks before discarding edits and keeps the modal open on cancel', async () => {
    const onClose = vi.fn();
    window.confirm = vi.fn(() => false);
    render(<Demo onClose={onClose} />);
    const input = screen.getByLabelText('name');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Edited' } });

    clickBackdrop();
    await waitFor(() => expect(window.confirm).toHaveBeenCalledOnce());
    expect(window.confirm.mock.calls[0][0]).toMatch(/Discard unsaved changes/);
    expect(onClose).not.toHaveBeenCalled();

    window.confirm = vi.fn(() => true);
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('does not prompt when the app (not the user) changed a field, e.g. reset after enrolling', async () => {
    function AppDriven({ onClose }) {
      const [scope, setScope] = useState('regular');
      return (
        <ModalBackdrop onClose={onClose} data-testid="backdrop">
          <div className="modal-card">
            <select aria-label="scope" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="regular">Regular</option>
              <option value="irregular">Irregular</option>
            </select>
            <button type="button" onClick={() => setScope('irregular')}>Filter</button>
          </div>
        </ModalBackdrop>
      );
    }
    const onClose = vi.fn();
    window.confirm = vi.fn(() => false);
    render(<AppDriven onClose={onClose} />);
    fireEvent.focus(screen.getByLabelText('scope'));
    fireEvent.click(screen.getByText('Filter'));
    clickBackdrop();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('does not prompt when the edit was reverted', async () => {
    const onClose = vi.fn();
    window.confirm = vi.fn(() => false);
    render(<Demo onClose={onClose} />);
    const input = screen.getByLabelText('name');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Edited' } });
    fireEvent.change(input, { target: { value: 'Original' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(window.confirm).not.toHaveBeenCalled();
  });
});
