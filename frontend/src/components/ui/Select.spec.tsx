// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from './Select';

afterEach(cleanup);

const options = [
  { value: 'asc', label: 'Nearest first' },
  { value: 'desc', label: 'Furthest first' },
];

describe('Select', () => {
  it('shows every option with the current value selected', () => {
    render(
      <Select value="desc" onChange={() => {}} options={options} srLabel="Sort" />,
    );
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue('desc');
    expect(screen.getByRole('option', { name: 'Nearest first' })).toBeInTheDocument();
  });

  it('reports the picked value', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Select value="desc" onChange={onChange} options={options} srLabel="Sort" />,
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'asc');
    expect(onChange).toHaveBeenCalledWith('asc');
  });
});
