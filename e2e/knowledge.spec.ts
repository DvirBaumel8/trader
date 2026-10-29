import { expect, test, type Page } from '@playwright/test';
import { signUpAndSignIn } from './helpers';

/** Made-up content only: summary + 6 sections, each with a chain of 5 children (36 nodes) + 3 extras = 40. */
function buildGraph() {
  const nodes: { id: string; title: string; text: string }[] = [
    { id: 'summary', title: 'Summary', text: 'A made-up overview of the company.' },
  ];
  const edges: { from: string; to: string; label: string }[] = [];
  for (let s = 1; s <= 6; s++) {
    const sec = `sec-${s}`;
    nodes.push({ id: sec, title: `Section ${s}`, text: `Made-up text for section ${s}.` });
    edges.push({ from: 'summary', to: sec, label: `Part ${s}` });
    let prev = sec;
    for (let c = 1; c <= 5; c++) {
      const id = `sec-${s}-item-${c}`;
      nodes.push({ id, title: `Item ${s}.${c}`, text: `Made-up detail ${s}.${c}.` });
      edges.push({ from: prev, to: id, label: 'Next' });
      prev = id;
    }
  }
  // 1 + 6 + 30 = 37; three more leaves under section 1
  for (let x = 1; x <= 3; x++) {
    nodes.push({ id: `extra-${x}`, title: `Extra ${x}`, text: `Made-up extra ${x}.` });
    edges.push({ from: 'sec-1', to: `extra-${x}`, label: 'Also' });
  }
  nodes[2].text = 'Long made-up paragraph. ' + 'Lorem ipsum dolor sit amet. '.repeat(50).slice(0, 1370);
  nodes[2].title = 'Long one';
  return { nodes, edges };
}

async function seed(page: Page) {
  const body = buildGraph();
  await page.evaluate(async (b) => {
    const token = window.localStorage.getItem('trader.authToken.v1')!;
    const res = await fetch('/api/knowledge/NVDA', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ baseVersion: 0, message: 'seed', ...b }),
    });
    if (!res.ok) throw new Error(`seed failed: ${res.status} ${await res.text()}`);
  }, body);
}

test.describe('the Know tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await signUpAndSignIn(page, 'know');
    await seed(page);
  });

  test('five tabs fit the phone width', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation');
    for (const name of ['Chat', 'Holdings', 'Watch', 'Earnings', 'Know']) {
      await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('lists the graph, opens it, and shows a node sheet', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Know', exact: true }).click();
    const row = page.getByTestId('know-row-NVDA');
    await expect(row).toContainText('40 nodes');
    await expect(row.getByLabel('new')).toBeVisible();
    await row.click();

    await expect(page.getByTestId('kg-node-summary')).toBeVisible();
    await expect(page.getByTestId('kg-node-summary')).toContainText('Summary');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Tap the long node.
    await page.getByTestId('kg-node-sec-1-item-1').click();
    const sheet = page.getByTestId('kg-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Long made-up paragraph');
    const scrolls = await sheet.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrolls).toBe(true);
    const box = (await sheet.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
    await page.screenshot({ path: '.superpowers/sdd/2026-10-29-knowledge-graph/task-3-sheet.png' });

    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
  });

  test('Fit brings every node inside the canvas', async ({ page }) => {
    await page.goto('/knowledge/NVDA');
    await expect(page.getByTestId('kg-node-summary')).toBeVisible();
    await page.getByTestId('kg-fit').click();
    await page.waitForTimeout(500);
    const canvas = (await page.locator('.react-flow').boundingBox())!;
    const ids = (await page.locator('[data-testid^="kg-node-"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-testid')),
    )) as string[];
    expect(ids).toHaveLength(40);
    for (const id of ids) {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(canvas.x - 1);
      expect(b.y).toBeGreaterThanOrEqual(canvas.y - 1);
      expect(b.x + b.width).toBeLessThanOrEqual(canvas.x + canvas.width + 1);
      expect(b.y + b.height).toBeLessThanOrEqual(canvas.y + canvas.height + 1);
    }
    await page.screenshot({ path: '.superpowers/sdd/2026-10-29-knowledge-graph/task-3-graph.png' });
  });

  test('a ticker with no graph says so', async ({ page }) => {
    await page.goto('/knowledge/AMD');
    await expect(page.getByText('No knowledge on AMD yet — ask Claude to start it.')).toBeVisible();
  });
});
