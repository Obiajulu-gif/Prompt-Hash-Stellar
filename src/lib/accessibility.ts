export interface AccessibilityAuditResult {
  passed: boolean;
  violations: AccessibilityViolation[];
  warnings: AccessibilityWarning[];
}

export interface AccessibilityViolation {
  element: string;
  issue: string;
  severity: 'critical' | 'serious' | 'moderate' | 'minor';
  remediation: string;
}

export interface AccessibilityWarning {
  element: string;
  issue: string;
  recommendation: string;
}

const WCAG_LEVEL_A_REQUIREMENTS = {
  keyboard: {
    description: 'All functionality must be keyboard accessible',
    test: 'Tab through the entire page without getting stuck',
  },
  focusVisible: {
    description: 'Focus indicator must be visible',
    test: 'Use browser DevTools to check focus-visible styles',
  },
  formLabels: {
    description: 'All form fields must have associated labels',
    test: 'Check that each input has a <label> with matching htmlFor',
  },
  ariaLabels: {
    description: 'Non-text content must have text alternatives',
    test: 'Icons and images should have aria-label or alt text',
  },
  errorAssociation: {
    description: 'Form errors must be associated with fields',
    test: 'Use aria-describedby to link errors to inputs',
  },
  colorContrast: {
    description: 'Text must have sufficient color contrast (4.5:1)',
    test: 'Use WAVE or Lighthouse to check contrast ratios',
  },
  headingStructure: {
    description: 'Headings should use proper hierarchy (h1, h2, h3)',
    test: 'No skipped heading levels (e.g., h1 → h3)',
  },
};

export class AccessibilityAuditor {
  static auditKeyboardNavigation(container: HTMLElement): AccessibilityViolation[] {
    const violations: AccessibilityViolation[] = [];

    const interactiveElements = container.querySelectorAll(
      'button, a, input, select, textarea, [tabindex]'
    );

    interactiveElements.forEach(el => {
      const element = el as HTMLElement;

      if (!element.offsetParent && element.style.display !== 'none') {
        violations.push({
          element: element.tagName,
          issue: 'Interactive element might not be keyboard accessible',
          severity: 'serious',
          remediation: 'Ensure element is visible and in tab order (tabindex >= 0)',
        });
      }

      if (element.getAttribute('tabindex') === '-1' && !element.hasAttribute('aria-hidden')) {
        violations.push({
          element: element.tagName,
          issue: 'Element removed from tab order but not hidden from screen readers',
          severity: 'moderate',
          remediation: 'Add aria-hidden="true" or ensure it should be in tab order',
        });
      }
    });

    return violations;
  }

  static auditFormLabels(container: HTMLElement): AccessibilityViolation[] {
    const violations: AccessibilityViolation[] = [];

    const inputs = container.querySelectorAll('input, select, textarea');

    inputs.forEach(input => {
      const inputEl = input as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const id = inputEl.id;
      const ariaLabel = inputEl.getAttribute('aria-label');
      const ariaLabelledBy = inputEl.getAttribute('aria-labelledby');

      // Check for label association
      if (!id && !ariaLabel && !ariaLabelledBy) {
        violations.push({
          element: `<${inputEl.tagName.toLowerCase()} />`,
          issue: 'Form field has no associated label',
          severity: 'critical',
          remediation: 'Add <label htmlFor="id"> or aria-label to the input',
        });
      }

      if (id) {
        const label = container.querySelector(`label[for="${id}"]`);
        if (!label) {
          violations.push({
            element: `<label for="${id}" />`,
            issue: 'No associated label found for input',
            severity: 'serious',
            remediation: 'Add <label htmlFor="' + id + '"> element',
          });
        }
      }
    });

    return violations;
  }

  static auditErrorAssociation(container: HTMLElement): AccessibilityViolation[] {
    const violations: AccessibilityViolation[] = [];

    const errorMessages = container.querySelectorAll('[role="alert"], .error, .error-message');

    errorMessages.forEach(error => {
      const errorEl = error as HTMLElement;
      const describedBy = errorEl.id || '';

      if (!describedBy) {
        violations.push({
          element: errorEl.className,
          issue: 'Error message has no ID for aria-describedby',
          severity: 'serious',
          remediation: 'Add an id to the error element',
        });
      }

      const inputs = container.querySelectorAll(`input[aria-describedby~="${describedBy}"]`);
      if (inputs.length === 0 && describedBy) {
        violations.push({
          element: 'input',
          issue: 'Error not associated with input field',
          severity: 'serious',
          remediation: `Add aria-describedby="${describedBy}" to the related input`,
        });
      }
    });

    return violations;
  }

  static auditHeadingStructure(container: HTMLElement): AccessibilityViolation[] {
    const violations: AccessibilityViolation[] = [];

    const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
    let lastLevel = 0;

    headings.forEach(heading => {
      const level = parseInt(heading.tagName[1], 10);

      if (level > lastLevel + 1) {
        violations.push({
          element: heading.tagName,
          issue: `Heading level skipped from h${lastLevel} to h${level}`,
          severity: 'moderate',
          remediation: 'Use consecutive heading levels (h1, h2, h3) without skipping',
        });
      }

      lastLevel = level;
    });

    return violations;
  }

  static auditColorContrast(): AccessibilityWarning[] {
    const warnings: AccessibilityWarning[] = [];

    warnings.push({
      element: 'body',
      issue: 'Manual contrast check required',
      recommendation:
        'Use Lighthouse or WAVE browser extension to check text/background contrast ratios (minimum 4.5:1 for normal text)',
    });

    return warnings;
  }

  static auditImageAltText(container: HTMLElement): AccessibilityViolation[] {
    const violations: AccessibilityViolation[] = [];

    const images = container.querySelectorAll('img');

    images.forEach(img => {
      const alt = img.getAttribute('alt');
      const ariaLabel = img.getAttribute('aria-label');

      if (!alt && !ariaLabel) {
        violations.push({
          element: '<img />',
          issue: 'Image missing alt text',
          severity: 'serious',
          remediation: 'Add descriptive alt text to the image',
        });
      }
    });

    return violations;
  }

  static runFullAudit(container: HTMLElement): AccessibilityAuditResult {
    const violations: AccessibilityViolation[] = [];

    violations.push(...this.auditKeyboardNavigation(container));
    violations.push(...this.auditFormLabels(container));
    violations.push(...this.auditErrorAssociation(container));
    violations.push(...this.auditHeadingStructure(container));
    violations.push(...this.auditImageAltText(container));

    const warnings: AccessibilityWarning[] = [...this.auditColorContrast()];

    const criticalViolations = violations.filter(v => v.severity === 'critical');

    return {
      passed: criticalViolations.length === 0,
      violations,
      warnings,
    };
  }

  static generateReport(result: AccessibilityAuditResult): string {
    const lines: string[] = [];

    lines.push('# Accessibility Audit Report\n');
    lines.push(`Status: ${result.passed ? '✅ PASSED' : '❌ FAILED'}\n`);

    if (result.violations.length > 0) {
      lines.push(`## Violations (${result.violations.length})\n`);
      result.violations.forEach(v => {
        lines.push(`- **${v.severity.toUpperCase()}**: ${v.issue}`);
        lines.push(`  Element: \`${v.element}\``);
        lines.push(`  Fix: ${v.remediation}\n`);
      });
    }

    if (result.warnings.length > 0) {
      lines.push(`## Warnings (${result.warnings.length})\n`);
      result.warnings.forEach(w => {
        lines.push(`- ${w.issue}`);
        lines.push(`  Recommendation: ${w.recommendation}\n`);
      });
    }

    return lines.join('\n');
  }
}
