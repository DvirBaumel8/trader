import { expect, test } from '@playwright/test';
import { signUpAndSignIn } from './helpers';

test.describe('the watchlist', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await signUpAndSignIn(page, 'watch');
    await page.goto('/watchlist');
  });

  test('watches a ticker, then stops watching it', async ({ page }) => {
    await page.getByPlaceholder('NVDA').fill('NVDA');
    await page.getByRole('button', { name: 'Watch' }).click();

    await expect(page.getByText('NVDA', { exact: true })).toBeVisible();
    // Optional target, as he asked — a ticker can be watched without one.
    await expect(page.getByText('no target set')).toBeVisible();

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
    await page.getByPlaceholder('NVDA').fill('NVDA');
    // The stub prices NVDA at exactly 200, so a target there is reached the
    // moment it is set. This doubles as the suite's proof that it is talking
    // to the stub and not the live market: against a real quote the number
    // would be wrong every day, which is how the missing override was found.
    await page.getByPlaceholder('target').fill('200');
    await page.getByRole('button', { name: 'Watch' }).click();

    await expect(page.getByText(/reached your target/i)).toBeVisible();
    await expect(page.getByText('target hit')).toBeVisible();

    // And stops shouting once acknowledged, without forgetting it happened.
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByText(/reached your target/i)).toHaveCount(0);
    await expect(page.getByText('target hit')).toBeVisible();
  });

  test('refuses a ticker that does not exist, by name', async ({ page }) => {
    await page.getByPlaceholder('NVDA').fill('ZZZZNOTREAL');
    await page.getByRole('button', { name: 'Watch' }).click();
    await expect(page.getByText(/No ticker called/)).toBeVisible();
  });

  /** Delete is never ambient — the rule every list in the app follows. */
  test('offers no delete until edit mode is on', async ({ page }) => {
    await page.getByPlaceholder('NVDA').fill('NVDA');
    await page.getByRole('button', { name: 'Watch' }).click();
    await expect(page.getByText('NVDA', { exact: true })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
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
    await page.getByPlaceholder('NVDA').fill('AAPL');
    await page.getByRole('button', { name: 'Watch', exact: true }).click();
    await expect(page.getByText('AAPL', { exact: true })).toBeVisible();

    // By now "Rank watchlist" / "Edit watchlist" / "AI opinion on the best
    // watchlist candidate" have all appeared, and each contains "Watch" —
    // getByRole matches substrings, so the plain add-a-ticker spec above
    // gets away without `exact` only because it never adds a second ticker.
    await page.getByPlaceholder('NVDA').fill('NVDA');
    await page.getByRole('button', { name: 'Watch', exact: true }).click();
    await expect(page.getByText('NVDA', { exact: true })).toBeVisible();

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
