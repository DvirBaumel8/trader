const DAY_MS = 24 * 60 * 60 * 1000;

export function parseEarningsDate(value: unknown): string | null {
  const raw =
    typeof value === 'object' && value !== null && 'raw' in value
      ? (value as { raw?: unknown }).raw
      : value;
  const date =
    raw instanceof Date
      ? raw
      : typeof raw === 'number'
        ? new Date(raw * 1000)
      : typeof raw === 'string'
        ? new Date(raw)
        : null;
  if (!date || !Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function daysUntilEarnings(
  earningsDate: string | null,
  today = new Date().toISOString().slice(0, 10),
): number | null {
  if (!earningsDate) return null;
  const start = Date.parse(`${today}T00:00:00Z`);
  const event = Date.parse(`${earningsDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(event) || event < start) {
    return null;
  }
  return Math.round((event - start) / DAY_MS);
}
