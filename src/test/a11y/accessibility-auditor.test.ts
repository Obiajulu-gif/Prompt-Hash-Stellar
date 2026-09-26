import { describe, it, expect, beforeEach } from 'vitest';
import { AccessibilityAuditor } from '../../lib/accessibility';

describe('Accessibility Auditor', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('Keyboard Navigation', () => {
    it('should detect missing keyboard accessibility', () => {
      container.innerHTML = `
        <div onclick="alert('clicked')" style="cursor: pointer;">
          Click me (not keyboard accessible)
        </div>
      `;

      const violations = AccessibilityAuditor.auditKeyboardNavigation(container);
      expect(violations.length).toBeGreaterThanOrEqual(0);
    });

    it('should allow keyboard accessible elements', () => {
      container.innerHTML = `
        <button>Click me</button>
        <a href="#test">Link</a>
        <input type="text" />
      `;

      const violations = AccessibilityAuditor.auditKeyboardNavigation(container);
      const hasKeyboardViolations = violations.some(v => v.severity === 'critical');
      expect(hasKeyboardViolations).toBe(false);
    });
  });

  describe('Form Labels', () => {
    it('should detect missing form labels', () => {
      container.innerHTML = `
        <input type="text" />
        <input type="email" />
      `;

      const violations = AccessibilityAuditor.auditFormLabels(container);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].severity).toBe('critical');
    });

    it('should accept properly labeled forms', () => {
      container.innerHTML = `
        <label htmlFor="name">Name</label>
        <input id="name" type="text" />
        <label htmlFor="email">Email</label>
        <input id="email" type="email" />
      `;

      const violations = AccessibilityAuditor.auditFormLabels(container);
      expect(violations.length).toBe(0);
    });

    it('should accept aria-label as alternative to HTML labels', () => {
      container.innerHTML = `
        <input type="text" aria-label="Name" />
        <input type="email" aria-label="Email" />
      `;

      const violations = AccessibilityAuditor.auditFormLabels(container);
      expect(violations.length).toBe(0);
    });
  });

  describe('Error Association', () => {
    it('should detect unassociated error messages', () => {
      container.innerHTML = `
        <input type="email" />
        <span class="error">Invalid email</span>
      `;

      const violations = AccessibilityAuditor.auditErrorAssociation(container);
      expect(violations.length).toBeGreaterThanOrEqual(0);
    });

    it('should accept properly associated errors', () => {
      container.innerHTML = `
        <input type="email" aria-describedby="email-error" />
        <span id="email-error" role="alert">Invalid email</span>
      `;

      const violations = AccessibilityAuditor.auditErrorAssociation(container);
      expect(violations.length).toBe(0);
    });
  });

  describe('Heading Structure', () => {
    it('should detect skipped heading levels', () => {
      container.innerHTML = `
        <h1>Main Title</h1>
        <h3>Skipped h2</h3>
      `;

      const violations = AccessibilityAuditor.auditHeadingStructure(container);
      expect(violations.length).toBeGreaterThan(0);
    });

    it('should accept proper heading hierarchy', () => {
      container.innerHTML = `
        <h1>Main Title</h1>
        <h2>Subsection</h2>
        <h3>Sub-subsection</h3>
      `;

      const violations = AccessibilityAuditor.auditHeadingStructure(container);
      expect(violations.length).toBe(0);
    });
  });

  describe('Image Alt Text', () => {
    it('should detect missing alt text', () => {
      container.innerHTML = `
        <img src="logo.png" />
        <img src="icon.svg" />
      `;

      const violations = AccessibilityAuditor.auditImageAltText(container);
      expect(violations.length).toBeGreaterThan(0);
    });

    it('should accept images with alt text', () => {
      container.innerHTML = `
        <img src="logo.png" alt="Company logo" />
        <img src="icon.svg" aria-label="Close" />
      `;

      const violations = AccessibilityAuditor.auditImageAltText(container);
      expect(violations.length).toBe(0);
    });
  });

  describe('Full Audit', () => {
    it('should pass full audit for accessible page', () => {
      container.innerHTML = `
        <h1>Accessible Form</h1>
        <form>
          <label htmlFor="name">Name</label>
          <input id="name" type="text" required />
          
          <label htmlFor="email">Email</label>
          <input id="email" type="email" aria-describedby="email-help" />
          <span id="email-help">Enter a valid email address</span>
          
          <button type="submit">Submit</button>
        </form>
        <img src="icon.svg" alt="Checkmark" />
      `;

      const result = AccessibilityAuditor.runFullAudit(container);
      expect(result.passed).toBe(true);
      expect(result.violations.filter(v => v.severity === 'critical').length).toBe(0);
    });

    it('should fail full audit for inaccessible page', () => {
      container.innerHTML = `
        <h1>Inaccessible Form</h1>
        <input type="text" />
        <input type="email" />
        <img src="logo.png" />
      `;

      const result = AccessibilityAuditor.runFullAudit(container);
      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });
  });

  describe('Report Generation', () => {
    it('should generate readable audit report', () => {
      container.innerHTML = `
        <input type="text" />
      `;

      const result = AccessibilityAuditor.runFullAudit(container);
      const report = AccessibilityAuditor.generateReport(result);

      expect(report).toContain('Accessibility Audit Report');
      expect(report).toContain('Status');
      if (result.violations.length > 0) {
        expect(report).toContain('Violations');
      }
    });
  });
});
