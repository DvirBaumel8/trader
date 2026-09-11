import { AsyncLocalStorage } from 'node:async_hooks';

export interface UserContext {
  /** The authenticated user's id, or null for an unauthenticated request. */
  userId: string | null;
}

/**
 * Who the current request belongs to.
 *
 * AsyncLocalStorage rather than threading a userId through eleven services:
 * every one of them already called `ensureDefaultUser()` with no argument, so
 * passing an id would have meant changing every signature between the
 * controller and the query — a large diff whose only purpose is transport.
 * This keeps the change to one middleware and one method
 * (`UsersService.currentUser`).
 *
 * Set once per request by UserContextMiddleware, which runs before the guard,
 * so by the time any service asks, the answer is already there.
 */
export const userContext = new AsyncLocalStorage<UserContext>();

export function currentUserId(): string | null {
  return userContext.getStore()?.userId ?? null;
}
