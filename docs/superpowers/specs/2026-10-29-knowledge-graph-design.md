# Knowledge graph per ticker

**Date:** 2026-10-29
**Status:** Awaiting owner review.

## What the owner asked

> "I want to have inside the app kind of a knowledge base per ticker … a graph of a knowledge base behind the ticker."

Decisions from the conversation:
- **A visual node graph**, not nested boxes.
- **Claude (in Claude Code) does the editing.** The app only displays it. No AI runs inside the app, and nothing is paid for.
- **The graph grows slowly, one question at a time.** "Start NVIDIA" gives one paragraph. "Who is the CEO?" adds an arrow to a new node with a short paragraph. "How do they make money?" adds an arrow to a node that branches into several nodes. Claude never builds a whole graph unasked.
- **Claude adds each answer right away.** The owner reviews it in the app and asks for changes.
- **Any ticker can have a graph**, not only those on the holdings or watchlist.
- **Graphs only grow.** Nothing is removed unless the owner asks, and that includes when a ticker leaves the owner's lists.
- **Graphs are private.** The trader GitHub repo is public, so graphs live in the database behind the owner's login, never in the repo.

## The graph

- **Each ticker has at most one graph per user**, made of nodes and edges.
- **A node** has:
  - `id`: a short slug, unique in the graph, e.g. `summary`, `ceo`, `revenue`, `data-center`
  - `title`: up to 80 characters
  - `text`: one short paragraph, plain text, up to 1,500 characters
  - `question` (optional): the owner's question that created it, e.g. "Who is the CEO?"
  - `sources` (optional): a list of `{ label, url }`
  - `asOf` (optional): up to 40 characters, e.g. `Q2 FY2027`, for content that goes stale. It is shown as "As of …".
  - `type` (optional): `text` (the default) or `fundamentals`. See [Live Fundamentals](#live-fundamentals). A fundamentals node may have empty `text`, which is then used as Claude's one-line takeaway under the numbers. A graph has at most one fundamentals node.
  - `createdAt`, `updatedAt`: set by the server
- **The root node** has the id `summary`. It is the first paragraph, and every graph has one.
- **An edge** is `{ from, to, label }`. The label is short, e.g. `CEO` or `How they make money`. Both ends must be nodes in the same graph, and no node is left unconnected from `summary`.
- **Node types:** besides the live `fundamentals` node, every node is plain text. Other typed nodes (a risk with a severity, for example) are added later, only when a real question needs one.
- **Limits:** 300 nodes and 600 edges per graph.

## Starter packs

"Start NVIDIA" builds a fixed starter pack, chosen by what kind of ticker it is. After that, the graph grows from the owner's questions. Claude checks the kind (Yahoo `quoteType`: `EQUITY`, `ETF`, `CRYPTOCURRENCY`, `FUTURE`, and so on) and tells the owner which pack is being used.

Every pack has a **Summary** root. Every pack node hangs directly off it, has a short paragraph, and carries `asOf` when the content goes stale.

**Company** (a single company, `EQUITY`):

| Node (id) | Content |
|---|---|
| Fundamentals (`fundamentals`) | The live table (see below), plus Claude's one-line takeaway |
| Management (`management`) | The founders: who they are, and how involved they are today (CEO, chair, board member, large shareholder only, or gone). The CEO, if not a founder: their background and how long they've been in the role. At most one or two other key people, and only when they matter. |
| How they make money (`business`) | The business model. Later questions can branch into a node per segment. |
| Where the next dollar goes (`capital`) | Capital allocation: paying down debt, reinvesting, acquisitions, buybacks, dividends, and stock pay to management. Includes last year's split where it is reported. |
| Last earnings call (`last-call`) | A short summary and the **bottom line**: what changed, the guidance, and the one thing to remember. `asOf` names the quarter. |
| Key risks (`risks`) | The 2–3 things that could break the story. |

**Every other kind** gets **Summary** and **Bottom line** (`bottom-line`, why this matters to the owner), plus:

- **Crypto:**
  - what it is and why it has value
  - supply (the cap, issuance and halvings)
  - milestones (spot ETFs, corporate treasuries, countries holding it)
  - regulation in progress, by region, each item marked passed, pending or proposed
  - who holds it, and the flows
  - what moves the price
- **ETF:**
  - what it tracks
  - top holdings and concentration
  - cost and size
  - what drives it
  - a single-asset ETF (e.g. IBIT) gets a short node naming the underlying asset instead of repeating it
- **Commodity** (oil and similar):
  - supply
  - demand
  - inventories
  - geopolitics
  - the calendar (OPEC meetings, weekly EIA reports)

**Freshness:** after a company reports, Claude offers to refresh `last-call` (and anything else dated). Refreshes are new versions, so earlier quarters stay in the history.

## Live Fundamentals

A company's Fundamentals node is filled by the app from Yahoo once per ET day, rather than written by Claude, so it is always current.

- **It shows:**
  - **Revenue growth:** for each of those quarters, vs the same quarter a year earlier.
  - **EPS and revenue by quarter:** the last 4 quarters, each as actual vs expected, with the surprise %.
  - **Next quarter's estimates:** both the EPS and the revenue estimate. These move daily, which is the point of refreshing daily.
  - **Free cash flow by quarter:** the last 4 quarters.
  - **Latest cash, latest debt, and net cash or net debt.**
  - **The fetch date and the fiscal quarter labels**, e.g. `Q2 FY27`.
- **Sources:**
  - **Actuals from Yahoo** (yahoo-finance2, through the slim `YahooClient`):
    - `quoteSummary` modules `earnings` (quarterly EPS actuals and revenue, report dates), `financialData` (`totalCash`, `totalDebt`) and `price` (`quoteType`, currency)
    - `fundamentalsTimeSeries` quarterly, for 8 quarters of revenue (for growth) and free cash flow
  - **Expectations from Alpha Vantage** `EARNINGS_ESTIMATES` (free key `ALPHAVANTAGE_API_KEY`, 25 calls/day): the consensus EPS and revenue estimate for each past fiscal quarter and the next one. Yahoo and Finnhub's free tier have no past revenue expectations. Checked 2026-10-29 against the owner's Investing.com screen for NVDA: within about 1% (e.g. Jul 2026 revenue $92.18B vs $91.90B). Different sites average different analysts.
  - `backend/src/market-data/alpha-vantage.client.ts` is the only Alpha Vantage import boundary. Its quota-exhausted reply (a JSON `Information` or `Note` field) is treated as a failure. When expectations are missing, the table still shows the actuals, with `—` for expected.
- **Endpoint:** `GET /knowledge/:symbol/fundamentals` returns:

  ```json
  {
    "fetchedAt": "...",
    "currency": "USD",
    "quarters": [{ "label": "Q2 FY27", "periodEnd": "...", "revenue": 0, "revenueYoY": 0, "eps": 0, "epsEstimate": 0, "epsSurprisePct": 0, "fcf": 0 }],
    "next": { "label": "...", "periodEnd": "...", "epsEstimate": 0, "revenueEstimate": 0 },
    "cash": 0,
    "debt": 0,
    "netCash": 0
  }
  ```

  `quarters` also carry `revenueEstimate`, `reportedAt` and `revenueSurprisePct`. Any field can be null. It returns 404 when the ticker isn't a company.
- **Cache:** a shared `fundamentals_cache` table (symbol, data, fetchedAt), refreshed at most once per ET day and only when a Fundamentals node is opened. On a Yahoo failure it serves the last cached data with its date; with nothing cached, the node shows "Couldn't load the numbers right now."
- **Display:** a compact table inside the node sheet, modelled on Investing.com's earnings table: one row per quarter (the report date and fiscal quarter), EPS expected vs actual and revenue expected vs actual, with the actual coloured green on a beat and red on a miss. The next report is a top row with expectations only. Below the table: free cash flow for the 4 quarters, then cash, debt and net cash. Money is shown as `$96.2B`, and beats and misses are coloured with the app's up and down colours. On the canvas, the node shows only its title, like every other node.

## Versions

- **Every change saves a new version** with a short message, e.g. `added CEO`. The version number counts up per graph.
- **Revert** restores an old version by saving it as a new version, so history is never rewritten.
- **Delete** hides the whole graph and is saved as a version too. A revert brings it back.
- **Concurrency:** a write includes the version it was based on. If that version is no longer the latest, the server returns 409 and nothing is saved.

## Backend

- **Tables**, in one migration:
  - `knowledge_graphs`: `id`, `userId`, `symbol` (upper-case), `version`, `nodes jsonb`, `edges jsonb`, `deletedAt`, `lastViewedAt`, `createdAt`, `updatedAt`. Unique on (`userId`, `symbol`).
  - `knowledge_versions`: `graphId`, `version`, `message`, `nodes`, `edges`, `createdAt`.
  - `api_keys`: `id`, `userId`, `name`, `keyHash`, `createdAt`, `lastUsedAt`.

  All queries filter by `userId`.
- **API-key auth for the editing tool.**
  - The header is `Authorization: Bearer kb_…`. It is accepted only on `/knowledge` routes; every other route still needs the normal login.
  - Keys are stored only as a hash.
  - A host-side script, `npm run kb:key -- <email> <name>`, creates a key and prints it once.
- **Endpoints**, all for the signed-in user (login or key):
  - `GET /knowledge` returns one row per non-deleted graph: `symbol`, `nodeCount`, `updatedAt`, `hasNew`. Most recently updated first.
  - `GET /knowledge/:symbol` returns `symbol`, `version`, `updatedAt`, `lastViewedAt`, `nodes`, `edges`. It returns 404 if there is no graph.
  - `POST /knowledge/:symbol/viewed` sets `lastViewedAt` to now.
  - `PUT /knowledge/:symbol` takes `{ baseVersion, message, nodes, edges }`. It validates the graph and saves a new version.
    - It creates the graph when none exists (`baseVersion: 0`). The symbol must pass the existing Yahoo ticker lookup, but it does not need to be on any list.
    - The server sets `createdAt` and `updatedAt` per node by comparing with the previous version.
  - `GET /knowledge/:symbol/versions` lists `version`, `message`, `createdAt`.
  - `POST /knowledge/:symbol/revert` takes `{ baseVersion, version, message }`.
  - `DELETE /knowledge/:symbol` takes `{ baseVersion, message }`.
- **"New" nodes:** a node is new when its `updatedAt` is later than the graph's `lastViewedAt`. `hasNew` is true when any node is new.
- **Validation errors** return 400 with a message naming the problem, e.g. `edge revenue→gaming: unknown node "gaming"`.

## The editing tool (`kb`)

- **A command-line tool in the repo**, run with `npm run kb -- <command>`. It talks to the API.
- **Config:** `~/.config/trader-host/kb.env` (chmod 600), with `KB_API_URL` and `KB_API_KEY`.
  - While the Mac hosts the API, the URL is `http://localhost:3200`.
  - A second file, `kb-test.env`, points at the test user for live checks.
- **Commands.** Every write reads the latest graph first, applies one change, and saves with a message:

  | Command | What it does |
  |---|---|
  | `kb show NVDA` | prints the graph as an indented tree |
  | `kb start NVDA --title … --text … [--source label=url]` | creates the graph with its `summary` node |
  | `kb add NVDA --under <id> --id <id> --label … --title … --text … [--question …] [--source …]` | adds a node and an edge from its parent |
  | `kb edit NVDA <id> [--title …] [--text …] [--question …] [--source …]` | changes a node |
  | `kb link NVDA <from> <to> --label …` and `kb unlink NVDA <from> <to>` | add or remove an extra edge |
  | `kb move NVDA <id> --under <id> [--label …]` | attaches a node somewhere else |
  | `kb remove NVDA <id>` | removes a node and its edges; it refuses if that would leave nodes unconnected, unless `--with-children` is given |
  | `kb history NVDA` | lists the versions |
  | `kb revert NVDA <version>` | restores an old version |
  | `kb delete NVDA` | deletes the whole graph |
  | `kb list` | lists all graphs |
  | `kb pull NVDA <file>` and `kb push NVDA <file> -m …` | whole-graph JSON, for reorganizing |
- **A guide for Claude sessions**, `docs/knowledge-guide.md`, imported from `AGENTS.md`. Its rules:
  - Add only what the owner asked. Keep it to one short paragraph per node (about 80 words) unless the owner asks for more.
  - Attach the new node to the node under discussion. If that's unclear, attach it to `summary`.
  - Check facts against current sources online and record them in `sources`.
  - Reply in chat with what was added and where, e.g. "Added `CEO` under NVDA's summary (v2)", plus the paragraph itself.
  - "Start <ticker>" builds the starter pack for its kind (see [Starter packs](#starter-packs)) and nothing more.
  - Never remove or rewrite content the owner didn't ask about.
  - Use the owner's key for real knowledge, and the test user's key for every test.

## The app

- **A fifth tab, `Know`**, after Earnings, lists every graph:
  - each row shows the ticker, its node count, and "updated Oct 29"
  - a dot marks graphs with new nodes
  - the most recent graph is first, and a search box filters by ticker
  - when there are no graphs, it reads "No knowledge yet — ask Claude to start one, e.g. 'start NVIDIA'."
- **The graph screen,** `/knowledge/:symbol`:
  - **Header:** the ticker, then "Updated Oct 29 · v7".
  - **Canvas:** React Flow (`@xyflow/react`) with automatic top-down layout (`@dagrejs/dagre`). `summary` is at the top. You can pan and pinch-zoom, and a `Fit` button brings everything into view. The graph opens fitted to the screen.
  - **Nodes** show only the title. New nodes get an accent outline and a small "new" tag. **Edges** show their label.
  - **Tapping a node** opens a bottom sheet with:
    - the question, if there is one, as "Q: …"
    - the paragraph
    - the sources, as links that open in a new tab
    - when the node was last updated
    - its connected nodes, which can be tapped to move to that node and centre it
  - **New highlights:** opening the screen marks the graph viewed. The screen keeps the earlier `lastViewedAt` for its own highlights, so new nodes stay highlighted until the next visit.
  - **No graph** for the ticker: "No knowledge on NVDA yet — ask Claude to start it."
  - **Read-only.**
- **Shortcuts:** tapping a ticker in Holdings, Watch, or Earnings (the calendar and the days-until list) opens its graph screen. Tickers with a graph show a small dot. These taps are off in edit mode.

## Delivery

Each task ships on its own:
1. **Backend:** tables, key auth, the endpoints, validation, and versions. Nothing is visible in the app.
2. **The `kb` tool and the guide.** Create the owner's key and the test user's key on the Mac host, rebuild the host, and live-check on the test user.
3. **The `Know` tab and the graph screen.**
4. **Ticker shortcuts and dots** in Holdings, Watch and Earnings.
5. **Live Fundamentals:** the endpoint, the cache and the table in the sheet. Before this ships, a fundamentals node shows only its takeaway text.

## Testing

- **Backend unit tests:** graph validation (duplicate ids, unknown edge ends, unconnected nodes, a missing `summary`, the limits), node timestamps across versions, new-node logic, 409 on a stale `baseVersion`, revert and delete as versions, and key hashing and lookup.
- **E2E:** each endpoint with login and with a key. A key is rejected on a non-knowledge route. One user can't read another user's graph. The unknown-ticker case uses the Yahoo stub.
- **Tool:** unit tests for each command's change to a graph, without the network.
- **Frontend specs:** the list (empty, rows, search, dot), the graph screen (nodes, the sheet, new highlights, no graph), and the shortcuts.
- **Browser test at 402 px:** five tabs fit; the graph renders and fits; tapping a node opens the sheet; nothing overflows horizontally.
- **Live check** with the test user's key only.

## Out of scope

- Edges to another ticker's graph. The format leaves room for them (`TSMC:summary`) later.
- Typed nodes other than `fundamentals`.
- Editing or deleting in the app.
- Rich text.
- Showing version history in the app.
- Non-ticker topics.
