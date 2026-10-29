# Knowledge Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Each task is shipped (pushed to `main` and deployed) on its own once reviewed — owner's hard rule. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A private, versioned node graph per ticker that Claude edits with a `kb` command-line tool and the owner views in a new `Know` tab, with a live Fundamentals node for companies, delivered as five independently shippable tasks.

**Architecture:** Backend `knowledge` module: two tables (current graph + versions), a pure `graph.ts` (validation, node timestamps, "new" logic) shared with the CLI, and `/knowledge` endpoints accepting either a login token or a hashed `kb_` API key (key auth only on routes marked `@AllowApiKey()`). CLI at `backend/tools/kb/` (tsx) applies one small edit per command via `GET` + `PUT` with `baseVersion`. Frontend: `Know` list tab and a React Flow graph screen with dagre layout and a bottom sheet; then ticker shortcuts from the other tabs.

**Tech Stack:** NestJS + TypeORM (Postgres jsonb), Vitest, tsx, React 19 + TanStack Query, `@xyflow/react`, `@dagrejs/dagre`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-knowledge-graph-design.md`

## Global Constraints

- Graphs are private: never written to the repo, logs, or fixtures with real content. Tests use made-up text.
- Node: `id` matches `/^[a-z0-9][a-z0-9-]{0,39}$/`; `title` 1–80 chars; `text` 1–1500 chars (0–1500 for `type: 'fundamentals'`); `type` optional `'text' | 'fundamentals'` (omitted = text; at most one fundamentals node per graph); `asOf` optional 1–40 chars; `question` optional ≤ 300; `sources` optional ≤ 10 of `{ label ≤ 80, url http(s) ≤ 500 }`; server-owned `createdAt`/`updatedAt` (ISO strings).
- Root node id is `summary`; every graph has it; every node must be reachable from `summary` by following edges in their direction (from → to). Reachable only via reversed edges does not count.
- Edge `{ from, to, label }`, label 1–40 chars, both ends existing nodes, no self-loops, no duplicate (from, to) pair.
- Limits: 300 nodes, 600 edges.
- Every write carries `baseVersion`; stale → 409, nothing saved. Create = `baseVersion: 0`. Every write requires a `message` 1–120 chars.
- Revert and delete are new versions. Delete sets `deletedAt`; a deleted graph is 404 for `GET /knowledge/:symbol`, absent from the list, and `PUT` with the current `baseVersion` un-deletes it (as does revert).
- A node is "new" when `updatedAt > lastViewedAt` (null `lastViewedAt` → every node new).
- Every query filters by `userId` from `UsersService.currentUser()`.
- API key: format `kb_` + 43 base64url chars (32 random bytes); stored as sha256 hex; accepted only on handlers/controllers with `@AllowApiKey()`; on any other route a `kb_` bearer is 401.
- Schema changes via a migration registered by hand in `backend/src/database/data-source.ts`.
- Tests never reach the network; never touch the local `trader` DB or a real DATABASE_URL. Live checks use the test user's key only.
- No `sed -i` (BSD sed); edit files with the editor or python.
- Local `main` only; the controller pushes and deploys after each task's review.
- Commit trailers: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01KSLpjvWMhkHqfbWoTYBnE1`.

## Review Focus

1. **Key leakage across routes** — a valid `kb_` key must not open `/holdings`, `/watchlist`, `/assistant`; pinned in Task 1 e2e.
2. **Cross-user reads/writes** — user B never sees or overwrites user A's graph of the same symbol; pinned in Task 1 e2e.
3. **Lost update** — two writers from the same base: the second gets 409 and the first's change survives; pinned in Task 1 e2e and Task 2 CLI test (the CLI surfaces 409 as "graph changed, re-run").
4. **Orphans after remove/move** — `kb remove` / `kb move` can't leave unreachable nodes or a cycle that cuts a subtree off `summary`; pinned in Task 2 unit tests.
5. **Big graph on a phone** — 40 nodes render, fit, and don't overflow at 402px; the sheet scrolls long text; pinned in Task 3 browser test.

---

### Task 1: Knowledge backend (invisible to the owner)

