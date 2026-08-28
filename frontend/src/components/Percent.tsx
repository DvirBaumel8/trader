import { formatPercent, signClass } from './format';

export function Percent({
  value,
  colored = true,
  className = '',
}: {
  value: number | null | undefined;
  colored?: boolean;
  className?: string;
}) {
  return (
    <span className={`${colored ? signClass(value) : ''} ${className}`}>
      {formatPercent(value)}
    </span>
  );
}
