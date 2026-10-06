import { expect, test } from '@playwright/test';
import { signUpAndSignIn } from './helpers';

test.describe('trade composer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await signUpAndSignIn(page, 'composer');
  });

  // A previewed net cash is a number the owner never typed. In WebKit, typing
  // into it must replace the preview, not append to it — jsdom cannot tell.
  test('typing over a previewed net cash replaces it', async ({ page }) => {
    await page.goto('/journal');
    await page.getByRole('button', { name: 'New entry' }).click();
    await page.getByPlaceholder('NVDA').fill('NVDA');
    await page.getByPlaceholder('qty').fill('10');
    await page.getByPlaceholder('price').fill('100');

    const netCash = page.getByLabel('Platform net cash');
    await expect(netCash).toHaveValue('1004');

    await netCash.tap();
    await page.keyboard.type('1003.5');
    await expect(netCash).toHaveValue('1003.5');
  });
});