**Files:**
- Create: `backend/src/knowledge/graph.ts` (+ `graph.spec.ts`), `knowledge-graph.entity.ts`, `knowledge-version.entity.ts`, `knowledge.service.ts` (+ spec), `knowledge.controller.ts`, `knowledge.module.ts`, `dto.ts`
- Create: `backend/src/users/api-key.entity.ts`, `backend/src/users/api-keys.service.ts` (+ spec), `backend/src/auth/allow-api-key.decorator.ts`, `backend/src/database/create-api-key.ts`
- Create: `backend/src/database/migrations/1790294400000-AddKnowledge.ts`
- Create: `backend/test/knowledge.e2e-spec.ts`
- Modify: `backend/src/database/data-source.ts`, `backend/src/app.module.ts`, `backend/src/users/users.module.ts`, `backend/src/users/user-context.middleware.ts`, `backend/src/auth/jwt-auth.guard.ts`, `backend/src/legacy-api-prefix.ts` (+ spec: add `/knowledge`), `backend/package.json` (script `"kb:key": "tsx src/database/create-api-key.ts"`), `docs/api.md`

**Interfaces — Produces:**

```ts
// graph.ts (pure, no Nest imports — the CLI imports it)
export interface Source { label: string; url: string }
export type NodeType = 'text' | 'fundamentals';
export interface NodeInput { id: string; title: string; text: string; type?: NodeType; asOf?: string; question?: string; sources?: Source[] }
export interface GraphNode extends NodeInput { createdAt: string; updatedAt: string }
export interface Edge { from: string; to: string; label: string }
export interface GraphInput { nodes: NodeInput[]; edges: Edge[] }
export const ROOT_ID = 'summary';
export function validateGraph(g: GraphInput): string[];          // [] when valid; else human messages, e.g. 'edge revenue→gaming: unknown node "gaming"'
export function stampNodes(next: NodeInput[], prev: GraphNode[], now: string): GraphNode[]; // keeps createdAt; updatedAt = now only if title/text/type/asOf/question/sources changed or node is new
export function isNew(node: GraphNode, lastViewedAt: string | null): boolean;
export function reachableFromRoot(nodes: { id: string }[], edges: Edge[]): Set<string>;

// HTTP (all under /api/knowledge, login or key)
// GET    /knowledge                     -> { symbol, nodeCount, updatedAt, hasNew }[]  (updatedAt desc)
// GET    /knowledge/:symbol             -> { symbol, version, updatedAt, lastViewedAt, nodes: GraphNode[], edges: Edge[] } | 404
// POST   /knowledge/:symbol/viewed      -> { ok: true }   (404 if none)
// PUT    /knowledge/:symbol             body { baseVersion, message, nodes: NodeInput[], edges } -> same as GET; 400 invalid / unknown ticker 404 / 409 stale
// GET    /knowledge/:symbol/versions    -> { version, message, createdAt }[] (desc)
// POST   /knowledge/:symbol/revert      body { baseVersion, version, message } -> same as GET
// DELETE /knowledge/:symbol             body { baseVersion, message } -> { ok: true }

// ApiKeysService
create(userId: string, name: string): Promise<string>;   // returns the plaintext key once
resolve(key: string): Promise<string | null>;            // userId, updates lastUsedAt
```

- [ ] **Step 1: `graph.ts` + spec (TDD).** Tests first: valid minimal graph (summary only) → `[]`; missing summary; duplicate id; bad id pattern; title/text/question/asOf/source length and url scheme; unknown `type`; empty text allowed only on a fundamentals node; two fundamentals nodes rejected; unknown edge end; self-loop; duplicate edge; unreachable node (`a` exists with only edge `a→summary`); node and edge limits (301 nodes / 601 edges); `stampNodes` keeps `createdAt`, bumps `updatedAt` only on content change, new node gets both = now; `isNew` with null and with older/newer `lastViewedAt`.
- [ ] **Step 2: Migration `AddKnowledge1790294400000`** (register in data-source). SQL:

