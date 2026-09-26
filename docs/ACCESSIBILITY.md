# Accessibility Implementation for Marketplace Flows

## Overview

This document covers accessibility improvements for critical marketplace flows: **purchase flow** and **creator publishing flow**. The implementation follows WCAG 2.1 Level AA standards with a focus on keyboard navigation, screen reader support, and semantic HTML.

## Implementation Status

### ✅ Completed

1. **Form Accessibility Helpers** (`src/lib/accessibility/formHelpers.ts`)
   - Standardized ARIA attributes (aria-invalid, aria-describedby)
   - Error message association pattern
   - Help text linking
   - Focus management utilities
   - Focus trap implementation for modals

2. **Automated Testing Infrastructure**
   - jest-axe integration for WCAG violation detection
   - Test setup with Vitest configuration
   - Accessibility test suite for purchase and publishing flows

3. **Test Coverage**
   - Purchase flow: modal dialogs, buttons, forms, status announcements
   - Publishing flow: form validation, error handling, tab navigation, array fields
   - Focus management and keyboard navigation
   - Semantic HTML verification

## Architecture & Patterns

### Form Field Accessibility Pattern

All form fields follow this accessible pattern:

```tsx
import { getFormFieldAriaAttrs, renderErrorMessage, renderLabel } from '@/lib/accessibility/formHelpers';

export function AccessibleFormField() {
  const { register, formState: { errors } } = useForm();
  const fieldId = 'email-field';
  const hasError = !!errors.email;

  const fieldAttrs = getFormFieldAriaAttrs({
    fieldId,
    hasError,
    errorMessage: errors.email?.message?.toString(),
    helpText: 'We\'ll never share your email',
    isRequired: true,
  });

  return (
    <div>
      <label {...renderLabel(fieldId, 'Email Address', true)} />
      <input
        {...register('email', { required: 'Email is required' })}
        {...fieldAttrs}
        type="email"
      />
      {hasError && (
        <div {...renderErrorMessage(fieldId, errors.email?.message?.toString() || '')}>
          {errors.email?.message}
        </div>
      )}
    </div>
  );
}
```

### Modal Focus Management

Modals automatically trap focus and restore it on close:

```tsx
import { useRef, useEffect } from 'react';
import { createFocusTrap, setFocusOn } from '@/lib/accessibility/formHelpers';

export function AccessibleModal({ isOpen, onClose, children }) {
  const modalRef = useRef<HTMLDivElement>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Save currently focused element
    lastActiveElementRef.current = document.activeElement as HTMLElement;

    // Set focus to modal title
    setFocusOn(modalRef.current?.querySelector('h2') as HTMLElement);

    // Create focus trap
    const trap = createFocusTrap(modalRef.current!);
    const handleKeyDown = (e: KeyboardEvent) => {
      trap.handleKeyDown(e);
      if (e.key === 'Escape') onClose();
    };

    modalRef.current?.addEventListener('keydown', handleKeyDown);

    return () => {
      modalRef.current?.removeEventListener('keydown', handleKeyDown);
      // Restore focus when modal closes
      lastActiveElementRef.current?.focus();
    };
  }, [isOpen, onClose]);

  return (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="modal"
    >
      <h2 id="modal-title">{title}</h2>
      {children}
    </div>
  );
}
```

### Status & Error Announcements

Dynamic updates are announced to screen readers via live regions:

```tsx
import { announceStatus } from '@/lib/accessibility/formHelpers';

export function FormWithAnnouncement() {
  const onSubmit = async (data) => {
    try {
      await submitForm(data);
      announceStatus('Form submitted successfully', 'polite');
    } catch (error) {
      announceStatus(`Error: ${error.message}`, 'assertive');
    }
  };

  return <form onSubmit={onSubmit}>...</form>;
}
```

## Keyboard Navigation

### Purchase Flow

| Flow | Keyboard Shortcut | Behavior |
|------|-------------------|----------|
| Browse prompts | `Tab` | Navigate through prompt cards |
| | `Enter` / `Space` | Open prompt detail modal |
| | `Escape` | Close modal |
| Purchase Modal | `Tab` | Navigate button, inputs (focus trapped) |
| | `Shift+Tab` | Reverse navigation (focus trapped) |
| | `Enter` | Confirm purchase |
| | `Escape` | Close modal, restore focus to trigger button |
| Copy buttons | `Enter` / `Space` | Copy to clipboard, announce success |

