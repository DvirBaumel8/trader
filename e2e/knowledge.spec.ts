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
  nodes[7].text = 'Long made-up paragraph. ' + 'Lorem ipsum dolor sit amet. '.repeat(50).slice(0, 1370);
  nodes[7].title = 'Long one';
  return { nodes, edges };
}

function buildStarter() {
  const nodes = [{ id: 'summary', title: 'Summary', text: 'Made-up overview.' }];
  const edges: { from: string; to: string; label: string }[] = [];
  for (const t of ['CEO', 'Revenue', 'Products', 'Risks', 'Rivals', 'Outlook']) {
    const id = t.toLowerCase();
    nodes.push({ id, title: t, text: `Made-up ${t} text.` });
    edges.push({ from: 'summary', to: id, label: t });
  }
  return { nodes, edges };
}

async function seed(page: Page, symbol = 'NVDA', body = buildGraph()) {
  await page.evaluate(async ([sym, b]) => {
    const token = window.localStorage.getItem('trader.authToken.v1')!;
    const res = await fetch(`/api/knowledge/${sym}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ baseVersion: 0, message: 'seed', ...b }),
    });
    if (!res.ok) throw new Error(`seed failed: ${res.status} ${await res.text()}`);
  }, [symbol, body] as const);
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
    await page.getByTestId('kg-node-sec-2').click();
    const sheet = page.getByTestId('kg-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Long made-up paragraph');
    const scrolls = await sheet.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrolls).toBe(true);
    const box = (await sheet.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
    await page.screenshot({ path: '.superpowers/sdd/2026-10-29-knowledge-graph/task-3-fix-sheet.png' });

    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
  });

  test('Fit brings every node inside the canvas after panning away', async ({ page }) => {
    await page.goto('/knowledge/NVDA');
    await expect(page.getByTestId('kg-node-summary')).toBeVisible();
    const canvas = (await page.locator('.react-flow').boundingBox())!;
    const allInside = async () => {
      const ids = (await page.locator('[data-testid^="kg-node-"]').evaluateAll((els) =>
        els.map((e) => e.getAttribute('data-testid')),
      )) as string[];
      let inside = ids.length === 40;
      for (const id of ids) {
        const b = (await page.getByTestId(id).boundingBox())!;
        inside =
          inside &&
          b.x >= canvas.x - 1 &&
          b.y >= canvas.y - 1 &&
          b.x + b.width <= canvas.x + canvas.width + 1 &&
          b.y + b.height <= canvas.y + canvas.height + 1;
      }
      return inside;
    };
    // Drag the canvas well away (mobile WebKit: use mouse drag on the pane).
    await page.mouse.move(canvas.x + 200, canvas.y + 200);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 20, canvas.y + 40, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    expect(await allInside()).toBe(false);

    await page.getByTestId('kg-fit').click();
    await page.waitForTimeout(600);
    expect(await allInside()).toBe(true);
    await page.screenshot({ path: '.superpowers/sdd/2026-10-29-knowledge-graph/task-3-fix-fit.png' });
  });

  test('a starter pack opens fully visible and readable', async ({ page }) => {
    await seed(page, 'AMD', buildStarter());
    await page.goto('/knowledge/AMD');
    await expect(page.getByTestId('kg-node-summary')).toBeVisible();
    await page.waitForTimeout(400);
    const canvas = (await page.locator('.react-flow').boundingBox())!;
    for (const id of ['summary', 'ceo', 'revenue', 'products', 'risks', 'rivals', 'outlook']) {
      const node = page.getByTestId(`kg-node-${id}`);
      await expect(node).toBeVisible();
      const b = (await node.boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(30);
      expect(b.x).toBeGreaterThanOrEqual(canvas.x - 1);
      expect(b.y).toBeGreaterThanOrEqual(canvas.y - 1);
      expect(b.x + b.width).toBeLessThanOrEqual(canvas.x + canvas.width + 1);
      expect(b.y + b.height).toBeLessThanOrEqual(canvas.y + canvas.height + 1);
    }
    await page.screenshot({ path: '.superpowers/sdd/2026-10-29-knowledge-graph/task-3-fix-starter.png' });
  });

  test('a newly selected neighbour opens its sheet at the top', async ({ page }) => {
    await page.goto('/knowledge/NVDA');
    await page.getByTestId('kg-node-sec-2').click();
    const sheet = page.getByTestId('kg-sheet');
    await sheet.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    expect(await sheet.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await sheet.getByRole('button', { name: /Summary/ }).click();
    await expect(page.getByTestId('kg-sheet')).toContainText('A made-up overview of the company.');
    expect(await page.getByTestId('kg-sheet').evaluate((el) => el.scrollTop)).toBe(0);
  });

  test('a ticker with no graph says so', async ({ page }) => {
    await page.goto('/knowledge/AMD');
    await expect(page.getByText('No knowledge on AMD yet — ask Claude to start it.')).toBeVisible();
  });
});
