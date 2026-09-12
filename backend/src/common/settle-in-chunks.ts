/**
 * `Promise.allSettled(items.map(fn))`, but at most `chunkSize` calls are ever
 * in flight at once — firing all of them together is what a call site does
 * by default, and for the watchlist ranking that meant up to fifty concurrent
 * `quoteSummary` requests to Yahoo from one Render IP, a project that already
 * has recorded trouble with Yahoo fundamentals from there.
 *
 * A small chunked loop rather than a worker pool: results still come back in
 * the same order as `items`, and never throws — a rejected call's slot is a
 * `{ status: 'rejected' }` entry, exactly as `Promise.allSettled` returns.
 * Pure and dependency-free, in the style of `derive.ts` and `risk.ts`.
 */
export async function settleInChunks<T, R>(
  items: T[],
  chunkSize: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    results.push(...(await Promise.allSettled(chunk.map(fn))));
  }
  return results;
}
