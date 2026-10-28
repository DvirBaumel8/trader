import { expect, test } from '@playwright/test';
import { signUpAndSignIn } from './helpers';

test.describe('the earnings tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await signUpAndSignIn(page, 'earnings');
    await page.evaluate(async () => {
      const token = window.localStorage.getItem('trader.authToken.v1')!;
      const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
      const ok = (r: Response) => {
        if (!r.ok) throw new Error(`seed failed: ${r.status}`);
      };
      ok(await fetch('/api/holdings', { method: 'POST', headers, body: JSON.stringify({ symbols: ['AMD'] }) }));
      ok(await fetch('/api/watchlist', { method: 'POST', headers, body: JSON.stringify({ symbols: ['SMCI'] }) }));
    });
    await page.goto('/earnings');
  });

  test('shows holdings and watchlist reports in their day columns and filters them', async ({ page }) => {
    const amd = page.getByTestId('earn-AMD');
    const smci = page.getByTestId('earn-SMCI');
    await expect(amd).toBeVisible();
    await expect(smci).toBeVisible();
    await expect(smci).toContainText('~SMCI');

    // Tuesday is the second of five columns; Thursday the fourth.
    const box = async (loc: typeof amd) => (await loc.boundingBox())!;
    const [a, s] = [await box(amd), await box(smci)];
    expect(a.x).toBeLessThan(s.x);

    await page.getByRole('button', { name: 'Holdings', exact: true }).click();
    await expect(amd).toBeVisible();
    await expect(smci).toHaveCount(0);
  });

  test('fits the phone width without overflow', async ({ page }) => {
    await expect(page.getByTestId('earn-AMD')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const cells = page.locator('[data-testid^="earn-"]');
    for (let i = 0; i < (await cells.count()); i++) {
      const fits = await cells.nth(i).evaluate((el) => el.scrollWidth <= el.clientWidth);
      expect(fits).toBe(true);
    }
  });
});
