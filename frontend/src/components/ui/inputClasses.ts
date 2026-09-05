/**
 * What an input looks like, in one place.
 *
 * Separate from `Input.tsx` so that file exports only its component — a
 * module that mixes the two breaks Fast Refresh, which is the same reason
 * `lib/benchmarkRange.ts` exists. Most call sites want the classes rather
 * than the wrapper: they already spell out type, inputMode and handlers, and
 * a component would only forward them.
 *
 * On the sizes: `md` is `text-base` for the entry sheet and the seed form,
 * `sm` is `text-sm` for the denser stop and filter rows. Neither affects the
 * iOS auto-zoom this app has already been bitten by — `index.css` forces
 * 16px under `(pointer: coarse)`, so `sm` only ever applies where there is
 * a mouse.
 */
export type InputSize = 'sm' | 'md';

const BASE =
  'w-full min-w-0 rounded-lg border border-border bg-surface-1 outline-none focus:border-accent';

const SIZE: Record<InputSize, string> = {
  sm: 'px-2.5 py-1.5 text-sm',
  md: 'px-3 py-2 text-base',
};

export function inputClasses(size: InputSize = 'md', className = ''): string {
  return [BASE, SIZE[size], className].filter(Boolean).join(' ');
}
