import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved relative to THIS compiled file (backend/dist/llm/trader-profile.js)
// rather than process.cwd(), so it also works on Render: the repo ships whole
// (see render.yaml's `rootDir: backend`), the profile just lives one level
// above `backend/`, and this stays correct in dev too since Nest always runs
// from dist, never ts-node in place. This is the resolution `llm.service.ts`
// and `trade-review.service.ts` already used; `trade-idea.service.ts` and
// `watchlist-ranking.service.ts` instead used `join(process.cwd(), '..',
// 'docs', 'trader-profile.md')` — which happens to agree with this today
// (nest start, node dist/main, and the e2e/browser test servers all launch
// with `backend/` as the working directory) but is one accidental layout
// change away from disagreeing silently: both fall back to "no profile" on a
// miss, with no error anywhere, so a deployment change could strip the
// owner's edge out of every AI feature at once.
const PROFILE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/trader-profile.md',
);

/**
 * The owner's trading profile — his setups, his rules, his stated
 * weaknesses — read fresh on every call (a small file; re-reading it costs
 * nothing next to the model call it feeds) and given to every AI feature's
 * prompt. Null, never a thrown error, when the file is missing: a deploy
 * without `docs/`, or before he has been interviewed, is a normal state, not
 * a failure — every caller renders an honest fallback rather than breaking.
 *
 * One copy shared by `llm.service.ts`, `trade-review.service.ts`,
 * `trade-idea.service.ts` and `watchlist-ranking.service.ts`, which used to
 * each resolve this path themselves in two silently-incompatible ways. See
 * `PROFILE_PATH` above for which one this keeps and why.
 */
export async function readTraderProfile(): Promise<string | null> {
  try {
    return await readFile(PROFILE_PATH, 'utf-8');
  } catch {
    return null;
  }
}
