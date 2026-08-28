import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

interface Tag {
  id: string;
  type: 'SETUP' | 'MISTAKE';
  label: string;
}

export function TagPicker({
  type,
  selected,
  onChange,
}: {
  type: 'SETUP' | 'MISTAKE';
  selected: string[];
  onChange: (labels: string[]) => void;
}) {
  const [input, setInput] = useState('');
  const { data } = useQuery({
    queryKey: ['tags'],
    queryFn: () => api<Tag[]>('/journal/tags'),
  });

  const existing = (data ?? []).filter((t) => t.type === type);
  const toggle = (label: string) =>
    onChange(
      selected.includes(label)
        ? selected.filter((l) => l !== label)
        : [...selected, label],
    );

  const add = () => {
    // Lowercased to match the server, so a new tag does not appear twice.
    const label = input.trim().toLowerCase();
    if (label && !selected.includes(label)) onChange([...selected, label]);
    setInput('');
  };

  return (
    <div className="space-y-1.5">
      <span className="text-xs text-muted">
        {type === 'SETUP' ? 'Setups' : 'Mistakes'}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {[...new Set([...existing.map((t) => t.label), ...selected])].map(
          (label) => (
            <button
              key={label}
              type="button"
              aria-pressed={selected.includes(label)}
              onClick={() => toggle(label)}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                selected.includes(label)
                  ? type === 'SETUP'
                    ? 'bg-accent/15 text-accent'
                    : 'bg-down/15 text-down'
                  : 'bg-surface-1 text-muted'
              }`}
            >
              {label}
            </button>
          ),
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={type === 'SETUP' ? 'add a setup' : 'add a mistake'}
          className="flex-1 rounded-lg border border-border bg-surface-1 px-2.5 py-1.5 text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={add}
          className="rounded-lg border border-border px-3 text-sm text-muted"
        >
          Add
        </button>
      </div>
    </div>
  );
}
