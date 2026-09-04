import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { readPersisted, writePersisted } from '../lib/persistentState';

const KEY = 'trader.scroll.v1';

/**
 * Puts the user back where they were on the page, not just on the right page.
 *
 * `RestoreLocation` already restores the route, but iOS discarding the tab is
 * a cold start: the document is rebuilt at the top. Scrolled halfway down a
 * position to read its stops, switching to the broker app and coming back
 * meant scrolling down again every time.
 *
 * Per path, so returning to Portfolio does not inherit Journal's offset, and
 * within the same one-hour window as every other restored piece of state —
 * yesterday's scroll position is noise, not memory.
 */
export function RestoreScroll() {
  const { pathname } = useLocation();
  const restored = useRef<string | null>(null);

  useEffect(() => {
    // Each path restores once. Without this guard, the write-on-scroll effect
    // below would fight it: React re-renders, this runs again, and the page
    // jumps back to the saved offset while the user is scrolling away from it.
    if (restored.current === pathname) return;
    restored.current = pathname;

    const saved = readPersisted<Record<string, number>>(KEY) ?? {};
    const y = saved[pathname];
    if (!y) return;

    // The content is not laid out yet on the frame this runs in — the route's
    // data usually arrives a tick later — so scrolling now would land at the
    // top of a short page. Two frames is enough for the common case, and a
    // failed restore is invisible rather than harmful.
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => window.scrollTo(0, y)),
    );
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  useEffect(() => {
    let pending = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      const saved = readPersisted<Record<string, number>>(KEY) ?? {};
      writePersisted(KEY, { ...saved, [pathname]: pending });
    };

    // Serialising JSON on every scroll event would be a real cost on a phone,
    // so the offset is only recorded periodically — and always at the moment
    // that actually matters, when the app is being backgrounded and may not
    // get another frame before iOS discards it.
    const onScroll = () => {
      pending = window.scrollY;
      if (timer === null) timer = setTimeout(flush, 250);
    };
    const onHide = () => {
      if (timer !== null) clearTimeout(timer);
      flush();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      if (timer !== null) clearTimeout(timer);
    };
  }, [pathname]);

  return null;
}
