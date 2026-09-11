// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditModeToggle } from './EditModeToggle';

afterEach(cleanup);

describe('EditModeToggle', () => {
  it('offers to start editing when it is off', () => {
    render(<EditModeToggle on={false} onChange={() => {}} noun="ideas" />);
    expect(
      screen.getByRole('button', { name: 'Edit ideas' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('offers to stop when it is on', () => {
    render(<EditModeToggle on onChange={() => {}} noun="ideas" />);
    expect(
      screen.getByRole('button', { name: 'Done editing' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('reports the flipped value when tapped', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<EditModeToggle on={false} onChange={onChange} noun="entries" />);
    await user.click(screen.getByRole('button', { name: 'Edit entries' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
