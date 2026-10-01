import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Sidebar from '../components/Sidebar';

vi.mock('../ui', () => ({ confirmAction: vi.fn(() => Promise.resolve(false)) }));

function renderSidebar(role) {
  const { container } = render(
    <Sidebar
      user={{ role, first_name: 'System', last_name: 'Administrator', username: 'admin' }}
      activeTab="dashboard"
      setActiveTab={vi.fn()}
      onLogout={vi.fn()}
      isOpen
      onClose={vi.fn()}
    />,
  );
  return container;
}

describe('Sidebar', () => {
  it.each(['admin', 'instructor', 'student'])(
    'keeps the account card and Sign Out inside the scrollable menu (%s)',
    (role) => {
      const container = renderSidebar(role);
      const scrollArea = container.querySelector('.sidebar-scroll');

      expect(scrollArea).not.toBeNull();
      expect(scrollArea.querySelector('.sidebar-nav')).not.toBeNull();
      expect(scrollArea).toContainElement(screen.getByRole('button', { name: /Sign Out/i }));
      expect(scrollArea).toContainElement(screen.getByText('System Administrator'));
    },
  );
});
