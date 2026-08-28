/**
 * Three ascending bars — the shape of a good run. Deliberately simple geometry
 * so it stays legible at favicon size, and the tallest bar carries the accent
 * so the mark has a focal point instead of reading as a flat block.
 */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label="Trader"
    >
      <rect x="2.5" y="14" width="4.5" height="7.5" rx="1.6" fill="#3d4d68" />
      <rect x="9.75" y="9" width="4.5" height="12.5" rx="1.6" fill="#4f6485" />
      <rect x="17" y="2.5" width="4.5" height="19" rx="1.6" fill="#2dd4bf" />
    </svg>
  );
}
