/**
 * Error summary for dense forms.
 *
 * Rendered above a form after a failed submit. It is announced immediately
 * (role="alert"), receives focus so keyboard and screen-reader users land on
 * it, and lists each problem as a link that moves focus to the offending
 * field.
 */

import React, { useEffect, useId, useRef } from 'react';
import { setFocusOn } from '@/lib/accessibility/formHelpers';

export interface ErrorSummaryItem {
  /** `id` of the invalid form control. */
  fieldId: string;
  message: string;
}

export interface ErrorSummaryProps {
  errors: ErrorSummaryItem[];
  title?: string;
  className?: string;
  /**
   * Focus is moved to the summary whenever this value changes (and on mount).
   * Pass a counter that increments on each submit attempt. Deliberately NOT
   * derived from `errors`: errors change as the user fixes fields, and focus
   * must stay in the field they are typing in.
   */
  focusToken?: number | string;
}

export function ErrorSummary({
  errors,
  title = 'Please fix the following',
  className = '',
  focusToken,
}: ErrorSummaryProps) {
  const ref = useRef<HTMLDivElement>(null);
  const headingId = useId();

  // Move focus once per submit attempt, never as individual errors change.
  useEffect(() => {
    if (errors.length > 0) setFocusOn(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken]);

  if (errors.length === 0) return null;

  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      aria-labelledby={headingId}
      className={`rounded border border-red-500 p-4 ${className}`}
    >
      <h2 id={headingId} className="font-semibold">
        {title} ({errors.length} {errors.length === 1 ? 'error' : 'errors'})
      </h2>
      <ul>
        {errors.map((error) => (
          <li key={error.fieldId}>
            <a
              href={`#${error.fieldId}`}
              onClick={(event) => {
                event.preventDefault();
                setFocusOn(document.getElementById(error.fieldId));
              }}
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ErrorSummary;