```sql
CREATE TABLE IF NOT EXISTS public.knowledge_graphs (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  "userId" uuid NOT NULL,
  symbol varchar NOT NULL,
  version integer NOT NULL,
  nodes jsonb NOT NULL,
  edges jsonb NOT NULL,
  "deletedAt" timestamptz NULL,
  "lastViewedAt" timestamptz NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "UQ_knowledge_graphs_user_symbol" UNIQUE ("userId", symbol)
);
CREATE TABLE IF NOT EXISTS public.knowledge_versions (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  "graphId" uuid NOT NULL REFERENCES public.knowledge_graphs(id) ON DELETE CASCADE,
  version integer NOT NULL,
  message varchar NOT NULL,
  nodes jsonb NOT NULL,
  edges jsonb NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "UQ_knowledge_versions_graph_version" UNIQUE ("graphId", version)
);
CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  "userId" uuid NOT NULL,
  name varchar NOT NULL,
  "keyHash" varchar NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "lastUsedAt" timestamptz NULL
);
```
  `down` drops the three tables (versions first).
- [ ] **Step 3: API keys.** `ApiKey` entity + `ApiKeysService` in `UsersModule` (exported). `resolve` returns null for anything not starting with `kb_`. Spec: create→resolve round-trip, wrong key → null, stored value is the sha256 hex not the key. `src/database/create-api-key.ts`: `tsx src/database/create-api-key.ts <email> <name>` — initialises `data-source`, finds the user by lower-cased email (exit 1 with a message if none), inserts the hash, prints the key once.
- [ ] **Step 4: Auth wiring.** `UserContextMiddleware`: if the bearer starts with `kb_`, `userId = await apiKeys.resolve(token)` and set `viaApiKey: true` in the context (extend `UserContext` with `viaApiKey: boolean`); otherwise unchanged. `JwtAuthGuard`: if the bearer starts with `kb_` → allowed only when the handler or class has `@AllowApiKey()` metadata AND `currentUserId()` is non-null; else 401 `'API key not allowed here'` / `'Invalid API key'`. JWT path unchanged.
- [ ] **Step 5: Service + controller.** `KnowledgeService` per the interfaces; symbol upper-cased and trimmed; create path calls `InstrumentsService.findOrCreate(symbol)` (unknown → its 404); writes run in a transaction that locks the graph row (`SELECT … FOR UPDATE` via `queryRunner`/`manager.findOne({ lock: { mode: 'pessimistic_write' } })`), checks `baseVersion === version` (create: no row and `baseVersion === 0`; an existing deleted row is updated, not re-created), validates (400 with `{ message: errors.join('; ') }`), stamps nodes, bumps `version`, inserts a `knowledge_versions` row, updates `updatedAt`. Revert: loads the version (404 if missing), writes its nodes/edges as a new version with `deletedAt = null`. Delete: new version row with `deleted: true`, current nodes/edges, sets `deletedAt`. `@AllowApiKey()` on the controller. DTOs validate shape with class-validator (`baseVersion` int ≥ 0, `message` 1–120, `nodes`/`edges` arrays); deep content checks are `validateGraph`'s job. Express JSON limit: confirm a 300-node graph (≈ 500 KB) is accepted; raise `bodyParser` limit to `2mb` in `main.ts` if needed.
- [ ] **Step 6: e2e (`knowledge.e2e-spec.ts`)** with the Yahoo stub. Truncate `knowledge_versions, knowledge_graphs, api_keys` per test. Cases: create with `baseVersion 0` → v1, GET returns stamped nodes; list row (`nodeCount`, `hasNew: true`); `viewed` → `hasNew: false`; edit one node → only that node's `updatedAt` moves and `hasNew` true again; stale `baseVersion` → 409 and content unchanged; invalid graph → 400 naming the problem; unknown ticker `ZZZZ1` → 404; a ticker on no list works; versions list desc; revert to v1 → v4 with v1's content; delete → GET 404, list empty, revert brings it back; key: create a key for the owner via `ApiKeysService` (from `app.get`), then every knowledge route works with it, and `GET /holdings` with it → 401; garbage `kb_x` → 401; second user (sign up via `/auth/signup`) can't see the owner's graph and creates its own NVDA independently.
- [ ] **Step 7:** Add `/knowledge` to `LEGACY_PREFIXES` (+ spec case), document endpoints in `docs/api.md`, run `npm test`, `npm run test:e2e`, `npm run lint` in `backend`.
- [ ] **Step 8: Commit** `feat(knowledge): versioned per-ticker knowledge graphs API with kb_ API keys`.