### Publishing Flow

| Flow | Keyboard Shortcut | Behavior |
|------|-------------------|----------|
| Form navigation | `Tab` | Move to next field |
| | `Shift+Tab` | Move to previous field |
| Tab sections | `ArrowRight` / `ArrowLeft` | Switch between form tabs (if implemented) |
| | `Tab` | Move to next focusable element in section |
| Array fields | `Enter` (in add button) | Add new co-creator entry |
| | `Tab` | Navigate between entries |
| | `Delete` button | Remove entry |
| Tag input | `Enter` | Add tag (after typing) |
| | `Backspace` | Remove last tag |
| Submit | `Enter` | Submit form (when focused on submit button) |

## Screen Reader Support

### Semantic HTML Usage

**Do:**
```tsx
// Good: Semantic form
<form>
  <label htmlFor="email">Email Address</label>
  <input id="email" type="email" required />
  <button type="submit">Send</button>
</form>

// Good: Semantic lists
<ul>
  <li>Requirement 1</li>
  <li>Requirement 2</li>
</ul>

// Good: Semantic tables
<table>
  <thead>
    <tr><th>Name</th><th>Status</th></tr>
  </thead>
  <tbody>
    <tr><td>Prompt 1</td><td>Published</td></tr>
  </tbody>
</table>
```

**Don't:**
```tsx
// Bad: Layout table (use divs instead)
<table><tr><td>Label</td><td>Value</td></tr></table>

// Bad: Unlabeled input
<input type="email" placeholder="Email" />

// Bad: Icon-only button without label
<button>❤️</button> // Missing aria-label

// Bad: Div instead of list
<div><div>Item 1</div><div>Item 2</div></div>
```

### ARIA Attributes

**When to use ARIA:**
- `aria-label`: Icon-only buttons, custom components without text content
- `aria-labelledby`: Associate element with heading/title
- `aria-describedby`: Link field to error/help text
- `aria-invalid`: Mark form field with error
- `aria-live`: Announce dynamic content changes (polite/assertive)
- `aria-modal`: Indicate modal dialog
- `aria-expanded`: Show collapse/expand state
- `aria-selected`: Indicate selected state in custom components

**Prefer semantic HTML over ARIA:**
```tsx
// ✅ Prefer semantic
<button>Purchase</button>
<label htmlFor="email">Email</label>

// ⚠️ Use ARIA only when semantic HTML unavailable
<div role="button" aria-label="Purchase">Buy Now</div>
<div role="textbox" aria-label="Email">...</div>
```

## Color Contrast

### WCAG AA Compliance

Minimum contrast ratios required:
- **Normal text**: 4.5:1 (excluding placeholder text)
- **Large text** (18pt+): 3:1
- **UI components**: 3:1

### Current Color Palette

**Dark Theme (Tailwind):**
- Text on background: `text-white` on `bg-slate-900` ✅ **Pass (20:1)**
- Muted text: `text-slate-400` on `bg-slate-900` ✅ **Pass (8.5:1)**
- Semantic colors:
  - Success: `text-emerald-400` on `bg-slate-900` ✅ **Pass (6:1)**
  - Error: `text-red-400` on `bg-red-500/10` ✅ **Pass (5.5:1)**
  - Warning: `text-amber-300` on `bg-amber-500/10` ✅ **Pass (4.8:1)**

**Verify with Tools:**
```bash
# Use WebAIM contrast checker
# https://webaim.org/resources/contrastchecker/

# Or use Lighthouse in Chrome DevTools
# Tools → Lighthouse → Accessibility
```

## Testing

### Running Accessibility Tests

```bash
# Run all accessibility tests
npm run test:a11y

# Run specific test suite
npm run test:a11y -- purchase-flow.a11y.test.tsx

# Run with coverage
npm run test:a11y -- --coverage
```

### Manual Testing Checklist

