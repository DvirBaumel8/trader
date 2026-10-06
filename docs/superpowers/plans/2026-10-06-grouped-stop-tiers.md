# Plan: grouped stop tiers

Spec: `docs/superpowers/specs/2026-10-06-grouped-stop-tiers-design.md`

One vertical slice.

1. Backend (`backend/src/portfolio/stop-distance.ts` + spec, `portfolio.service.ts`):
   pure `groupStopTiers(rows: StopDistanceRow[])` → per symbol
   `{ symbol, direction, currentPrice, session, extended, stale, tierCount,
   quantity (sum), amountAtRisk (sum, cents), distance (combined =
   amountAtRisk / (quantity × currentPrice), signed like tiers), nearestDistance
   (min tier distance), passed (any), tiers: StopDistanceRow[] }`.
   Fixture-tested (two NVDA tiers 150@215.93 and 150@229.93, now 240.74 →
   5343.00 and ≈0.0740; single tier passes through; passed propagates).
   Expose as `stopGroups` on the portfolio response next to `stopTiers`
   (keep `stopTiers` for existing consumers). e2e assertion in
   backend/test/portfolio.e2e-spec.ts.
2. Frontend (`frontend/src/lib/sortStopTiers.ts`, `frontend/src/routes/Stops.tsx`
   + specs): sort groups — 'risk' by amountAtRisk, 'asc'/'desc' by
   nearestDistance. Render tierCount===1 with the existing StopTierRowView;
   otherwise a combined row (button, aria-expanded, chevron) that toggles
   indented tier lines, each linking to the trade like today.
3. Verify: workspace tests, backend e2e, type checks, browser check at iPhone
   16 Pro width against trader_e2e.

## Deviations

- Frontend sort function renamed `sortStopTiers` -> `sortStopGroups` (file and spec
  keep the `sortStopTiers` names); it sorts on `nearestDistance` and `amountAtRisk`.
- Stops.tsx now reads only `stopGroups`; `stopTiers` is no longer in its type
  (still served by the backend). Single-tier groups render `group.tiers[0]` via
  `StopTierRowView`.
- Extracted a shared `StopFigures` component (right-hand % / $ / PASSED column) used
  by the single row, combined row and tier lines.
- Browser check at iPhone width against `trader_e2e` (plan step 3) not done here.
