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
  - `createdAt`, `updatedAt`: set by the server
- **The root node** has the id `summary`. It is the first paragraph, and every graph has one.
- **An edge** is `{ from, to, label }`. The label is short, e.g. `CEO` or `How they make money`. Both ends must be nodes in the same graph, and no node is left unconnected from `summary`.
- **One node type for now.** Typed nodes (a risk with a severity, for example) are added later, only when a real question needs one.
- **Limits:** 300 nodes and 600 edges per graph.

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

## Testing

- **Backend unit tests:** graph validation (duplicate ids, unknown edge ends, unconnected nodes, a missing `summary`, the limits), node timestamps across versions, new-node logic, 409 on a stale `baseVersion`, revert and delete as versions, and key hashing and lookup.
- **E2E:** each endpoint with login and with a key. A key is rejected on a non-knowledge route. One user can't read another user's graph. The unknown-ticker case uses the Yahoo stub.
- **Tool:** unit tests for each command's change to a graph, without the network.
- **Frontend specs:** the list (empty, rows, search, dot), the graph screen (nodes, the sheet, new highlights, no graph), and the shortcuts.
- **Browser test at 402 px:** five tabs fit; the graph renders and fits; tapping a node opens the sheet; nothing overflows horizontally.
- **Live check** with the test user's key only.

## Out of scope

- Edges to another ticker's graph. The format leaves room for them (`TSMC:summary`) later.
- Typed nodes.
- Editing or deleting in the app.
- Rich text.
- Showing version history in the app.
- Non-ticker topics.
