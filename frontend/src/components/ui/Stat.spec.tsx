// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Stat } from './Stat';

afterEach(cleanup);

describe('Stat', () => {
  it('shows the label and value', () => {
    render(<Stat label="Win rate" value="55%" />);
    expect(screen.getByText('Win rate')).toBeInTheDocument();
    expect(screen.getByText('55%')).toBeInTheDocument();
  });

  it('shows the sub-label only when given one', () => {
    const { rerender } = render(<Stat label="Win rate" value="55%" sub="12 closed" />);
    expect(screen.getByText('12 closed')).toBeInTheDocument();

    rerender(<Stat label="Win rate" value="55%" />);
    expect(screen.queryByText('12 closed')).not.toBeInTheDocument();
  });
});
