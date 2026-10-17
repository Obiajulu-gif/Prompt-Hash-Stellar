/**
 * Shared helpers for accessibility regression tests.
 *
 * jsdom has no layout engine, so `offsetParent` is always null and the
 * production focus-trap helper (which skips elements without an offsetParent)
 * would see no focusable elements. `installLayoutShim` makes rendered elements
 * report their parent, which is enough for visibility checks.
 */

export function installLayoutShim(): () => void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() {
      return this.parentNode;
    },
  });
  return () => {
    if (original) Object.defineProperty(HTMLElement.prototype, "offsetParent", original);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetParent;
  };
}

/** Stub window.matchMedia for `prefers-reduced-motion`. Returns a trigger. */
export function mockReducedMotion(initial: boolean) {
  let matches = initial;
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes("prefers-reduced-motion") ? matches : false;
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
  return {
    listenerCount: () => listeners.size,
    set(next: boolean) {
      matches = next;
      listeners.forEach((cb) => cb({ matches: next } as MediaQueryListEvent));
    },
  };
}

/** All tabbable elements in document order (mirrors what Tab visits). */
export function tabStops(root: ParentNode = document.body): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}
