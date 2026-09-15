import type { ReactNode } from 'react';
import { usePersistentState } from '../../lib/persistentState';

export function MinimizableSection({
  storageKey,
  label,
  children,
}: {
  storageKey: string;
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = usePersistentState(storageKey, true);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[10px] uppercase tracking-wide text-muted">{label}</h2>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          onClick={() => setOpen((value) => !value)}
          className="text-[11px] font-medium text-muted hover:text-text"
        >
          {open ? 'Hide ▲' : 'Show ▼'}
        </button>
      </div>
      {open && children}
    </section>
  );
}
