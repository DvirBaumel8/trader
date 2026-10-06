# Plan: two-way fill auto-fill and one-tap balance settle

Spec: `docs/superpowers/specs/2026-10-06-fill-autofill-and-balance-settle-design.md`

Two independent slices. Never touch the real `trader` database; backend tests
use `trader_test`, browser checks use `trader_e2e`.

## Task A — composer: price ↔ net cash (frontend only)

Files: `frontend/src/lib/entryDraft.ts`, `frontend/src/lib/entryDraft.spec.ts`,
`frontend/src/components/EntrySheet.tsx`, `frontend/src/components/EntrySheet.spec.tsx`.

1. TDD in `entryDraft.spec.ts`:
   - `computedPriceFromReportedCash` uses an explicit quantity argument (or a
     draft whose quantity is the displayed value) so the held-quantity
     suggestion counts.
   - New `computedNetCashFromPrice(draft)` → magnitude string/number:
     BUY `qty×price+fee`, SELL `qty×price−fee`, rounded to cents; undefined
     when qty or price missing/≤0 or result ≤0.
2. `EntrySheet.tsx`:
   - Add `netCashTouched` (reset wherever `priceTouched` is reset).
   - Price preview only when price untouched AND net cash typed. Net cash
     preview only when net cash untouched AND price typed. Never both
     derived from each other (no loop).
   - Feed the *displayed* quantity (`quantityValue`) into both computations.
   - `netCashValue` is what is shown, what `hasReportedNetCash` checks, what
     the balance preview uses, and what is sent as `reportedNetCash`
     (signed by side, like `signedReportedNetCash`).
   - No preview while editing an existing entry.
3. `EntrySheet.spec.tsx`: sell with held-quantity suggestion + net cash →
   price shown; typed price → net cash and balance shown; typed net cash then
   typed price → both kept; save payload carries computed net cash.

Verify: `npm test --prefix frontend`, `cd frontend && npx tsc -b`.

## Task B — settle balance with interest (backend + EntryCard)

Files: `backend/src/journal/journal.service.ts`, `journal.controller.ts`,
`backend/src/journal/*.spec.ts`, `backend/test/journal.e2e-spec.ts`,
`frontend/src/components/EntryCard.tsx` (+ spec), `docs/api.md`,
`docs/current-state.md`.

1. Backend view: add `interestToSettle: number | null` to
   `trade.reconciliation` (`expectedBalance − reportedBalance`, rounded to
   cents, null unless > 0.005).
2. `JournalService.settleBalance(entryId)`: resolve user via
   `usersService.currentUser()`; load entry filtered by `userId` (404
   otherwise); recompute the view for it; 400 unless `interestToSettle`
   non-null. In one transaction create a JournalEntry (kind INTEREST, body
   "Balance adjustment to match platform", `occurredAt` = trade entry's
   `occurredAt`, `createdAt` = trade entry `createdAt − 1ms` — confirm
   TypeORM honours an explicit CreateDateColumn value; if not, set it with an
   update in the same transaction) and its InterestCharge row via the existing
   write path. Return the new EntryView.
3. Controller: `@Post(':id/settle-balance')` with `ParseUUIDPipe`.
4. e2e (`journal.e2e-spec.ts`): reconciled trade with reportedBalance lower
   by 12.34 → `interestToSettle` 12.34 → POST settle → trade's
   `balanceMismatch` false, a following trade off by the same amount also
   clears; second POST → 400; platform-higher case → null + 400.
5. EntryCard: when `interestToSettle` is set, show "Add $X interest" control.
   The card root is a `<button>`, so the control must NOT be nested inside it
   — render it as a sibling under the card (or restructure) and stop
   propagation. First tap arms ("Add interest $X?"), second tap POSTs, then
   invalidate the same query keys the composer invalidates. Spec test for
   arm/confirm and that tapping it does not open the entry.
6. Docs: endpoint in `docs/api.md`; behaviour in `docs/current-state.md`.

Verify: `npm test`, `npm run test:e2e --prefix backend`, backend + frontend
type checks.

## Final review (main session)

Diff review against spec, full test runs, then a browser check at iPhone 16
Pro width against `trader_e2e` for both flows.

## Deviations

- Task A: a previewed field (price, net cash, balance after) selects its
  contents on focus (deferred `select()`, needed for iOS WebKit) so typing
  replaces the preview instead of appending. Covered by `e2e/composer.spec.ts`.
- Task B: the settle control shows in the normal list too, not only in edit
  mode; it still needs two taps. The interest entry appears under the Balance
  tab like every other interest entry.
- Added in the same batch (owner-approved): trade detail fetches the quote and
  extended extremes concurrently, skips both for closed trades (high-water
  bounded to entry→exit bars), and bounds provider waits at 4s
  (`PROVIDER_WAIT_MS`) — which also applies to every `getQuotes` caller.
