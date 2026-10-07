import { Link } from 'react-router-dom';
import type { BriefLine } from '../../api/dailyBrief';

/** A labelled list of server-written notes, each linking to where the owner acts on it. Renders nothing when empty, unless `empty` text is given. */
export function BriefNoteList({
  label,
  notes,
  destination,
  empty,
}: {
  label: string;
  notes: BriefLine[];
  destination: (symbol: string) => string;
  /** Shown under the heading when there are no notes; without it an empty list renders nothing. */
  empty?: string;
}) {
  if (notes.length === 0 && !empty) return null;
  return (
    <section aria-label={label} className="space-y-2">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted">{label}</h2>
      {notes.length === 0 && <p className="text-sm text-muted">{empty}</p>}
      {notes.map((note, index) => (
        <Link
          key={`${note.kind}-${note.symbol}-${index}`}
          to={destination(note.symbol)}
          className="block rounded-xl border border-border bg-surface-1 p-3 transition-colors active:bg-surface-2"
        >
          <h3 className="text-sm font-medium">{note.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">{note.detail}</p>
        </Link>
      ))}
    </section>
  );
}
