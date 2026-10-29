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

test('tapping Today sorts the rows and tapping again reverses, third tap restores My order', async ({ page }) => {
  await page.goto('/login');
  await signUpAndSignIn(page, 'atrsort');
  await page.evaluate(async () => {
    const token = window.localStorage.getItem('trader.authToken.v1')!;
    const res = await fetch('/api/holdings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ symbols: ['AMD', 'NVDA'] }),
    });
    if (!res.ok) throw new Error(`seed failed: ${res.status}`);
  });
  await page.goto('/holdings');
  await page.getByRole('button', { name: 'Show ATR' }).click();
  await expect(page.getByTestId('today-NVDA')).toHaveText('+5.0%');

  const order = () => page.locator('[data-testid^="holding-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  const today = page.getByRole('button', { name: /^Sort by Today/ });
  expect(await order()).toEqual(['holding-AMD', 'holding-NVDA']);
  await today.click();
  expect(await order()).toEqual(['holding-NVDA', 'holding-AMD']);
  await expect(today).toHaveAttribute('aria-sort', 'descending');
  await today.click();
  expect(await order()).toEqual(['holding-AMD', 'holding-NVDA']);
  await today.click();
  await expect(today).toHaveAttribute('aria-sort', 'none');
});

test('the active closed-session Today header fits its column and has a tappable height', async ({ page }) => {
  await page.route('**/api/market/moves*', async (route) => {
    const symbols = new URL(route.request().url()).searchParams.get('symbols')!.split(',');
    await route.fulfill({
      json: symbols.map((symbol) => ({ symbol, atrPercent: 2, movePercent: symbol === 'NVDA' ? 5 : -3, live: false, asOf: '2026-10-28' })),
    });
  });
  await page.goto('/login');
  await signUpAndSignIn(page, 'atrclose');
  await page.evaluate(async () => {
    const token = window.localStorage.getItem('trader.authToken.v1')!;
    const res = await fetch('/api/holdings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ symbols: ['AMD', 'NVDA'] }),
    });
    if (!res.ok) throw new Error(`seed failed: ${res.status}`);
  });
  await page.goto('/holdings');
  await page.getByRole('button', { name: 'Show ATR' }).click();
  const today = page.getByRole('button', { name: /^Sort by Today/ });
  await expect(today).toContainText('Today (close)');
  await today.click();
  await expect(today).toContainText('▼');

  const box = (await today.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.height).toBeGreaterThanOrEqual(32);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // The label must not spill out of its own button either.
  const spill = await today.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(spill).toBeLessThanOrEqual(0);
});
