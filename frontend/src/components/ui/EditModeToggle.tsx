/**
 * The app's ONE way of revealing destructive controls on a list.
 *
 * Delete is never ambient — a red "Delete" sitting permanently on every row
 * is noise on a phone and an invitation to a stray tap. The list is read-only
 * until this is switched on, and only then do rows offer to be edited or
 * removed. The confirm step inside a row stays: two taps, always.
 *
 * This exists as a component rather than as markup copied from the Journal
 * because that copying is exactly what failed — the Journal set the pattern,
 * Ideas invented its own, and the AI summary list copied Ideas. A convention
 * that lives only in prose gets missed; one that lives in a component that is
 * right there to import does not.
 */
export function EditModeToggle({
  on,
  onChange,
  noun,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  /** Plural, lower case, for the accessible label: "Edit ideas". */
  noun: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? 'Done editing' : `Edit ${noun}`}
      onClick={() => onChange(!on)}
      className={`shrink-0 rounded-lg border px-2 py-1.5 transition-colors ${
        on
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-border text-muted'
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </button>
  );
}
