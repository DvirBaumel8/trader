-- One-off backfill: the ten exits that predate stop-execution recording.
--
-- Each row was confirmed by the owner individually (see
-- docs/superpowers/specs/2026-09-03-stop-executions-design.md). The app's own
-- price matcher is NOT used here: it would have misfiled MSTR, whose only tier
-- was a trailing stop the exit never reached, and the whole point of this
-- feature is that a confirmed record beats a plausible guess.
--
-- Every attribution was dry-run first and resolves to exactly one fill and one
-- tier. Run inside a single transaction (psql -1) so a partial apply is
-- impossible.

BEGIN;

-- A MRNA stop filed against the AVGO entry: 200 @ 161.93 sits on AVGO's SELL
-- transaction, but AVGO trades near 350-374 and no AVGO fill of 200 shares
-- exists anywhere. MRNA's own second sell already carries an identical tier.
-- This is a data correction, not a stop being retired - application code must
-- never delete a stop_levels row (see CLAUDE.md's append-only invariant).
DELETE FROM stop_levels WHERE id = 'b23d5bef-1c9f-42e7-a306-a1bae81d62ad';

WITH a(sym, fill_side, fill_qty, fill_px, stop_px, stop_qty, trail) AS (VALUES
  ('AVGO','SELL',   40.0, 349.91, 349.93,   40.0, NULL::numeric),
  ('BE',  'SELL',   45.0, 206.90, 207.08,   45.0, NULL),
  ('BITX','SELL', 1000.0,  17.46,  17.46, 1000.0, NULL),
  ('BITX','SELL',  800.0,  17.07,  17.07,  800.0, NULL),
  ('BMNR','SELL',  500.0,  24.34,  24.34,  500.0, NULL),
  ('MRNA','BUY',   200.0, 149.65, 149.64,  200.0, NULL),
  ('MSTR','SELL',  100.0, 123.07,   NULL,  100.0, 11.9),
  ('NVDA','SELL',  151.0, 220.07, 220.07,  151.0, NULL),
  ('PLTR','SELL',  120.0, 167.15, 167.13,  120.0, NULL),
  ('SMCI','SELL',  600.0,  36.92,  36.92,  600.0, NULL)
)
INSERT INTO stop_executions ("stopLevelId", "transactionId", quantity)
SELECT s.id, tx.id, a.fill_qty
FROM a
JOIN instruments i   ON i.symbol = a.sym
JOIN transactions tx ON tx."instrumentId" = i.id AND tx.side = a.fill_side
                    AND tx.quantity = a.fill_qty AND tx.price = a.fill_px
JOIN stop_levels s   ON s.quantity = a.stop_qty
JOIN transactions ot ON ot.id = s."transactionId" AND ot."instrumentId" = i.id
WHERE (a.stop_px IS NOT NULL AND s.price = a.stop_px)
   OR (a.trail   IS NOT NULL AND s."trailPercent" = a.trail);

-- Every fill that now carries an execution was a stop. None of the ten were
-- discretionary; MSTR was checked most carefully and the owner confirmed it.
UPDATE transactions SET "exitKind" = 'STOP'
WHERE id IN (SELECT DISTINCT "transactionId" FROM stop_executions);

COMMIT;
