/**
 * jsdom (27+) delegates `window.localStorage` to Node's own Storage
 * implementation, which is gated behind `--localstorage-file` and otherwise
 * leaves the property undefined. Component tests that render real markup
 * need a real jsdom `window` for React to mount into, so swapping the whole
 * global (as the pure `lib/` specs do) isn't an option — this replaces just
 * the `localStorage` property on it with a plain in-memory Storage.
 */
export function stubLocalStorage(): void {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
  Object.defineProperty(window, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}
