import { expect, test } from '@playwright/test';
import { signUpAndSignIn } from './helpers';

test.describe('the chat', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await signUpAndSignIn(page, 'chat');
    await page.goto('/');
  });

  const box = (page: import('@playwright/test').Page) => page.getByPlaceholder(/Talk to Trader/);

  test('a buy in chat shows up in Holdings, and a sale removes it', async ({ page }) => {
    await box(page).fill('bought NVDA');
    await box(page).press('Enter');
    await expect(page.getByText('Added NVDA (long) to your holdings.')).toBeVisible();
    await page.getByRole('link', { name: 'Holdings' }).click();
    await expect(page.getByTestId('holding-NVDA')).toContainText('Long');
    await page.getByRole('link', { name: 'Chat' }).click();
    await box(page).fill('sold NVDA');
    await box(page).press('Enter');
    await expect(page.getByText('Removed NVDA from your holdings.')).toBeVisible();
  });

  test('answers a moving-average question', async ({ page }) => {
    await box(page).fill('is NVDA above 150 SMA?');
    await box(page).press('Enter');
    // The browser server's stub gives flat bars at the quote price, so price == average.
    await expect(page.getByText(/^Yes\. NVDA \(\$200\.00\) is 0\.00% above its 150-day SMA/)).toBeVisible();
  });

  test('turns free text into a prompt that can be copied', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await box(page).fill('watch AAPL');
    await box(page).press('Enter');
    await expect(page.getByText('Watching AAPL.')).toBeVisible();
    await box(page).fill('what should I look at this week?');
    await box(page).press('Enter');
    await expect(page.getByText('Prompt for Gemini')).toBeVisible();
    await expect(page.locator('pre')).toContainText('My watchlist: AAPL');
    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByRole('button', { name: /Copied|Copy/ })).toBeVisible();
  });
});
