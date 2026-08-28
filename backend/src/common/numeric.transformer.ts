import { ValueTransformer } from 'typeorm';

/**
 * Postgres `numeric` arrives over the wire as a string. Every money or quantity
 * column uses this so the rest of the codebase only ever sees numbers.
 */
export const numericTransformer: ValueTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null =>
    value === null || value === undefined ? null : parseFloat(value),
};
