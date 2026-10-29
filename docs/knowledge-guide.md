# Knowledge guide

Read this when the owner asks you to start, grow or change what Trader knows about a ticker.

## What the graph is

Each ticker can have one private knowledge graph: short notes (nodes) joined by labelled links (edges). The root node is `summary`; every other node must be reachable from it by following links in their direction. The owner reads the graph in the app's `Know` tab (read-only). You write it, only through the `kb` command.

- Node: `id` (lower-case letters, digits, dashes, up to 40), `title` (up to 80), `text` (1 to 1500 characters; a `fundamentals` node may have empty text; aim for about 80 words), optional `type` (`fundamentals`), `asOf` (up to 40, e.g. `Q2 FY2027`), `question`, `sources` (up to 10 `label=url`).
- Edge: from, to, short `label` (up to 40 characters). No self-loops, no duplicates.
- Every write reads the latest version first, applies one change, and saves a new version with a message. Old versions stay in `kb history`, and `kb revert` restores one.

## Starting a ticker

"Start NVIDIA" builds the starter pack for its kind and nothing more. Check the kind first with `kb kind NVDA`, which prints `NVDA: company` or `NVDA: not a company` (it asks the app's fundamentals endpoint, which answers for `EQUITY` only; it fails with an error if the market-data provider is down). For a ticker that is not a company, decide ETF, crypto or commodity from what you know about it, and tell the owner which pack you are using. Every pack has a `summary` root, every pack node hangs directly off it, each has a short paragraph, and each carries `asOf` when the content goes stale.

**Company** (a single company, `EQUITY`):

| Node (id) | Content |
|---|---|
| Fundamentals (`fundamentals`) | `type: fundamentals`. The app fills the live table; the text is your one-line takeaway. |
| Management (`management`) | The founders: who they are, and how involved they are today (CEO, chair, board member, large shareholder only, or gone). The CEO, if not a founder: their background and how long they've been in the role. At most one or two other key people, and only when they matter. |
| How they make money (`business`) | The business model. Later questions can branch into a node per segment. |
| Where the next dollar goes (`capital`) | Capital allocation: paying down debt, reinvesting, acquisitions, buybacks, dividends, and stock pay to management. Includes last year's split where it is reported. |
| Last earnings call (`last-call`) | A short summary and the bottom line: what changed, the guidance, and the one thing to remember. `asOf` names the quarter. |
| Key risks (`risks`) | The 2 to 3 things that could break the story. |
| Competitors (`competitors`) | The main rivals grouped by kind (direct peers and substitutes), and where the company wins or loses against each. |

**Every other kind** gets `summary` and `bottom-line` (why this matters to the owner), plus:

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
  - a single-asset ETF gets a short node naming the underlying asset instead of repeating it
- **Commodity** (oil and similar):
  - supply
  - demand
  - inventories
  - geopolitics
  - the calendar (OPEC meetings, weekly EIA reports)

Create the pack with `start`, then one `add` per node (`--under summary`). Give each node a short `--label` for its edge.

## Freshness

After a company reports, offer to refresh `last-call` and anything else dated, and set `asOf` on what you change. A refresh is a new version, so earlier quarters stay in the history.

## Growing it

- Add only what the owner asked for. One short paragraph per node, about 80 words, unless asked for more.
- Attach the new node to the node under discussion. If that is unclear, attach it to `summary`.
- Keep edge labels short ("CEO", "segment", "risk").
- Check facts against current sources online and record them with `--source "label=url"` (repeat the flag for more).
- Never remove or rewrite content the owner did not ask about. Use `kb remove` only when the owner explicitly asks for it.

## Reply format

Tell the owner what you added and where, then give the paragraph itself. For example:

> Added "CEO" under NVDA's summary (v2).
>
> (the paragraph you wrote)

## Commands

Run from the repo root; `-s` keeps npm quiet:

```bash
kb() { npm run -s kb --prefix backend -- "$@"; }

kb list
kb show NVDA [--full]
kb start NVDA --title "…" --text "…" [--source "label=url"]
kb add NVDA --under summary --id ceo --label CEO --title "…" --text "…" [--question "…"] [--as-of "Q2 FY2027"] [--source "label=url"] [-m "message"]
kb add NVDA --under summary --id fundamentals --label numbers --title "Fundamentals" --type fundamentals --text "one-line takeaway"
kb edit NVDA ceo [--title …] [--text …] [--question …] [--as-of "…"] [--source …]   # --as-of "" clears; --source replaces the list
kb link NVDA <from> <to> --label …      kb unlink NVDA <from> <to>
kb move NVDA <id> --under <id> [--label …]
kb remove NVDA <id> [--with-children]
kb history NVDA      kb revert NVDA <version>      kb delete NVDA
kb pull NVDA ~/kb/NVDA.json      kb push NVDA ~/kb/NVDA.json -m "message"
kb kind NVDA                      # company / not a company
```

`pull` and `push` files go under `~/kb/` (outside the repo). Relative paths mean the directory you ran the command from, and `pull` refuses to write anywhere inside the repo, because graphs are private.

A value that starts with a dash must be written with an equals sign: `--text="-3% yoy"`.

Writes print `NVDA v3 · add ceo` and the changed node. A `409` ("changed since it was read") means run the command again. Use `-m` for a useful message (1 to 120 characters); otherwise a default like `add ceo` is used.

## Keys and privacy

- The owner's key lives in `~/.config/trader-host/kb.env` (`KB_API_URL`, `KB_API_KEY`). Use it for real knowledge.
- The test user's key lives in `kb-test.env` in the same folder. Use it for every test: `KB_ENV=~/.config/trader-host/kb-test.env kb list`.
- `KB_API_URL` in both files points at the Mac host (`http://localhost:3200`) for now. When the API moves back to Render, change it in `kb.env` and `kb-test.env` to the Render URL.
- Do not print or paste the keys.
- Graphs are private. Never paste their content into the repo (code, tests, docs, fixtures, commit messages), and never use real graph content as test data.
