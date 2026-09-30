/**
 * Accessibility form helpers — WCAG 2.1 AA
 *
 * Provides standardised ARIA attribute builders, live-region announcer,
 * focus management utilities, and a focus-trap implementation used by all
 * modal dialogs in the marketplace.
 *
 * Import pattern:
 *   import { getFormFieldAriaAttrs, announceStatus, createFocusTrap } from '@/lib/accessibility/formHelpers';
 */

// ─── ARIA attribute builders ──────────────────────────────────────────────────

export interface FormFieldAriaOptions {
  /** The `id` of the form control (input, textarea, select). */
  fieldId: string;
  /** Whether the field currently has a validation error. */
  hasError: boolean;
  /** The error message string (if any). Used to derive the describedby id. */
  errorMessage?: string;
  /** Optional help text that should also be linked via aria-describedby. */
  helpTextId?: string;
  /** Whether the field is required. */
  isRequired?: boolean;
}

/**
 * Returns the ARIA props to spread onto an `<input>`, `<textarea>`, or
 * `<select>` element. Combines `aria-invalid`, `aria-required`, and
 * `aria-describedby` (linking to both error message and help text).
 */
export function getFormFieldAriaAttrs(opts: FormFieldAriaOptions): {
  "aria-invalid": boolean | "true" | "false";
  "aria-required"?: boolean;
  "aria-describedby"?: string;
} {
  const ids: string[] = [];
  if (opts.hasError && opts.errorMessage) {
    ids.push(`${opts.fieldId}-error`);
  }
  if (opts.helpTextId) {
    ids.push(opts.helpTextId);
  }

  return {
    "aria-invalid": opts.hasError ? "true" : "false",
    ...(opts.isRequired ? { "aria-required": true } : {}),
    ...(ids.length > 0 ? { "aria-describedby": ids.join(" ") } : {}),
  };
}

/**
 * Returns the props to spread onto an error message element so it is
 * correctly associated with and announced for its field.
 */
export function renderErrorMessage(
  fieldId: string,
  _message: string,
): { id: string; role: "alert"; "aria-live": "assertive"; "aria-atomic": "true" } {
  return {
    id: `${fieldId}-error`,
    role: "alert",
    "aria-live": "assertive",
    "aria-atomic": "true",
  };
}

/**
 * Returns the props for a `<label>` element.
 */
export function renderLabel(
  fieldId: string,
  _labelText: string,
  required?: boolean,
): { htmlFor: string; "aria-required"?: boolean } {
  return {
    htmlFor: fieldId,
    ...(required ? { "aria-required": true } : {}),
  };
}

// ─── Live-region announcer ────────────────────────────────────────────────────

let _politeRegion: HTMLElement | null = null;
let _assertiveRegion: HTMLElement | null = null;

function getOrCreateRegion(politeness: "polite" | "assertive"): HTMLElement {
  if (politeness === "assertive") {
    if (!_assertiveRegion) {
      _assertiveRegion = document.createElement("div");
      _assertiveRegion.setAttribute("aria-live", "assertive");
      _assertiveRegion.setAttribute("aria-atomic", "true");
      _assertiveRegion.setAttribute("aria-relevant", "additions text");
      Object.assign(_assertiveRegion.style, {
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: "0",
        overflow: "hidden",
        clip: "rect(0,0,0,0)",
        whiteSpace: "nowrap",
        border: "0",
      });
      document.body.appendChild(_assertiveRegion);
    }
    return _assertiveRegion;
  }

  if (!_politeRegion) {
    _politeRegion = document.createElement("div");
    _politeRegion.setAttribute("aria-live", "polite");
    _politeRegion.setAttribute("aria-atomic", "true");
    Object.assign(_politeRegion.style, {
      position: "absolute",
      width: "1px",
      height: "1px",
      padding: "0",
      overflow: "hidden",
      clip: "rect(0,0,0,0)",
      whiteSpace: "nowrap",
      border: "0",
    });
    document.body.appendChild(_politeRegion);
  }
  return _politeRegion;
}

/**
 * Announces a message to screen readers via a visually-hidden live region.
 *
 * @param message  Text to announce.
 * @param politeness  "polite" waits for the user to be idle; "assertive"
 *                    interrupts immediately. Use "assertive" for errors.
 */
export function announceStatus(
  message: string,
  politeness: "polite" | "assertive" = "polite",
): void {
  if (typeof document === "undefined") return;
  const region = getOrCreateRegion(politeness);
  // Clear first so repeated identical messages still re-announce.
  region.textContent = "";
  // Use a small delay so the DOM mutation is registered as a change.
  setTimeout(() => {
    region.textContent = message;
  }, 50);
}

// ─── Focus utilities ──────────────────────────────────────────────────────────

const FOCUSABLE_SELECTORS = [
  "a[href]",
  "area[href]",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "button:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "details > summary",
  "iframe",
].join(", ");

/**
 * Returns all focusable descendants of `container` in DOM order.
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)).filter(
    (el) => !el.closest("[hidden]") && el.offsetParent !== null,
  );
}

/**
 * Moves focus to `el`. Falls back gracefully if `el` is null.
 */
export function setFocusOn(el: HTMLElement | null): void {
  if (!el) return;
  // Make temporarily focusable if needed
  if (el.tabIndex < 0) {
    el.tabIndex = -1;
  }
  el.focus({ preventScroll: false });
}

// ─── Focus trap ───────────────────────────────────────────────────────────────

export interface FocusTrap {
  /**
   * Call from the container's `keydown` handler.
   * Intercepts Tab and Shift+Tab to cycle within the container.
   */
  handleKeyDown(e: KeyboardEvent): void;
}

/**
 * Creates a focus trap for a modal container.
 * Focus cycles between the first and last focusable child on Tab / Shift+Tab.
 *
 * @example
 * const trap = createFocusTrap(modalRef.current!);
 * modalRef.current.addEventListener('keydown', trap.handleKeyDown);
 */
export function createFocusTrap(container: HTMLElement): FocusTrap {
  return {
    handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const focusable = getFocusableElements(container);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: if on first element, wrap to last
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: if on last element, wrap to first
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
  };
}
