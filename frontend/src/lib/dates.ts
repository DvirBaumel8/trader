const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });

/** ET calendar date, e.g. "Oct 29". */
export const etDate = (iso: string) => fmt.format(new Date(iso));
