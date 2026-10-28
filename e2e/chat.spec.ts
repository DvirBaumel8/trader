import { expect, test } from '@playwright/test';
import { signUpAndSignIn } from './helpers';

test.describe('the chat', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await signUpAndSignIn(page, 'chat');
    await page.goto('/');
  });

  const box = (page: import('@playwright/test').Page) => page.getByPlaceholder(/Talk to Trader/);
  const send = async (page: import('@playwright/test').Page, text: string) => {
    await box(page).fill(text);
    await box(page).press('Enter');
  };

  test('a buy shows up in Holdings, and a sale moves it to the watchlist', async ({ page }) => {
    await send(page, 'bought NVDA');
    await expect(page.getByText('Added (long): NVDA')).toBeVisible();
    await page.getByRole('link', { name: 'Holdings' }).click();
    await expect(page.getByTestId('holding-NVDA')).toContainText('Long');
    await page.getByRole('link', { name: 'Chat' }).click();
    await send(page, 'sold NVDA');
    await expect(page.getByText('Sold and moved to watchlist: NVDA')).toBeVisible();
    await page.getByRole('link', { name: 'Watch' }).click();
    await expect(page.getByTestId('watch-NVDA')).toBeVisible();
  });

  test('a pasted list adds every ticker to Holdings', async ({ page }) => {
    await send(page, 'Bought: 1. AMD 2. SMCI');
    await expect(page.getByText('Added (long): AMD, SMCI')).toBeVisible();
    await page.getByRole('link', { name: 'Holdings' }).click();
    await expect(page.getByTestId('holding-AMD')).toBeVisible();
    await expect(page.getByTestId('holding-SMCI')).toBeVisible();
  });

  test('turns free text into a prompt that can be copied', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await send(page, 'watch AAPL');
    await expect(page.getByText('Watching: AAPL')).toBeVisible();
    await send(page, 'what should I look at this week?');
    await expect(page.getByText('Prompt for Gemini')).toBeVisible();
    await expect(page.locator('pre')).toContainText('My watchlist:');
    await expect(page.locator('pre')).toContainText('AAPL');
    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByRole('button', { name: /Copied|Copy/ })).toBeVisible();
  });
});
