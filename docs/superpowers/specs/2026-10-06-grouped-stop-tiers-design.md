# Grouped stop tiers on the Stops page

Approved by the owner 2026-10-06.

A symbol with two or more stop tiers shows as ONE combined row in "Stop tiers":

- Left: symbol (+ SHORT/STALE badges as today), then
  "N stops · <covered shares> sh · now <price>".
- Right: combined % = total amountAtRisk ÷ (covered shares × current price)
  (share-weighted distance), and total $ at risk (sum of tiers).
- If any tier has passed, the combined row shows the PASSED treatment.
- Collapsed by default, not remembered. Tapping the combined row toggles it;
  expanded, each tier shows as an indented line (stop price, shares, its own
  %/$, "trails X% from …" when trailing). Tapping a tier line opens the trade,
  as a row does today.
- Single-tier symbols render exactly as today.
- Sorting operates on groups: "Largest risk first" by total $; nearest/
  farthest by the group's closest tier distance (most urgent never hides).
- The backend computes the totals and combined %; the frontend only groups
  for display and toggles.
