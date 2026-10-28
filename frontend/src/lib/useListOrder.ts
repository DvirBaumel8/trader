import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';

/**
 * Saving a drag order. The cache is reordered at once (optimistic); if the
 * server refuses, the previous order comes back and `error` says why. The
 * server's list stays the source of truth, so it is refetched either way.
 */
export function useListOrder<T extends { symbol: string }>(
  key: QueryKey,
  save: (symbols: string[]) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (next: T[]) => save(next.map((r) => r.symbol)),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<T[]>(key);
      queryClient.setQueryData(key, next);
      return { previous };
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  return {
    reorder: (next: T[]) => mutation.mutate(next),
    error: mutation.isError ? (mutation.error as Error).message : null,
    clearError: () => mutation.reset(),
  };
}