**Deploy (controller):** test the migration on a scratch copy of production first (as with `AddListPositions`), push, rebuild the Mac host (it runs migrations on start — verify in `~/Library/Logs/trader/`), `curl localhost:3200/api/knowledge` with the test user's login → `[]`.

### Task 2: The `kb` tool and the Claude guide

**Files:**
- Create: `backend/tools/kb/main.ts` (argument parsing + HTTP), `backend/tools/kb/edits.ts` (pure edit functions) + `edits.spec.ts`, `backend/tools/kb/tree.ts` (indented printing) + `tree.spec.ts`
- Create: `docs/knowledge-guide.md`
- Modify: `backend/package.json` (script `"kb": "tsx tools/kb/main.ts"`), `AGENTS.md` (import `@docs/knowledge-guide.md` and add a one-line invariant: graphs are private, edited only through `kb`), `backend/tsconfig.json` is fine (tools are type-checked by the base config; not in the build)

**Interfaces — Consumes:** Task 1 HTTP API and `graph.ts` (`validateGraph`, types, `ROOT_ID`, `reachableFromRoot`).

**Produces:**

```ts
// edits.ts — each returns a new GraphInput or throws Error(message); none touch the network
start(input: { title: string; text: string; sources?: Source[] }): GraphInput;               // summary only
addNode(g, { under, id, label, title, text, type?, asOf?, question?, sources? }): GraphInput;               // 'under' must exist; id must be free
editNode(g, id, patch: Partial<Omit<NodeInput,'id'>>): GraphInput;                            // sources replace the list when given
link(g, from, to, label): GraphInput;  unlink(g, from, to): GraphInput;                     // unlink refuses if it orphans nodes
moveNode(g, id, { under, label? }): GraphInput;                                              // replaces the node's incoming edges with one from 'under'; refuses id === summary, or moving under its own descendant
removeNode(g, id, withChildren: boolean): GraphInput;                                        // refuses summary; without withChildren refuses if any other node becomes unreachable; with it removes everything only reachable through id
```

