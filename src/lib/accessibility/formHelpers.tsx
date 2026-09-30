/**
 * Accessibility helpers for forms.
 * Standardizes ARIA attributes and patterns for error states, labels, and descriptions.
 */

import { ReactNode } from 'react';

export interface FormFieldAccessibilityProps {
  fieldId: string;
  hasError: boolean;
  errorMessage?: string;
  helpText?: string;
  isRequired?: boolean;
}

export interface FormFieldAriaAttrs {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby'?: string;
}

/**
 * Generate ARIA attributes for a form field with error state
 */
export function getFormFieldAriaAttrs(props: FormFieldAccessibilityProps): FormFieldAriaAttrs {
  const { fieldId, hasError, errorMessage, helpText } = props;

  const ariaDescribedBy: string[] = [];
  if (errorMessage) {
    ariaDescribedBy.push(`${fieldId}-error`);
  }
  if (helpText) {
    ariaDescribedBy.push(`${fieldId}-hint`);
  }

  return {
    id: fieldId,
    'aria-invalid': hasError,
    'aria-describedby': ariaDescribedBy.length > 0 ? ariaDescribedBy.join(' ') : undefined,
  };
}

export interface ErrorMessageProps {
  id: string;
  role: 'alert';
  className: string;
}

/**
 * Generate error message element with proper ARIA attributes
 */
export function getErrorMessageProps(fieldId: string): ErrorMessageProps {
  return {
    id: `${fieldId}-error`,
    role: 'alert',
    className: 'text-sm text-red-400 mt-1',
  };
}

export interface HelpTextProps {
  id: string;
  className: string;
}

/**
 * Generate help text element with proper ARIA linkage
 */
export function getHelpTextProps(fieldId: string): HelpTextProps {
  return {
    id: `${fieldId}-hint`,
    className: 'text-xs text-slate-400 mt-1',
  };
}

export interface LabelProps {
  htmlFor: string;
  className: string;
}

/**
 * Generate accessible label with optional required indicator
 */
export function getLabelProps(fieldId: string, labelText: string): LabelProps {
  return {
    htmlFor: fieldId,
    className: 'text-sm font-semibold text-white',
  };
}

/**
 * Get required indicator span (hidden from screen readers, visual only)
 */
export function getRequiredIndicator(): JSX.Element {
  return <span aria-hidden="true" className="text-red-400 ml-1">*</span>;
}

/**
 * Announce status changes to screen readers (non-disruptive)
 */
export function announceStatus(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
  if (typeof document === 'undefined') return;

  const announcement = document.createElement('div');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', priority);
  announcement.setAttribute('aria-atomic', 'true');
  announcement.className = 'sr-only'; // Screen reader only
  announcement.textContent = message;

  document.body.appendChild(announcement);

  // Remove after announcement is read (2 seconds)
  setTimeout(() => {
    announcement.remove();
  }, 2000);
}

/**
 * Focus management helper - set focus on element
 */
export function setFocusOn(elementOrId: HTMLElement | string): void {
  if (typeof document === 'undefined') return;

  const element = typeof elementOrId === 'string'
    ? document.getElementById(elementOrId)
    : elementOrId;

  if (element) {
    element.focus();
    // Ensure element is scrolled into view
    if (element.scrollIntoView) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

export interface FocusTrap {
  firstElement?: HTMLElement;
  lastElement?: HTMLElement;
  handleKeyDown(e: KeyboardEvent): void;
}

/**
 * Manage focus trap for modals (keeps focus within container)
 */
export function createFocusTrap(containerEl: HTMLElement): FocusTrap {
  const focusableElements = containerEl.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  ) as NodeListOf<HTMLElement>;

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  return {
    firstElement,
    lastElement,
    handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      if (!firstElement || !lastElement) return;

      if (e.shiftKey) {
        // Shift+Tab on first element: focus last
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab on last element: focus first
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    },
  };
}
