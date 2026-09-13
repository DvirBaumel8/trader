/**
 * A native `<select>` with the app's own chevron, rather than a custom menu:
 * iOS renders its own picker wheel, which is a better control than anything
 * hand-built. Extracted after this exact shell — label, select,
 * `appearance-none` paired with this chevron — turned up independently in
 * Dashboard's and Stops' own sort pickers; a third screen needing the same
 * thing is the sweep this app's own convention asks for, not a third copy.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  srLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  srLabel: string;
}) {
  return (
    <label className="relative shrink-0">
      <span className="sr-only">{srLabel}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="appearance-none rounded-lg border border-border bg-surface-1 py-1.5 pr-7 pl-2.5 text-xs text-muted outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[9px] text-muted"
      >
        ▼
      </span>
    </label>
  );
}
