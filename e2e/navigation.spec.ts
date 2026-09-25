import { expect, test } from '@playwright/test';
import { signUpAndSignIn } from './helpers';

test.describe('navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await signUpAndSignIn(page, 'nav');
  });

  test('reaches every tab in the nav', async ({ page }) => {
    await page.goto('/');
    // `exact`, because getByRole matches a substring by default and the empty
    // portfolio offers a "Seed your portfolio" link that also contains
    // "Portfolio".
    for (const tab of ['Journal', 'Stops', 'Watch', 'Brief', 'Portfolio']) {
      await page.getByRole('link', { name: tab, exact: true }).click();
      await expect(page.getByRole('link', { name: tab, exact: true })).toBeVisible();
    }
  });

  test('opens Brief from top navigation and Ideas from Watch, then returns', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Brief', exact: true }).click();
    await expect(page).toHaveURL(/\/brief$/);
    await expect(page.getByRole('heading', { name: 'Daily brief' })).toBeVisible();

    await page.getByRole('link', { name: 'Watch', exact: true }).click();
    await expect(page).toHaveURL(/\/watchlist$/);
    await page.getByRole('link', { name: 'Ideas', exact: true }).click();
    await expect(page).toHaveURL(/\/watchlist\/ideas$/);
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/watchlist$/);
  });

  test('Back from a first-load legacy Ideas bookmark returns to Watch', async ({ context }) => {
    const direct = await context.newPage();
    await direct.goto('/ideas');
    await expect(direct).toHaveURL(/\/watchlist\/ideas$/);
    await direct.getByRole('button', { name: 'Back' }).click();
    await expect(direct).toHaveURL(/\/watchlist$/);
    await direct.close();
  });

  test('Brief uses the offline Federal Reserve fixture', async ({ page }) => {
    await page.goto('/brief');
    await expect(page.getByText('Federal Reserve browser fixture')).toBeVisible();
  });

  test('shows every holding fact without horizontal clipping on iPhone', async ({ page }) => {
    const response = await page.evaluate(async () => {
      const token = localStorage.getItem('trader.authToken.v1');
      return fetch('/api/journal', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          kind: 'TRADE', body: 'phone row fixture', occurredAt: new Date().toISOString(),
          trade: { symbol: 'NVDA', quantity: 1, price: 100, fee: 0 },
        }),
      }).then((result) => result.status);
    });
    expect(response).toBe(201);
    await page.goto('/');

    const holding = page.getByTestId('holding-NVDA');
    await expect(holding).toBeVisible();
    // One header for the whole table, not a label per row.
    await expect(holding).not.toContainText('Qty');
    await expect(holding).toContainText('@');
    await expect(page.getByRole('button', { name: /^Last/ })).toHaveCount(1);
    // The row is `display: contents` (no box of its own), so measure its
    // cells, and every line inside them: a truncated line is a hidden fact.
    const geometry = await holding.evaluate((el) => {
      const cells = Array.from(el.children) as HTMLElement[];
      const lines = cells.flatMap((c) => Array.from(c.children) as HTMLElement[]);
      return {
        viewport: window.innerWidth,
        fits:
          cells.length === 4 &&
          cells.every((c) => {
            const { left, right } = c.getBoundingClientRect();
            return left >= 0 && right <= window.innerWidth;
          }) &&
          lines.every((l) => l.scrollWidth <= l.clientWidth),
        noPageOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      };
    });
    expect(geometry.viewport).toBe(390);
    expect(geometry.fits).toBe(true);
    expect(geometry.noPageOverflow).toBe(true);
  });

  /**
   * The bug that shipped: Back called navigate(-1), and on a page reached by
   * a reload — or opened straight from the home screen — there is nothing to
   * go back to, so the button did nothing at all. Invisible to every unit
   * test, because the component rendered perfectly.
   */
  test('Back works on a trade opened as the first page of a session', async ({ page }) => {
    // A trade id that does not resolve still renders the page and its Back
    // button, which is all this is about.
    await page.goto('/trades/NOPE%3A2026-01-01T00%3A00%3A00.000Z');
    await page.getByRole('button', { name: /Back/ }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
