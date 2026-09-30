/**
 * Accessibility test setup.
 * Imports jest-axe for automated WCAG violation detection.
 */

import { expect, afterEach } from 'vitest';
import { axe, toHaveNoViolations } from 'jest-axe';

// Extend Vitest matchers with jest-axe
expect.extend(toHaveNoViolations);

declare global {
  namespace Vi {
    interface Matchers<R> {
      toHaveNoViolations(): R;
    }
  }
}

// Clean up DOM after each test
afterEach(() => {
  document.body.innerHTML = '';
});