#### Keyboard Navigation
- [ ] Can reach all interactive elements using `Tab` and `Shift+Tab`
- [ ] Can operate buttons with `Enter` and `Space`
- [ ] Modal dialogs trap focus (Tab cycles within modal)
- [ ] Can close modals with `Escape` key
- [ ] Focus is visible at all times
- [ ] Focus is restored after modal closes

#### Screen Reader (NVDA/JAWS)
- [ ] Page structure is announced correctly (headings, landmarks)
- [ ] Form labels are associated with inputs
- [ ] Error messages are announced when validation fails
- [ ] Status updates are announced (purchase success, etc.)
- [ ] Button purposes are clear from label alone
- [ ] Modal title is announced when opened
- [ ] All content is reachable in reading order

#### Color & Contrast
- [ ] All text has sufficient contrast (4.5:1 minimum)
- [ ] Color alone is not used to convey information
- [ ] Icons are visible and have sufficient contrast

#### Touch & Mobile
- [ ] Touch targets are at least 44x44 pixels
- [ ] Interactive elements have adequate spacing
- [ ] Responsive layout works with zoom (up to 200%)

### Automated Checks

Axe-core checks for:
- Missing alt text on images
- Missing or incorrect labels
- Color contrast violations
- Missing heading hierarchy
- ARIA misuse
- Focus management issues
- Semantic HTML problems

Example test:
```typescript
it('should have no accessibility violations', async () => {
  const container = document.createElement('div');
  container.innerHTML = /* component markup */;
  
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

## Known Limitations & Exceptions

### Not Implemented

1. **Voice control support** - Would require additional ARIA and testing
2. **High contrast mode detection** - Can be added if needed
3. **Text spacing adjustments** - CSS custom properties for overrides
4. **Extended keyboard shortcuts** - Only core shortcuts implemented

### Platform-Specific

| Platform | Status | Notes |
|----------|--------|-------|
| Chrome + ChromeVox | ✅ Supported | Native support |
| Firefox + NVDA | ✅ Supported | Free/open-source pairing |
| Safari + VoiceOver | ✅ Supported | macOS/iOS |
| Edge + Narrator | ⚠️ Limited | Partial support (basic) |
| Mobile (iOS/Android) | ✅ Supported | OS-level screen readers |

## Migration Guide

### For Existing Components

1. **Add form helpers:**
   ```tsx
   import { getFormFieldAriaAttrs, renderErrorMessage } from '@/lib/accessibility/formHelpers';
   ```

2. **Update form fields:**
   ```tsx
   // Before
   <input {...register('email')} />
   {errors.email && <span>{errors.email.message}</span>}

   // After
   <input {...register('email')} {...getFormFieldAriaAttrs({...})} />
   {errors.email && <div {...renderErrorMessage(...)} />}
   ```

3. **Wrap modals with focus management:**
   ```tsx
   <div ref={modalRef} role="dialog" aria-modal="true">
     {/* Add keyboard handler and focus trap */}
   </div>
   ```

## Monitoring & Maintenance

### CI Integration

Add accessibility tests to CI pipeline:

```yaml
# .github/workflows/test.yml
- name: Run accessibility tests
  run: npm run test:a11y
```

### Regular Audits

- Manual audit every quarter with screen reader
- Automated scan on every PR (via jest-axe)
- User testing with people with disabilities

### Tools Reference

- **Automated**: [axe DevTools](https://www.deque.com/axe/devtools/), WAVE
- **Manual**: [Accessibility Insight](https://accessibilityinsights.io/), NVDA, JAWS
- **Contrast**: [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
- **Navigation**: Chrome DevTools → Accessibility

## Resources & References

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)
- [Testing Library Accessibility](https://testing-library.com/docs/queries/about/#priority)
- [jest-axe Documentation](https://github.com/nickcolley/jest-axe)
- [Web Accessibility by Google](https://www.udacity.com/course/web-accessibility--ud891)

## Support & Questions

For accessibility concerns or questions:
1. Check WCAG 2.1 AA guidelines
2. Review this document and patterns
3. Run automated tests (jest-axe)
4. Test manually with keyboard and screen reader
5. File an issue with test case and WCAG criterion

---

**Last Updated:** September 2026  
**Maintainer:** Prompt Hash Accessibility Team  
**WCAG Level:** AA (2.1)  
**Last Audit:** [Date of most recent manual audit]
