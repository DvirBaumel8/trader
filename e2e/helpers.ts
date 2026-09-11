import type { Page } from '@playwright/test';

/**
 * Signing in without going through the form.
 *
 * Each spec creates its OWN account, which is the cleanest isolation
 * available now that the app is multi-user: specs cannot see each other's
 * data even though they share one database, so they need no truncation
 * between them and no ordering rules.
 *
 * The sign-in FORM is exercised by the auth spec, on purpose. Everywhere
 * else, going through it would test the same three fields twenty times and
 * make every other spec fail when they change.
 */
export async function signUpAndSignIn(page: Page, label: string): Promise<void> {
  const email = `${label}-${Date.now()}@e2e.local`;
  const session = await page.evaluate(
    async ([addr]) => {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: addr, password: 'e2e-password-1234' }),
      });
      if (!res.ok) throw new Error(`signup failed: ${res.status}`);
      return (await res.json()) as { accessToken: string; user: unknown };
    },
    [email],
  );

  await page.evaluate(
    ([token, user]) => {
      window.localStorage.setItem('trader.authToken.v1', token as string);
      window.localStorage.setItem('trader.identity.v1', JSON.stringify(user));
    },
    [session.accessToken, session.user] as const,
  );

  /**
   * Prove the token actually works before handing control back.
   *
   * Without this a bad token fails far from its cause: the app's client
   * clears it on any 401 and redirects to /login, so the spec reports
   * "timed out waiting for a nav link" on a page that is no longer the app.
   * Ten seconds of confusion for something a status code says outright.
   */
  const status = await page.evaluate(async ([token]) => {
    const res = await fetch('/api/settings', {
      headers: { authorization: `Bearer ${token as string}` },
    });
    return res.status;
  }, [session.accessToken] as const);

  if (status !== 200) {
    throw new Error(`signed-in token was rejected: /api/settings returned ${status}`);
  }
}
