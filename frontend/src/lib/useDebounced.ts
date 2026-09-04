import { useEffect, useState } from 'react';

/**
 * Waits for a pause before passing a value on.
 *
 * Used wherever typing drives a request: without it every keystroke is a
 * round-trip, and the result flickers through the values of a half-typed
 * number or word, which is worse than showing nothing for a beat.
 */
export function useDebounced<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
