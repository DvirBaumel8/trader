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

    await page.getByRole('link', { name: 'Earnings', exact: true }).click();
    await expect(page.getByRole('heading', { name: /^Earnings · / })).toBeVisible();

    await page.getByRole('link', { name: 'Chat', exact: true }).click();
    await expect(page.getByPlaceholder(/Talk to Trader/)).toBeVisible();
  });

  test('keeps the Add button on one line without horizontal overflow', async ({ page }) => {
    await page.goto('/');
    for (const [link, heading] of [['Holdings', 'Holdings'], ['Watch', 'Watchlist']]) {
      await page.getByRole('link', { name: link, exact: true }).click();
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();

      const button = page.getByRole('button', { name: 'Add', exact: true });
      await expect(button).toBeVisible();
      const { height, lineHeight, paddingY } = await button.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          height: el.getBoundingClientRect().height,
          lineHeight: parseFloat(cs.lineHeight),
          paddingY: parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth),
        };
      });
      // One line of text plus padding/border: a wrapped label would add a whole extra line.
      expect(height - paddingY).toBeLessThan(lineHeight * 1.6);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
});
