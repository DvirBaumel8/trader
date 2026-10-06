# Two-way fill auto-fill and one-tap balance settle

Approved by the owner 2026-10-06.

## 1. Price and net cash fill each other

On the trade composer, once ticker and quantity are known:

- Typing **net cash** fills the price (existing behaviour). Fix: it must also
  work when the quantity shown is the held-position suggestion rather than a
  typed value.
- Typing **price** fills net cash: BUY `qty × price + fee`, SELL
  `qty × price − fee`, rounded to cents.
- The field the owner typed always wins; the other follows live. Both typed →
  both stand as typed.
- "Balance after" keeps previewing from net cash, so it now also fills from a
  typed price.
- A computed net cash is saved exactly like a typed one (it satisfies the
  reconciliation requirement).
- Accepted trade-off: when net cash was computed, its "net cash off" check is
  meaningless for that trade. The balance check still works.
- Editing an existing entry does not auto-fill (same rule as today's price and
  balance previews).

## 2. "Balance off" → add the missing interest

- A reconciled trade whose platform balance is **lower** than the derived
  balance shows an **"Add $X interest"** control by the warning.
- First tap arms it ("Add interest $X?"); second tap confirms.
- The backend computes `X = expectedBalance − reportedBalance`, never the
  frontend. It is exposed on the entry view as
  `trade.reconciliation.interestToSettle` (`number | null`, null unless
  `X > 0.005`).
- `POST /api/journal/:id/settle-balance` creates an ordinary INTEREST entry for
  `X`, body "Balance adjustment to match platform", dated on the trade's date
  and ordered **immediately before** the trade (its journal entry's
  `createdAt` is set just before the trade entry's `createdAt`) so the trade's
  own balance check — and later trades off by the same amount — clear.
- Rejects (400) when the entry is not a reconciled trade or nothing is owed;
  404 for another user's entry.
- Platform higher than derived: no control (interest received is out of
  scope).

## Out of scope

Interest received, bulk settlement, editing past trades.
