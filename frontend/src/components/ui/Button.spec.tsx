// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './Button';

/**
 * The classes are asserted exactly, not loosely. This component replaced 24
 * hand-written class strings, and the only way to be sure that swap did not
 * quietly restyle a screen is to pin what it emits.
 */
describe('Button', () => {
  const classesOf = (label: string) =>
    screen.getByRole('button', { name: label }).className;

  it('emits the primary style the sheets and Login already used', () => {
    render(
      <Button variant="primary" size="lg">
        Save
      </Button>,
    );
    expect(classesOf('Save')).toBe(
      'rounded-lg bg-accent font-medium text-surface-0 disabled:opacity-50 px-4 py-3',
    );
  });

  it('emits the secondary style', () => {
    render(
      <Button variant="secondary" size="sm">
        Cancel
      </Button>,
    );
    expect(classesOf('Cancel')).toBe(
      'rounded-lg border border-border text-muted px-3 py-2 text-sm',
    );
  });

  it('emits the danger style', () => {
    render(
      <Button variant="danger" size="sm">
        Delete
      </Button>,
    );
    expect(classesOf('Delete')).toBe(
      'rounded-lg bg-down font-medium text-surface-0 disabled:opacity-50 px-3 py-2 text-sm',
    );
  });

  it('keeps layout at the call site rather than making it a variant', () => {
    // Where a button sits is the caller's business; what it looks like is not.
    render(
      <Button variant="primary" size="sm" className="flex-1">
        Wide
      </Button>,
    );
    expect(classesOf('Wide')).toContain('flex-1');
  });

  it('does not submit a form unless asked, so a sheet button cannot post it', () => {
    render(<Button>Plain</Button>);
    expect(screen.getByRole('button', { name: 'Plain' })).toHaveAttribute(
      'type',
      'button',
    );
  });

  it('still accepts an explicit submit type', () => {
    render(<Button type="submit">Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute(
      'type',
      'submit',
    );
  });
});
