import { formatMoney, signClass } from './format';

export function Money({
  value,
  signed = false,
  colored = false,
  className = '',
}: {
  value: number | null | undefined;
  signed?: boolean;
  colored?: boolean;
  className?: string;
}) {
  return (
    <span className={`${colored ? signClass(value) : ''} ${className}`}>
      {formatMoney(value, { signed })}
    </span>
  );
}
