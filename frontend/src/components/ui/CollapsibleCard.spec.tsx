// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CollapsibleCard } from './CollapsibleCard';

afterEach(cleanup);

const card = (props: Partial<React.ComponentProps<typeof CollapsibleCard>> = {}) => (
  <CollapsibleCard
    label="review"
    header={<span>GRADE A</span>}
    actions={<button type="button">Re-evaluate</button>}
    {...props}
  >
    <p>the long body</p>
  </CollapsibleCard>
);

describe('CollapsibleCard', () => {
  it('shows the body when open', () => {
    render(card());
    expect(screen.getByText('the long body')).toBeInTheDocument();
  });

  /**
   * Collapsed means ONE header line. The portfolio summary already worked
   * this way; the trade review reimplemented it and kept a verdict line and a
   * four-tile metrics grid on screen, so "minimised" still buried the page on
   * a phone. Everything that is not the header goes.
   */
  it('leaves only the header when collapsed', async () => {
    const user = userEvent.setup();
    render(card());
    await user.click(screen.getByRole('button', { name: 'Hide review' }));

    expect(screen.queryByText('the long body')).not.toBeInTheDocument();
    expect(screen.getByText('GRADE A')).toBeInTheDocument();
  });

  /** Controls beside the toggle stay reachable while collapsed. */
  it('keeps its actions available when collapsed', async () => {
    const user = userEvent.setup();
    render(card());
    await user.click(screen.getByRole('button', { name: 'Hide review' }));
    expect(
      screen.getByRole('button', { name: 'Re-evaluate' }),
    ).toBeInTheDocument();
  });

  it('reports its state to assistive tech', async () => {
    const user = userEvent.setup();
    render(card());
    const toggle = screen.getByRole('button', { name: 'Hide review' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(
      screen.getByRole('button', { name: 'Show review' }),
    ).toHaveAttribute('aria-expanded', 'false');
  });
});