- [ ] **Step 1: `edits.ts` + spec (TDD).** Every edit's result passes `validateGraph`, and the spec asserts that, plus: add under unknown parent; duplicate id; move under own descendant refused; remove leaving orphans refused, `--with-children` removes the subtree but keeps a child also linked from elsewhere; unlink that orphans refused; `remove summary` refused.
- [ ] **Step 2: `tree.ts` + spec.** Prints the graph as an indented tree from `summary` (`── CEO → Jensen Huang [ceo]`), extra (non-tree) edges listed at the end as `↪ from → to (label)`, and nodes' text wrapped under the title only with `--full`.
- [ ] **Step 3: `main.ts`.** Reads `KB_ENV` (default `~/.config/trader-host/kb.env`) for `KB_API_URL`, `KB_API_KEY`; exits 1 with a clear message if missing. Commands exactly as in the spec table (`list, show [--full], start, add, edit, link, unlink, move, remove [--with-children], history, revert, delete, pull, push`). Repeated `--source "label=url"`; `--as-of "Q2 FY2027"` on add/edit (`--as-of ""` clears it); `--type fundamentals` on add (text may then be empty). Every write: `GET` (404 → `baseVersion 0` only for `start`), apply the edit, `PUT` with `-m` or a default message (`add ceo`, `edit ceo`, …), print `NVDA v3 · add ceo` and the changed node. Errors: 400/404 body message printed; 409 → `NVDA changed since it was read — run the command again.` Exit codes 0/1. Uses global `fetch`, 15 s timeout.
- [ ] **Step 4: `docs/knowledge-guide.md`.** Contents: what the graph is; the starter packs copied from the spec's "Starter packs" section (company pack with node ids `fundamentals` (type fundamentals, text = one-line takeaway), `management`, `business`, `capital`, `last-call`, `risks`; the crypto / ETF / commodity packs with `bottom-line`), how to decide the kind (Yahoo `quoteType`), and that "start X" builds the pack and nothing more; the freshness rule (offer to refresh `last-call` after a report; set `asOf`); the incremental rule (add only what was asked; one short paragraph ≈ 80 words; attach to the node under discussion, else `summary`; short edge labels); facts checked online and recorded as sources; reply format (`Added "CEO" under NVDA's summary (v2)` + the paragraph); never remove or rewrite unasked content; `kb remove` only on the owner's explicit request; command cheat-sheet (`npm run -s kb --prefix backend -- …`); owner key in `kb.env`, test user key in `kb-test.env` (`KB_ENV=~/.config/trader-host/kb-test.env`); graphs are private — never paste them into the repo.
- [ ] **Step 5:** `npm test` and `npm run lint` in `backend` (lint covers `tools/` — extend the `lint` script to `oxlint src/ test/ tools/`).
- [ ] **Step 6: Commit** `feat(knowledge): kb command-line tool and Claude knowledge guide`.

**Deploy (controller):** on the Mac host, `npm run kb:key` for the owner (`kb.env`) and the test user (`kb-test.env`), both chmod 600 in `~/.config/trader-host/`. Live check with `kb-test.env`: `start TEST`, `add`, `edit`, `move`, `remove`, `history`, `revert`, `delete`; then delete the test graph. Push.

### Task 3: `Know` tab and graph screen

**Files:**
- Create: `frontend/src/api/knowledge.ts`, `frontend/src/routes/Knowledge.tsx` (+ spec), `frontend/src/routes/KnowledgeGraph.tsx` (+ spec), `frontend/src/components/knowledge/layout.ts` (+ spec), `frontend/src/components/knowledge/NodeSheet.tsx`, `frontend/src/components/knowledge/GraphCanvas.tsx`
- Create: `e2e/knowledge.spec.ts`
- Modify: `frontend/src/main.tsx` (routes `knowledge`, `knowledge/:symbol`), `frontend/src/components/AppShell.tsx` (+ spec: fifth link `Know` → `/knowledge`), `frontend/package.json` (`@xyflow/react`, `@dagrejs/dagre`), `docs/current-state.md`

**Interfaces — Consumes:** Task 1 `GET /knowledge`, `GET /knowledge/:symbol`, `POST /knowledge/:symbol/viewed`.

**Produces:**

```ts
// api/knowledge.ts
export interface KnowledgeRow { symbol: string; nodeCount: number; updatedAt: string; hasNew: boolean }
export interface KnowledgeNode { id: string; title: string; text: string; question?: string; sources?: { label: string; url: string }[]; createdAt: string; updatedAt: string }
export interface KnowledgeEdge { from: string; to: string; label: string }
export interface KnowledgeGraph { symbol: string; version: number; updatedAt: string; lastViewedAt: string | null; nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }
export const KNOWLEDGE_KEY = ['knowledge'] as const;
export function useKnowledgeList(): UseQueryResult<KnowledgeRow[]>;
export function useKnowledgeGraph(symbol: string): UseQueryResult<KnowledgeGraph | null>; // 404 → null
export function useMarkViewed(): (symbol: string) => void; // POST viewed, then invalidates the list
// layout.ts
export function layoutGraph(nodes: {id:string}[], edges: {from:string;to:string}[]): Record<string, { x: number; y: number }>; // dagre TB, node 160×44, ranksep 60, nodesep 24
```

- [ ] **Step 1: `api/knowledge.ts`.** `refetchOnWindowFocus: true` for both queries (owner switches back from Claude to see new nodes).
- [ ] **Step 2: `Knowledge.tsx` (list) + spec.** Title `Knowledge`; search input (`Search tickers`, upper-cases, filters by prefix-contains); rows: ticker, `N nodes` (`1 node`), `updated Oct 29` (ET date via `Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })`), a dot (`aria-label="new"`) when `hasNew`; row links to `/knowledge/:symbol`; empty: `No knowledge yet — ask Claude to start one, e.g. "start NVIDIA".`; loading skeleton; error `Couldn't load knowledge right now.` Spec: empty, rows + dot, search, link target.
- [ ] **Step 3: `layout.ts` + spec.** Positions for every node; `summary` has the smallest `y`; a child is below its parent.
- [ ] **Step 4: `KnowledgeGraph.tsx`, `GraphCanvas.tsx`, `NodeSheet.tsx` + spec.**
  - On load success, capture `lastViewedAt` from the first response in a ref (highlights use it), then call `markViewed(symbol)` once.
  - Header: back link `‹ Knowledge`, ticker, `Updated Oct 29 · v7`.
  - Canvas: `ReactFlow` with custom node type (title only, `max-w-[160px]`, 2-line clamp; accent ring + `new` tag when `isNew`), edges with labels (`type: 'smoothstep'`, small label text), `fitView` on load, `minZoom 0.2`, `panOnDrag`, `zoomOnPinch`, no node dragging/connecting/deleting (`nodesDraggable={false} nodesConnectable={false}`); keep React Flow's default attribution (don't set `hideAttribution`). A `Fit` button calls `fitView`. Canvas height `calc(100dvh - 210px)`, full width, `touch-action: none` on the canvas only.
  - Tap a node → `NodeSheet`: fixed bottom sheet (max-h 70dvh, scrollable), `Q: …` (if question), `As of …` (if asOf), paragraph (`whitespace-pre-line`; for a fundamentals node this is the takeaway, and Task 5 adds the table above it), sources as `<a target="_blank" rel="noopener noreferrer">`, `Updated Oct 29`, `Connected` list of neighbour nodes (incoming and outgoing, each with the edge label) — tapping one selects it and centres it (`setCenter`); close button and tap-outside close.
  - No graph (null): `No knowledge on NVDA yet — ask Claude to start it.`; error: `Couldn't load this graph right now.`
  - Spec (jsdom: mock `@xyflow/react`'s `ReactFlow` to render nodes as buttons so behaviour is testable): renders node titles; new highlight uses the captured `lastViewedAt` not the refreshed one; tap opens sheet with question, text, sources; neighbour tap switches; no-graph text; `viewed` posted once.
- [ ] **Step 5: Nav.** Fifth tab `Know`. AppShell spec updated. Check the five labels fit 402px (browser test below); if they don't, tighten `linkClass` padding, not the labels.
- [ ] **Step 6: Browser test `e2e/knowledge.spec.ts`** (iPhone 16 Pro WebKit). Seed through the API with the e2e login token: an `NVDA` graph of 40 nodes (summary + 6 sections × ~6 children, made-up text, one long 1,400-char paragraph). Assert: five tabs visible without overflow; `Know` lists NVDA with `40 nodes`; open it → nodes render, `document.documentElement.scrollWidth <= 402`; tap a node → sheet shows text, long text scrolls inside the sheet; `Fit` keeps all nodes within the canvas bounds; a missing ticker route shows the no-graph text.
- [ ] **Step 7:** `npm test`, `npm run lint`, `npm run build` in `frontend`; `npm run test:browser` at the root. Update `docs/current-state.md`.
- [ ] **Step 8: Commit** `feat(frontend): Know tab and per-ticker knowledge graph screen`.

**Deploy (controller):** push; deploy-web runs. Live check signed in as the test user with a graph created via `kb-test.env`; then delete it.

### Task 4: Open a ticker's graph from Holdings, Watch and Earnings

**Files:** Modify `frontend/src/components/ReorderableList.tsx`, `frontend/src/routes/Holdings.tsx`, `Watchlist.tsx`, `Earnings.tsx` (+ their specs), `e2e/knowledge.spec.ts`.

**Interfaces — Consumes:** `useKnowledgeList()` from Task 3 (a `Set` of symbols with graphs).

- [ ] **Step 1:** Outside edit mode, the ticker text in list rows (and in the ATR table mode), in Earnings calendar cells and in the days-until rows becomes a `Link` to `/knowledge/:symbol`. In edit mode it stays plain text (drag handle behaviour unchanged). Rows whose symbol has a graph show a small dot after the ticker (`aria-label="has knowledge"`).
- [ ] **Step 2:** Specs: link present outside edit mode, absent in edit mode; dot only for symbols in the knowledge list; Earnings cells link. Existing sort/ATR/reorder specs still pass.
- [ ] **Step 3:** Browser test: from Holdings tap `NVDA` → the graph screen opens; Earnings cell tap opens it; the 402px no-overflow checks in `atr.spec.ts`, `reorder.spec.ts`, `earnings.spec.ts` still pass.
- [ ] **Step 4:** `npm test`, `npm run lint`, `npm run build`, `npm run test:browser`.
- [ ] **Step 5: Commit** `feat(frontend): tap a ticker to open its knowledge graph`.

**Deploy (controller):** push; deploy-web; tell the owner what to try.

### Task 5: Live Fundamentals

**Files:**
- Modify: `backend/src/market-data/yahoo.client.ts` (+ spec), `backend/test/yahoo-stub.ts`, `backend/src/knowledge/knowledge.controller.ts`, `knowledge.module.ts`, `backend/src/database/data-source.ts`, `backend/src/main.e2e.ts` (stub fundamentals), `AGENTS.md` (the Yahoo boundary now also offers fundamentals), `docs/api.md`
- Create: `backend/src/market-data/alpha-vantage.client.ts` (+ spec; the only Alpha Vantage boundary, key `ALPHAVANTAGE_API_KEY`, add to `.env.example` and `docs/DEPLOYMENT.md`), `backend/src/knowledge/fundamentals.ts` (pure shaping) + spec, `fundamentals.service.ts` + spec, `fundamentals-cache.entity.ts`, migration `backend/src/database/migrations/1790380800000-AddFundamentalsCache.ts`, `backend/test/fundamentals.e2e-spec.ts`
- Frontend: `frontend/src/api/knowledge.ts` (`useFundamentals(symbol, enabled)`), create `frontend/src/components/knowledge/FundamentalsTable.tsx` (+ spec), modify `NodeSheet.tsx`, `e2e/knowledge.spec.ts`

**Interfaces — Produces:**

```ts
// yahoo.client.ts
export interface RawFundamentals {
  quoteType: string | null; currency: string | null;
  epsQuarters: { periodEnd: string; fiscalQuarter: string | null; actual: number | null; reportedAt: string | null }[];                     // earnings.earningsChart.quarterly
  cash: number | null; debt: number | null;                                                                                                // financialData totalCash / totalDebt
  series: { periodEnd: string; revenue: number | null; fcf: number | null }[];                                                             // fundamentalsTimeSeries quarterly, oldest first
}
YahooClient.fundamentals(symbol: string): Promise<RawFundamentals>; // throws on provider failure

// alpha-vantage.client.ts
export interface QuarterEstimate { periodEnd: string; epsEstimate: number | null; revenueEstimate: number | null } // horizon 'fiscal quarter' rows only
AlphaVantageClient.quarterEstimates(symbol: string): Promise<QuarterEstimate[]>; // throws on HTTP failure, missing key, or an 'Information'/'Note'/'Error Message' reply; 15 s timeout

// fundamentals.ts
export interface Fundamentals {
  fetchedAt: string; currency: string | null;
  quarters: { label: string; periodEnd: string; reportedAt: string | null; revenue: number | null; revenueEstimate: number | null; revenueSurprisePct: number | null; revenueYoY: number | null; eps: number | null; epsEstimate: number | null; epsSurprisePct: number | null; fcf: number | null }[]; // newest first, max 4
  next: { label: string | null; periodEnd: string | null; reportAt: string | null; epsEstimate: number | null; revenueEstimate: number | null } | null; // first estimate period after the newest reported quarter; reportAt from instruments.nextEarningsAt if known
  cash: number | null; debt: number | null; netCash: number | null;
}
export function shapeFundamentals(raw: RawFundamentals, estimates: QuarterEstimate[] | null, fetchedAt: string, today: string): Fundamentals;
// GET /knowledge/:symbol/fundamentals -> Fundamentals | 404 { message: 'NVDA is not a company' } (quoteType !== 'EQUITY') | 503
```

- [ ] **Step 1a: `AlphaVantageClient.quarterEstimates`** via `GET https://www.alphavantage.co/query?function=EARNINGS_ESTIMATES&symbol=…&apikey=…` (fields `date`, `horizon`, `eps_estimate_average`, `revenue_estimate_average`, strings → numbers). Spec with mocked `fetch`: parsing, quota reply → throws, missing key → throws. Verified live 2026-10-29 for NVDA.
- [ ] **Step 1: `YahooClient.fundamentals`** via `quoteSummary(symbol, { modules: ['earnings', 'financialData', 'price'] })` and `fundamentalsTimeSeries(symbol, { period1: <today − 30 months>, type: 'quarterly', module: 'all' })` (`totalRevenue`, `freeCashFlow`). Spec with a mocked `yf`. Verified live 2026-10-29 for NVDA: all these fields exist.
- [ ] **Step 2: `shapeFundamentals` + spec (TDD).** Label from `fiscalQuarter` (`"2Q2027"` → `Q2 FY27`), else from `periodEnd` as `Jul 2026`; join EPS quarters, series and estimates by `periodEnd` (same calendar month = match); surprise % = (actual ÷ estimate − 1) × 100, 1 decimal; `revenueYoY` = (revenue ÷ revenue of the quarter ~12 months earlier − 1) × 100, 1 decimal, null when either missing; `netCash = cash − debt` (null if either null); newest 4 quarters; `next` = the earliest estimate whose period ends after the newest reported quarter (label from its period end; fiscal label inferred by stepping the newest fiscal quarter forward by one); estimates null → all estimate fields null.
- [ ] **Step 3: cache + service.** Migration: `fundamentals_cache (symbol varchar PRIMARY KEY, data jsonb NOT NULL, "fetchedAt" timestamptz NOT NULL)`, registered in data-source. `FundamentalsService.get(symbol, now)`: fetched on today's ET date → cached; else fetch Yahoo and Alpha Vantage in parallel → shape → upsert → return. An Alpha Vantage failure alone still caches the actuals but marks the row so estimates are retried on the next open (at most once an hour). A Yahoo failure → cached data if any, else 503 `Couldn't load the numbers right now.`. `quoteType !== 'EQUITY'` → 404, remembered for the day as `{ notCompany: true }` so Yahoo isn't re-asked. Spec: same-day hit, next-day refresh, failure with and without cache, non-company.
- [ ] **Step 4: endpoint** on the knowledge controller (class already `@AllowApiKey()`); e2e with stub data: shape, cache hit (stub called once across two requests), 404 for a non-EQUITY stub, 503 path.
- [ ] **Step 5: frontend.** `useFundamentals(symbol, enabled)` only while a `type: 'fundamentals'` node's sheet is open. `FundamentalsTable` above the takeaway, modelled on the owner's Investing.com screen: header `Report · Expected · Actual`; first row the next report (`Nov 17, 2026` / `Q3 FY27`, expected EPS `2.47` and revenue `$109.0B`, actual blank); then one row per past quarter, newest first (report date + fiscal label; EPS expected / actual; revenue expected / actual, each actual `text-up` on a beat, `text-down` on a miss, plain when equal or no estimate), with `+105% YoY` small under the revenue actual; below: `Free cash flow` row for the 4 quarters, then `Cash $62.5B · Debt $38.9B · Net cash $23.6B`, then `Updated Oct 29 · expectations: Alpha Vantage`. Money: `$1.2T / $96.2B / $850M`, negatives with a real minus. Null → `—`. Loading skeleton; error text. Spec: formatting, colours, nulls, error, no fetch for text nodes.
- [ ] **Step 6: browser test:** the seeded graph gets a fundamentals node; its sheet shows the stubbed table with no horizontal overflow at 402px.
- [ ] **Step 7:** backend `npm test`, `npm run test:e2e`, `npm run lint`; frontend `npm test`, `npm run lint`, `npm run build`; root `npm run test:browser`.
- [ ] **Step 8: Commit** `feat(knowledge): live fundamentals table for companies`.

**Deploy (controller):** migration check on a scratch production copy, push, rebuild the Mac host, add `ALPHAVANTAGE_API_KEY` to the Mac host env (already in `prod.env`) and later Render, live check with the test user's key (NVDA → table data matching Investing.com within ~1%, QQQ → 404), deploy-web.
