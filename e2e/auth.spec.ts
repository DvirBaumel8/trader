import { expect, test } from '@playwright/test';

test.describe('signing in', () => {
  /**
   * The owner's account predates accounts entirely — no email, no password of
   * its own — so a device that has never signed anyone in must default to the
   * shared app password. If this breaks, a deploy locks him out of his own
   * portfolio, which is why it is the first test in the suite.
   */
  test('defaults to the app password on a fresh device', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByPlaceholder('Password')).toBeVisible();
    await expect(page.getByPlaceholder('Email')).toHaveCount(0);
  });

  test('signs the owner in with the app password', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('Password').fill('e2e-password');
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('link', { name: 'Portfolio' })).toBeVisible();
  });

  test('refuses the wrong app password, and says so', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.getByText(/wrong password/i)).toBeVisible();
    await expect(page).toHaveURL(/login/);
  });

  test('creates an account with an email and lands in the app', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /Create an account/ }).click();
    await page.getByPlaceholder('Email').fill(`new-${Date.now()}@e2e.local`);
    await page.getByPlaceholder(/8\+ characters/).fill('e2e-password-1234');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/$/);
  });
});
