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
