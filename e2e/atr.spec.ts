import { expect, test } from '@playwright/test';
import { signUpAndSignIn } from './helpers';

test('Show ATR adds ATR and Today columns on a phone without overflowing', async ({ page }) => {
  await page.goto('/login');
  await signUpAndSignIn(page, 'atr');
  await page.evaluate(async () => {
    const token = window.localStorage.getItem('trader.authToken.v1')!;
    const res = await fetch('/api/holdings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ symbols: ['NVDA', 'AMD'] }),
    });
    if (!res.ok) throw new Error(`seed failed: ${res.status}`);
  });
  await page.goto('/holdings');

  await expect(page.getByTestId('holding-NVDA')).toBeVisible();
  await expect(page.getByTestId('atr-NVDA')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show ATR' }).click();

  await expect(page.getByTestId('atr-NVDA')).toHaveText('2.0%');
  await expect(page.getByTestId('today-NVDA')).toHaveText('+5.0%');
  await expect(page.getByTestId('today-NVDA')).toHaveClass(/text-up/);
  await expect(page.getByTestId('today-AMD')).toHaveText('−3.0%');
  await expect(page.getByTestId('today-AMD')).toHaveClass(/text-down/);
  await expect(page.getByTestId('moves-header')).toContainText(/Today/);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // Remembered on the device.
  await page.reload();
  await expect(page.getByTestId('today-NVDA')).toHaveText('+5.0%');
});
