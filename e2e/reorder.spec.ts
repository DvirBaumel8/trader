import { expect, test } from '@playwright/test';
import { signUpAndSignIn } from './helpers';

test.describe('reordering holdings', () => {
  test('dragging the last holding to the top is still there after a reload', async ({ page }) => {
    await page.goto('/login');
    await signUpAndSignIn(page, 'reorder');
    await page.evaluate(async () => {
      const token = window.localStorage.getItem('trader.authToken.v1')!;
      const res = await fetch('/api/holdings', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ symbols: ['AMD', 'NVDA', 'SMCI'] }),
      });
      if (!res.ok) throw new Error(`seed failed: ${res.status}`);
    });
    await page.goto('/holdings');

    const symbols = () =>
      page.locator('[data-testid^="holding-"]').evaluateAll((els) =>
        els.map((el) => el.getAttribute('data-testid')!.replace('holding-', '')),
      );
    await expect.poll(symbols).toEqual(['AMD', 'NVDA', 'SMCI']);

    await page.getByRole('button', { name: 'Edit holdings' }).click();
    const from = (await page.getByRole('button', { name: 'Reorder SMCI' }).boundingBox())!;
    const to = (await page.getByRole('button', { name: 'Reorder AMD' }).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    // Several steps: dnd-kit needs movement past its 4px threshold, then to track the pointer.
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 10, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 - 10, { steps: 12 });
    await page.mouse.up();

    await expect.poll(symbols).toEqual(['SMCI', 'AMD', 'NVDA']);
    await page.reload();
    await expect.poll(symbols).toEqual(['SMCI', 'AMD', 'NVDA']);
  });
});
