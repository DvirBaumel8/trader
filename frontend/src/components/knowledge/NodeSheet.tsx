import { useEffect, type Ref } from 'react';
import type { KnowledgeNode } from '../../api/knowledge';
import { etDate } from '../../lib/dates';
import { FundamentalsTable } from './FundamentalsTable';

export interface Neighbour {
  node: KnowledgeNode;
  label: string;
}

export function NodeSheet({
  symbol,
  node,
  neighbours,
  onSelect,
  onClose,
  sheetRef,
}: {
  symbol: string;
  node: KnowledgeNode;
  neighbours: Neighbour[];
  onSelect: (id: string) => void;
  onClose: () => void;
  sheetRef?: Ref<HTMLDivElement>;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      ref={sheetRef}
      data-testid="kg-sheet"
      role="dialog"
      aria-label={node.title}
      className="fixed inset-x-0 bottom-0 z-20 mx-auto max-h-[70dvh] max-w-3xl space-y-3 overflow-y-auto rounded-t-2xl border border-border bg-surface-1 p-4 shadow-2xl"
      style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-start gap-2">
        <h2 className="flex-1 text-base font-semibold">{node.title}</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="-m-1 shrink-0 px-2 py-1 text-xl leading-none text-muted"
        >
          ×
        </button>
      </div>
      {node.question && <p className="text-sm text-muted">Q: {node.question}</p>}
      {node.asOf && <p className="text-xs text-muted">As of {node.asOf}</p>}
      {node.type === 'fundamentals' && <FundamentalsTable symbol={symbol} />}
      {node.text && <p className="whitespace-pre-line text-sm">{node.text}</p>}
      {node.sources && node.sources.length > 0 && (
        <ul className="space-y-1 text-sm">
          {node.sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">Updated {etDate(node.updatedAt)}</p>
      {neighbours.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Connected</h3>
          <ul className="flex flex-wrap gap-2">
            {neighbours.map((n) => (
              <li key={n.node.id}>
                <button
                  type="button"
                  onClick={() => onSelect(n.node.id)}
                  className="rounded-lg border border-border px-2.5 py-1.5 text-left text-sm"
                >
                  <span className="text-xs text-muted">{n.label} · </span>
                  {n.node.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
