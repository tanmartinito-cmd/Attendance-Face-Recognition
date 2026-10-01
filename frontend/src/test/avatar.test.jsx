import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Avatar, { initialsOf } from '../components/shared/Avatar';

describe('Avatar', () => {
  it('builds initials from the first and last name', () => {
    expect(initialsOf('Maria Dela Santos')).toBe('MS');
    expect(initialsOf('admin')).toBe('A');
    expect(initialsOf('')).toBe('?');
  });

  it('shows local initials when there is no photo (no outside avatar service)', () => {
    const { container } = render(<Avatar name="Maria Santos" />);
    expect(screen.getByText('MS')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('falls back to initials when the photo fails to load', () => {
    const { container } = render(<Avatar src="https://res.cloudinary.com/x/face.jpg" name="Ada Lovelace" alt="Profile photo" />);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://res.cloudinary.com/x/face.jpg');

    fireEvent.error(img);

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'Profile photo' })).toHaveTextContent('AL');
    expect(container.innerHTML).not.toContain('ui-avatars');
  });
});
