import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * The app's button, in one place.
 *
 * There were 24 distinct button class strings across 33 call sites before
 * this, which is how two buttons ended up side by side in the entry sheet at
 * different font sizes — nothing was wrong with either one, there was just
 * nowhere to say what a button is.
 *
 * Layout is deliberately NOT a variant: `w-full`, `flex-1` and `shrink-0`
 * describe where a button sits, not what it is, so they stay at the call
 * site via `className`. Everything about how it *looks* lives here.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'accent';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE = 'rounded-lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent font-medium text-surface-0 disabled:opacity-50',
  secondary: 'border border-border text-muted',
  danger: 'bg-down font-medium text-surface-0 disabled:opacity-50',
  // The one that reads as an offer rather than a command — "get an opinion",
  // "add a stop". Accent, but hollow, so it never competes with a primary.
  accent:
    'border border-accent/40 bg-accent/10 font-medium text-accent active:bg-accent/20 disabled:opacity-60',
};

/**
 * `lg` carries no `text-sm`, so it sits at the base 16px. That is the size
 * iOS needs on anything tappable to avoid its auto-zoom, and it is what the
 * primary action in a sheet already used.
 */
const SIZE: Record<ButtonSize, string> = {
  sm: 'px-3 py-2 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-4 py-3',
};

export function Button({
  variant = 'secondary',
  size = 'sm',
  className = '',
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = [BASE, VARIANT[variant], SIZE[size], className]
    .filter(Boolean)
    .join(' ');
  // type defaults to "button": a bare <button> inside a form submits it,
  // which is never what these are for unless a caller says so.
  return (
    <button type="button" {...rest} className={classes}>
      {children}
    </button>
  );
}
