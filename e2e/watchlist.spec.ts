import { expect, test, type Page } from '@playwright/test';
import { signUpAndSignIn } from './helpers';

async function addStocks(
  page: Page,
  symbols: string,
  { target, expectFailure = false }: { target?: string; expectFailure?: boolean } = {},
) {
  await page.getByRole('button', { name: 'Add stocks' }).click();
  const composer = page.getByRole('dialog', { name: 'Add to watchlist' });
  await composer.getByPlaceholder('NVDA, AMD, TSLA').fill(symbols);
  if (target !== undefined) {
    await composer.getByPlaceholder('target (optional)').fill(target);
  }
  await composer.getByRole('button', { name: 'Watch 1 stock', exact: true }).click();
  if (!expectFailure) {
    // The sheet intentionally stays open after adding. Wait for the successful
    // mutation to clear its input, then dismiss it before using the page.
    await expect(composer.getByPlaceholder('NVDA, AMD, TSLA')).toHaveValue('');
    await composer.getByRole('button', { name: 'Close' }).click();
    await expect(composer).toHaveCount(0);
  }
}

test.describe('the watchlist', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await signUpAndSignIn(page, 'watch');
    await page.goto('/watchlist');
  });

  test('watches a ticker, then stops watching it', async ({ page }) => {
    await addStocks(page, 'NVDA');

    await expect(page.getByTestId('watch-NVDA')).toBeVisible();
    // Optional target, as he asked — a ticker can be watched without one.
    await expect(page.getByTestId('watch-NVDA')).toContainText('no target set');

    await page.getByRole('button', { name: 'Edit watchlist' }).click();
    await page.getByRole('button', { name: /^Delete$/ }).click();
    await page.getByRole('button', { name: /^Delete$/ }).click();

    await expect(page.getByText(/Nothing watched yet/)).toBeVisible();
  });

  /**
   * The feature he called super important: tell me, when I open the page,
   * which tickers reached the price I set. A target at the current price is
   * reached the moment it is set.
   */
  test('announces a ticker that reached its target', async ({ page }) => {
    // The stub prices NVDA at exactly 200, so a target there is reached the
    // moment it is set. This doubles as the suite's proof that it is talking
    // to the stub and not the live market: against a real quote the number
    // would be wrong every day, which is how the missing override was found.
    await addStocks(page, 'NVDA', { target: '200' });

    await expect(page.getByText(/reached your target/i)).toBeVisible();
    await expect(page.getByText('target hit')).toBeVisible();

    // And stops shouting once acknowledged, without forgetting it happened.
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByText(/reached your target/i)).toHaveCount(0);
    await expect(page.getByText('target hit')).toBeVisible();
  });

  test('refuses a ticker that does not exist, by name', async ({ page }) => {
    await addStocks(page, 'ZZZZNOTREAL', { expectFailure: true });
    await expect(page.getByRole('dialog', { name: 'Add to watchlist' })).toContainText('Could not add: ZZZZNOTREAL');
  });

  /** Delete is never ambient — the rule every list in the app follows. */
  test('offers no delete until edit mode is on', async ({ page }) => {
    await addStocks(page, 'NVDA');
    await expect(page.getByTestId('watch-NVDA')).toBeVisible();

    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  });

  test('shows price, target, and earnings facts on the iPhone screen', async ({ page }) => {
    await addStocks(page, 'NVDA');

    const row = page.getByTestId('watch-NVDA');
    await expect(row).toBeVisible();
    await expect(row).toContainText('NVDA');
    await expect(row).toContainText('$200.00');
    await expect(row).toContainText('no target set');
    // One header for the table; no field labels inside the row.
    await expect(row).not.toContainText('Earnings');
    await expect(page.getByRole('button', { name: /^Target/ })).toHaveCount(1);
    // The row is `display: contents`, so measure its cells and every line.
    const fitsScreen = await row.evaluate((el) => {
      const cells = Array.from(el.children) as HTMLElement[];
      const lines = cells.flatMap((c) => Array.from(c.children) as HTMLElement[]);
      return (
        cells.length === 4 &&
        cells.every((c) => {
          const { left, right } = c.getBoundingClientRect();
          return left >= 0 && right <= window.innerWidth;
        }) &&
        lines.every((l) => l.scrollWidth <= l.clientWidth) &&
        document.documentElement.scrollWidth <= window.innerWidth
      );
    });
    expect(fitsScreen).toBe(true);
  });

  /**
   * The ranking is the one screen a browser test earns its keep on: the
   * order it renders comes straight from the stubbed model's [RANK] blocks
   * (`backend/src/main.e2e.ts`), so a wiring mistake between the parsed
   * order and the list would show here and nowhere faster. The second half —
   * the reasoning staying collapsed on a normal page view — is the assertion
   * worth having: it is invisible to every unit test and it regressed once
   * already during this feature's development.
   */
  test('ranks the watchlist and keeps the reasoning collapsed until opened', async ({
    page,
  }) => {
    await addStocks(page, 'AAPL');
    await expect(page.getByTestId('watch-AAPL')).toBeVisible();

    await addStocks(page, 'NVDA');
    await expect(page.getByTestId('watch-NVDA')).toBeVisible();

    await page.getByRole('button', { name: 'Rank watchlist' }).click();

    // The stub always answers AAPL first, NVDA second — see
    // RANKING_STUB_ANSWER in main.e2e.ts.
    const rankedItems = page.locator('ol li');
    await expect(rankedItems).toHaveCount(2);
    await expect(rankedItems.nth(0)).toContainText('AAPL');
    await expect(rankedItems.nth(1)).toContainText('NVDA');

    // A refresh just triggered opens the reasoning immediately — it was
    // just asked for. A plain reload instead reads the CACHED ranking rather
    // than triggering a new one, so the reasoning card returns to its
    // resting, collapsed state — the case the assertion below is about.
    await page.reload();
    await expect(rankedItems.nth(0)).toContainText('AAPL');

    await expect(page.getByText(/Stub reasoning/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Show ranking' }).click();
    await expect(page.getByText(/Stub reasoning/)).toBeVisible();
  });
});
