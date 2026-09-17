# Task 4 review-fix report

## Scope

Addressed only the two review findings:

- Replaced `Partial<Record<string, unknown>>` in `Watchlist.spec.tsx` with a typed `baseRow` and `Partial<typeof baseRow>` overrides. Nullable and union-valued fields remain representable while unknown row fields and incompatible values are rejected by TypeScript.
- Scoped the `Element.prototype.scrollIntoView` replacement in the Dashboard and Watchlist focus tests with `try/finally`, restoring the original method even when an assertion fails.

## Verification

- `npm run test --prefix frontend -- Dashboard.spec.tsx Watchlist.spec.tsx` — 2 files, 43 tests passed.
- `npx tsc -b` from `frontend/` — passed.
- `git diff --check` — passed.
