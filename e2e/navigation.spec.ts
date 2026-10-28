import { expect, test } from '@playwright/test';
import { signUpAndSignIn } from './helpers';

test.describe('navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await signUpAndSignIn(page, 'nav');
  });

  test('reaches every tab in the nav', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder(/Talk to Trader/)).toBeVisible();

    await page.getByRole('link', { name: 'Holdings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Holdings' })).toBeVisible();

    await page.getByRole('link', { name: 'Watch', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Watchlist' })).toBeVisible();

    await page.getByRole('link', { name: 'Chat', exact: true }).click();
    await expect(page.getByPlaceholder(/Talk to Trader/)).toBeVisible();
  });
});
