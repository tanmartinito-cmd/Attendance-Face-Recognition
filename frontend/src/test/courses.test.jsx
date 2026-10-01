import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CoursesView from '../views/CoursesView';
import { Api } from '../api';

vi.mock('../api', () => ({
  Api: {
    getPrograms: vi.fn(),
    getCourses: vi.fn(),
    createCourse: vi.fn(),
    updateCourse: vi.fn(),
    deleteCourse: vi.fn(),
  },
}));
vi.mock('../components/shared/ActionPopover', () => ({
  default: ({ items }) => (
    <div>{items.filter((item) => !item.isDivider).map((item) => <button type="button" key={item.label} onClick={item.onClick}>{item.label}</button>)}</div>
  ),
}));
vi.mock('../components/shared/Toast', () => ({ default: ({ message }) => (message ? <div role="status">{message}</div> : null) }));

// CoursesView reports its "Add Course" button via onSetHeaderInfo (like App.jsx's header),
// so this wrapper renders the returned headerActions alongside the view for interaction.
function CoursesViewWithHeader({ user }) {
  const [headerActions, setHeaderActions] = React.useState(null);
  const handleSetHeaderInfo = React.useCallback((info) => setHeaderActions(info.headerActions), []);
  return (
    <div>
      {headerActions}
      <CoursesView user={user} onSetHeaderInfo={handleSetHeaderInfo} />
    </div>
  );
}

function configureApi() {
  Api.getPrograms.mockResolvedValue([{ id: 1, code: 'BSIT', name: 'Bachelor of Science in IT' }]);
  Api.getCourses.mockResolvedValue([
    { id: 5, code: 'BSIT-CORE', name: 'IT Core', is_active: true, program: 1, program_details: { id: 1, code: 'BSIT', name: 'Bachelor of Science in IT' } },
  ]);
  Api.createCourse.mockResolvedValue({ id: 6, code: 'BSIT-NET', name: 'Networking Track' });
  Api.updateCourse.mockResolvedValue({ id: 5, code: 'BSIT-CORE', name: 'IT Core', is_active: false });
  Api.deleteCourse.mockResolvedValue(true);
}

describe('CoursesView module', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads and displays courses independently of the Programs page', async () => {
    configureApi();
    render(<CoursesView user={{ role: 'admin' }} onSetHeaderInfo={vi.fn()} />);

    await waitFor(() => expect(Api.getCourses).toHaveBeenCalledWith(null));
    expect(await screen.findByText('BSIT-CORE')).toBeInTheDocument();
    expect(screen.getByText('IT Core')).toBeInTheDocument();
  });

  it('creates a course via the Add Course form and refreshes the list', async () => {
    configureApi();
    render(<CoursesViewWithHeader user={{ role: 'admin' }} />);
    await screen.findByText('BSIT-CORE');

    // The header button appears once the loaded list is known to be non-empty.
    fireEvent.click(await screen.findByRole('button', { name: /Add Course/i }));
    const comboboxes = screen.getAllByRole('combobox');
    // First combobox is the page's program filter; the modal's program select is the second.
    fireEvent.change(comboboxes[1], { target: { value: '1' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. BSIT'), { target: { value: 'bsit-net' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Bachelor of Science in IT'), { target: { value: 'Networking Track' } });
    const submitButton = screen.getAllByRole('button', { name: 'Add Course' }).find((btn) => btn.type === 'submit');
    fireEvent.click(submitButton);

    await waitFor(() => expect(Api.createCourse).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'BSIT-NET', name: 'Networking Track', program: 1 })
    ));
    expect(Api.getCourses).toHaveBeenCalledTimes(2);
  });

  it('deletes a course after confirmation', async () => {
    configureApi();
    window.confirm = vi.fn(() => true);
    render(<CoursesView user={{ role: 'admin' }} onSetHeaderInfo={vi.fn()} />);
    await screen.findByText('BSIT-CORE');

    fireEvent.click(screen.getByRole('button', { name: 'Delete Course' }));

    await waitFor(() => expect(Api.deleteCourse).toHaveBeenCalledWith(5));
    expect(Api.getCourses).toHaveBeenCalledTimes(2);
  });

  it('toggles a course active status', async () => {
    configureApi();
    render(<CoursesView user={{ role: 'admin' }} onSetHeaderInfo={vi.fn()} />);
    await screen.findByText('BSIT-CORE');

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Course' }));

    await waitFor(() => expect(Api.updateCourse).toHaveBeenCalledWith(5, { is_active: false }));
  });

  it('shows a single centered Add button (none in the header) when there are no courses', async () => {
    configureApi();
    Api.getCourses.mockResolvedValue([]);
    render(<CoursesViewWithHeader user={{ role: 'admin' }} />);

    expect(await screen.findByText('No courses yet')).toBeInTheDocument();
    const addButtons = screen.getAllByRole('button', { name: 'Add Course' });
    expect(addButtons).toHaveLength(1);
    expect(addButtons[0].closest('td')).toHaveClass('table-empty-cell');

    fireEvent.click(addButtons[0]);
    expect(screen.getByPlaceholderText('e.g. BSIT')).toBeInTheDocument();
  });

  it('moves the Add button to the header once courses exist', async () => {
    configureApi();
    render(<CoursesViewWithHeader user={{ role: 'admin' }} />);
    await screen.findByText('BSIT-CORE');

    const addButtons = await screen.findAllByRole('button', { name: 'Add Course' });
    expect(addButtons).toHaveLength(1);
    expect(addButtons[0].closest('td')).toBeNull();
  });

  it('filters courses by program', async () => {
    configureApi();
    render(<CoursesView user={{ role: 'admin' }} onSetHeaderInfo={vi.fn()} />);
    await screen.findByText('BSIT-CORE');

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });

    await waitFor(() => expect(Api.getCourses).toHaveBeenLastCalledWith('1'));
  });
});
