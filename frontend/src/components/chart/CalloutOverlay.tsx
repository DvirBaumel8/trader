/**
 * The callout labels drawn over the chart.
 *
 * Its own component because this overlay has the worst track record in the
 * codebase: it shipped invisible three times in one evening — once with a
 * label price off the scale, once asking for coordinates a frame before the
 * chart had laid itself out, and finally painting underneath the library's
 * own canvases. Keeping it separate from chart setup, data pushing and replay
 * means the next person reading it sees only the thing that keeps breaking.
 */
export interface Callout {
  key: string;
  title: string;
  /**
   * The fill's OWN date, never the bar it happens to be drawn over.
   *
   * A boxed label reading EXIT $151.29 over a candle is a far stronger claim
   * than an arrow was: it asserts WHEN. Naming the real date means the chart
   * cannot imply a date it does not mean, and if a marker is ever moved
   * again, the discrepancy is visible rather than silent — which is how this
   * was caught, by the owner reading a date off the chart and doubting it.
   */
  date: string;
  price: string;
  color: string;
  /** Centre of the box. */
  boxX: number;
  boxY: number;
  /** The point the connector lands on. */
  tipX: number;
  tipY: number;
}

/** The callout box, in pixels. The layout reasons in these exact numbers. */
export const CALLOUT_W = 74;
export const CALLOUT_H = 42;
/** Clear air between the candle it clears and the box. */
export const CALLOUT_GAP_PX = 14;

const BOX_BG = '#0a0e17';

export function CalloutOverlay({ callouts }: { callouts: Callout[] }) {
  /*
    `pointer-events-none` throughout: the crosshair and the chart's own
    pan/pinch must keep working through the overlay — an annotation that eats
    touches on a phone would be worse than no annotation.

    z-index 3 is load-bearing, not decoration. The library's canvases are
    absolutely positioned at z-index 1 and 2, so an overlay left at `auto`
    paints UNDERNEATH them. The callouts were in the DOM, at the right
    coordinates, with opacity 1, and completely invisible; elementFromPoint
    over one returned CANVAS.
  */
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ zIndex: 3 }}
    >
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        {callouts.map((c) => (
          <g key={`line-${c.key}`}>
            <line
              x1={c.boxX}
              y1={c.boxY}
              x2={c.tipX}
              y2={c.tipY}
              stroke={c.color}
              strokeWidth="1.5"
            />
            <circle cx={c.tipX} cy={c.tipY} r="3" fill={c.color} />
          </g>
        ))}
      </svg>
      {callouts.map((c) => (
        <div
          key={c.key}
          // Centred on its anchor and nudged off it, so the box reads as
          // belonging to the line rather than sitting on it. translate
          // keeps this to one paint rather than a layout pass per frame
          // while the owner pans.
          // Fixed size, and the same numbers the layout reasoned with —
          // a box that measures differently than it was placed is a box
          // that overlaps something the algorithm thought it had cleared.
          style={{
            left: c.boxX,
            top: c.boxY,
            width: CALLOUT_W,
            height: CALLOUT_H,
            transform: 'translate(-50%, -50%)',
            borderColor: c.color,
            backgroundColor: BOX_BG,
          }}
          className="absolute flex flex-col items-center justify-center rounded-md border"
        >
          <span
            className="text-[9px] font-semibold uppercase leading-none tracking-wide"
            style={{ color: c.color }}
          >
            {c.title}
          </span>
          <span className="mt-0.5 text-[11px] font-semibold leading-none tabular-nums text-text">
            {c.price}
          </span>
          {c.date && (
            <span className="mt-0.5 text-[9px] leading-none text-muted">
              {c.date}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
