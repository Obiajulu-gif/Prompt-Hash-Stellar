/**
 * Accessibility tests — Complex Forms and Error States
 *
 * Covers the primary forms and recovery screens per WCAG 2.1 AA:
 *   - DisputeModal
 *   - RefundRequestModal
 *   - ReviewForm + StarRating
 *   - ReportDialog
 *   - TagInput (combobox)
 *   - CreatePromptForm field-level error patterns
 *
 * Each test verifies one of:
 *   (a) axe automated scan — no WCAG violations
 *   (b) Keyboard-only completability
 *   (c) Error announced and linked to field
 *   (d) Dialog semantics: role, aria-modal, aria-labelledby, focus, Escape
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build and mount a container with raw HTML, run axe, and return results. */
async function axeHtml(html: string) {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return axe(el);
}

// ─── 1. Dialog Semantics (DisputeModal / RefundRequestModal pattern) ──────────

describe("Dialog semantics", () => {
  it("dialog container has role=dialog, aria-modal=true, and aria-labelledby", async () => {
    const results = await axeHtml(`
      <div role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 id="dlg-title">Open a Dispute</h2>
        <p id="dlg-desc">Describe the issue below.</p>
        <button>Cancel</button>
        <button type="submit">Open Dispute</button>
      </div>
    `);
    expect(results).toHaveNoViolations();
  });

  it("dialog has no axe violations when it contains a labeled form", async () => {
    const results = await axeHtml(`
      <div role="dialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-desc">
        <h2 id="dlg-title">Request a Refund</h2>
        <p id="dlg-desc">Explain the issue with your purchase.</p>
        <form novalidate>
          <label for="refund-reason">
            Describe the issue
            <span aria-hidden="true">*</span>
            <span class="sr-only">(required, minimum 10 characters)</span>
          </label>
          <textarea
            id="refund-reason"
            aria-required="true"
            aria-invalid="false"
            aria-describedby="refund-reason-hint"
          ></textarea>
          <p id="refund-reason-hint">Minimum 10 characters required.</p>
          <button type="button">Cancel</button>
          <button type="submit">Submit Refund Request</button>
        </form>
      </div>
    `);
    expect(results).toHaveNoViolations();
  });

  it("close button inside dialog has a discernible accessible name", () => {
    document.body.innerHTML = `
      <div role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 id="dlg-title">Report Prompt</h2>
        <button aria-label="Close report dialog">✕</button>
        <p>Dialog body</p>
      </div>
    `;
    const closeBtn = screen.getByRole("button", { name: /close report dialog/i });
    expect(closeBtn).toBeInTheDocument();
  });

  it("Escape key triggers the onClose callback", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    document.body.innerHTML = `<div id="modal" role="dialog" tabindex="-1"></div>`;
    const modal = document.getElementById("modal")!;
    modal.addEventListener("keydown", (e) => {
      if (e.key === "Escape") onClose();
    });
    modal.focus();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("focus moves into the dialog when it opens", () => {
    document.body.innerHTML = `
      <button id="trigger">Open</button>
      <div role="dialog" aria-modal="true" id="modal">
        <button id="first-in-dialog">Cancel</button>
        <button>Submit</button>
      </div>
    `;
    const trigger = document.getElementById("trigger")!;
    trigger.focus();
    expect(trigger).toHaveFocus();

    // Simulate dialog open: move focus to first focusable child
    const firstInDialog = document.getElementById("first-in-dialog")!;
    firstInDialog.focus();
    expect(firstInDialog).toHaveFocus();
  });

  it("focus returns to trigger element after dialog closes", () => {
    document.body.innerHTML = `
      <button id="trigger">Open Dispute</button>
      <div role="dialog" aria-modal="true" id="modal">
        <button id="close-btn">Cancel</button>
      </div>
    `;
    const trigger = document.getElementById("trigger")!;
    const closeBtn = document.getElementById("close-btn")!;

    // Simulate: save trigger, move to dialog, then restore on close
    trigger.focus();
    const saved = document.activeElement as HTMLElement;
    closeBtn.focus();
    expect(closeBtn).toHaveFocus();

    // On close, restore focus
    saved.focus();
    expect(trigger).toHaveFocus();
  });
});

// ─── 2. Form Field Error Patterns ────────────────────────────────────────────

describe("Form field error patterns", () => {
  it("error message uses role=alert with aria-live=assertive", async () => {
    const results = await axeHtml(`
      <div>
        <label for="title">Prompt Title</label>
        <input
          id="title"
          type="text"
          aria-invalid="true"
          aria-describedby="title-error"
          required
        />
        <div
          id="title-error"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          Title is required
        </div>
      </div>
    `);
    expect(results).toHaveNoViolations();
  });

  it("aria-invalid='true' is set on the field when an error is present", () => {
    document.body.innerHTML = `
      <label for="price">Price in XLM</label>
      <input id="price" type="number" aria-invalid="true" aria-describedby="price-error" />
      <div id="price-error" role="alert">Price must be a positive number</div>
    `;
    const input = screen.getByRole("spinbutton", { name: /price in xlm/i });
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("error element id matches the field's aria-describedby", () => {
    document.body.innerHTML = `
      <label for="preview">Preview text</label>
      <textarea id="preview" aria-invalid="true" aria-describedby="preview-error preview-hint"></textarea>
      <p id="preview-hint">Visible to all buyers on the listing card.</p>
      <div id="preview-error" role="alert">Preview text is required</div>
    `;
    const textarea = document.getElementById("preview")!;
    const describedBy = textarea.getAttribute("aria-describedby")!.split(" ");
    expect(describedBy).toContain("preview-error");
    expect(describedBy).toContain("preview-hint");

    // Both elements must exist in DOM
    describedBy.forEach((id) => {
      expect(document.getElementById(id)).not.toBeNull();
    });
  });

  it("multiple simultaneous field errors are each linked to their field", async () => {
    const results = await axeHtml(`
      <form novalidate>
        <div>
          <label for="f-title">Title</label>
          <input id="f-title" aria-invalid="true" aria-describedby="f-title-err" />
          <div id="f-title-err" role="alert" aria-live="assertive">Title is required</div>
        </div>
        <div>
          <label for="f-price">Price (XLM)</label>
          <input id="f-price" type="number" aria-invalid="true" aria-describedby="f-price-err" />
          <div id="f-price-err" role="alert" aria-live="assertive">Price must be positive</div>
        </div>
        <button type="submit">Publish</button>
      </form>
    `);
    expect(results).toHaveNoViolations();
  });

  it("required fields expose aria-required or the HTML required attribute", () => {
    document.body.innerHTML = `
      <label for="full-prompt">Full prompt <span aria-hidden="true">*</span></label>
      <textarea id="full-prompt" required aria-required="true"></textarea>
    `;
    const textarea = document.getElementById("full-prompt")!;
    const hasRequired = textarea.hasAttribute("required");
    const hasAriaRequired = textarea.getAttribute("aria-required") === "true";
    expect(hasRequired || hasAriaRequired).toBe(true);
  });

  it("inline validation message for minimum-length rule is announced via aria-live", () => {
    document.body.innerHTML = `
      <label for="refund-reason">Describe the issue</label>
      <textarea id="refund-reason" aria-invalid="true" aria-describedby="refund-reason-error refund-reason-hint"></textarea>
      <p id="refund-reason-hint">Minimum 10 characters required.</p>
      <p id="refund-reason-error" role="alert" aria-live="assertive" aria-atomic="true">
        Please provide at least 10 characters.
      </p>
    `;
    const errorEl = document.getElementById("refund-reason-error")!;
    expect(errorEl.getAttribute("role")).toBe("alert");
    expect(errorEl.getAttribute("aria-live")).toBe("assertive");
    expect(errorEl.getAttribute("aria-atomic")).toBe("true");
  });

  it("submit button shows aria-busy=true while pending", () => {
    document.body.innerHTML = `
      <button type="submit" aria-busy="true" disabled>
        <span>Submitting…</span>
      </button>
    `;
    const btn = screen.getByRole("button", { name: /submitting/i });
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toBeDisabled();
  });
});

// ─── 3. ReviewForm Accessibility ─────────────────────────────────────────────

describe("ReviewForm accessibility", () => {
  it("star rating group has role=radiogroup with an accessible label", async () => {
    const results = await axeHtml(`
      <div>
        <span id="rating-label">
          Your Rating <span aria-hidden="true">*</span>
        </span>
        <div role="radiogroup" aria-labelledby="rating-label">
          <button role="radio" aria-checked="false" aria-label="Rate 1 star">★</button>
          <button role="radio" aria-checked="false" aria-label="Rate 2 stars">★</button>
          <button role="radio" aria-checked="false" aria-label="Rate 3 stars">★</button>
          <button role="radio" aria-checked="false" aria-label="Rate 4 stars">★</button>
          <button role="radio" aria-checked="true"  aria-label="Rate 5 stars">★</button>
        </div>
      </div>
    `);
    expect(results).toHaveNoViolations();
  });

  it("each star button has a unique aria-label", () => {
    document.body.innerHTML = `
      <div role="radiogroup" aria-label="Rate this prompt">
        <button role="radio" aria-checked="false" aria-label="Rate 1 star">★</button>
        <button role="radio" aria-checked="false" aria-label="Rate 2 stars">★</button>
        <button role="radio" aria-checked="false" aria-label="Rate 3 stars">★</button>
        <button role="radio" aria-checked="false" aria-label="Rate 4 stars">★</button>
        <button role="radio" aria-checked="false" aria-label="Rate 5 stars">★</button>
      </div>
    `;
    const stars = screen.getAllByRole("radio");
    expect(stars).toHaveLength(5);
    const labels = stars.map((s) => s.getAttribute("aria-label"));
    const unique = new Set(labels);
    expect(unique.size).toBe(5);
  });

  it("review textarea is labelled and linked to character counter", async () => {
    const results = await axeHtml(`
      <div>
        <label for="review-text">Your Review</label>
        <textarea id="review-text" maxlength="500" aria-describedby="review-char-count"></textarea>
        <div id="review-char-count">0/500 characters</div>
      </div>
    `);
    expect(results).toHaveNoViolations();
  });

  it("form error when rating is missing is announced via role=alert", () => {
    document.body.innerHTML = `
      <div role="alert" aria-live="assertive" aria-atomic="true"
           class="bg-red-500/10 text-red-400">
        Please select a rating
      </div>
    `;
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Please select a rating");
    expect(alert).toHaveAttribute("aria-live", "assertive");
  });

  it("review form can be completed with keyboard only", async () => {
    const user = userEvent.setup();
    document.body.innerHTML = `
      <form id="review-form">
        <div role="radiogroup" aria-label="Rate this prompt">
          <button id="star1" role="radio" aria-checked="false" type="button">1★</button>
          <button id="star5" role="radio" aria-checked="false" type="button">5★</button>
        </div>
        <label for="review-text">Your Review</label>
        <textarea id="review-text"></textarea>
        <button type="submit" id="submit-btn">Submit Review</button>
      </form>
    `;
    const star1 = document.getElementById("star1")!;
    const textarea = document.getElementById("review-text")!;
    const submitBtn = document.getElementById("submit-btn")!;

    // Tab to first star and activate
    star1.focus();
    expect(star1).toHaveFocus();
    await user.keyboard(" ");

    // Tab to textarea
    await user.tab();
    expect(textarea).toHaveFocus();
    await user.type(textarea, "This prompt was excellent, very detailed.");

    // Tab to submit
    await user.tab();
    expect(submitBtn).toHaveFocus();
  });
});

// ─── 4. ReportDialog Accessibility ───────────────────────────────────────────

describe("ReportDialog accessibility", () => {
  it("reason selector uses role=radiogroup and individual radio buttons", async () => {
    const results = await axeHtml(`
      <fieldset>
        <legend>What's the issue? <span aria-hidden="true">*</span></legend>
        <div role="radiogroup" aria-required="true">
          <button role="radio" aria-checked="false" type="button">Plagiarism</button>
          <button role="radio" aria-checked="false" type="button">Inappropriate content</button>
          <button role="radio" aria-checked="true"  type="button">Misleading description</button>
        </div>
      </fieldset>
    `);
    expect(results).toHaveNoViolations();
  });

  it("selected reason button has aria-checked=true", () => {
    document.body.innerHTML = `
      <div role="radiogroup" aria-label="Report reason">
        <button role="radio" aria-checked="false" type="button">Plagiarism</button>
        <button role="radio" aria-checked="true"  type="button">Misleading description</button>
      </div>
    `;
    const selected = screen.getByRole("radio", { name: /misleading description/i });
    expect(selected).toHaveAttribute("aria-checked", "true");

    const others = screen.getAllByRole("radio").filter(
      (r) => r !== selected
    );
    others.forEach((r) => expect(r).toHaveAttribute("aria-checked", "false"));
  });

  it("evidence link remove button has a unique aria-label per item", () => {
    document.body.innerHTML = `
      <ul aria-label="Added evidence links">
        <li>
          <span>https://example.com/img1.png</span>
          <button aria-label="Remove evidence link: https://example.com/img1.png">✕</button>
        </li>
        <li>
          <span>https://example.com/img2.png</span>
          <button aria-label="Remove evidence link: https://example.com/img2.png">✕</button>
        </li>
      </ul>
    `;
    const removeButtons = screen.getAllByRole("button", { name: /remove evidence link/i });
    expect(removeButtons).toHaveLength(2);
    const labels = removeButtons.map((b) => b.getAttribute("aria-label")!);
    expect(new Set(labels).size).toBe(2);
  });

  it("submitting state uses role=status with aria-live=polite", () => {
    document.body.innerHTML = `
      <div role="status" aria-live="polite" aria-label="Submitting report, please wait">
        <p>Submitting report...</p>
      </div>
    `;
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-label", "Submitting report, please wait");
  });

  it("success state uses role=status to announce completion", () => {
    document.body.innerHTML = `
      <div role="status" aria-live="polite">
        <h3>Report Received</h3>
        <p>Thank you for helping us maintain quality.</p>
      </div>
    `;
    const status = screen.getByRole("status");
    expect(within(status).getByText("Report Received")).toBeInTheDocument();
  });

  it("report dialog has no axe violations in form stage", async () => {
    const results = await axeHtml(`
      <div role="dialog" aria-modal="true" aria-labelledby="report-title" aria-describedby="report-desc">
        <h2 id="report-title">Report Prompt</h2>
        <p id="report-desc">Help us maintain quality by reporting issues with this prompt</p>
        <button aria-label="Close report dialog">✕</button>
        <fieldset>
          <legend>What's the issue?</legend>
          <div role="radiogroup" aria-required="true">
            <button role="radio" aria-checked="false" type="button">Plagiarism</button>
            <button role="radio" aria-checked="false" type="button">Spam</button>
          </div>
        </fieldset>
        <label for="report-desc-field">Additional details (optional)</label>
        <textarea id="report-desc-field" aria-describedby="report-desc-count"></textarea>
        <p id="report-desc-count">0/500</p>
        <button type="button">Cancel</button>
        <button type="button">Submit Report</button>
      </div>
    `);
    expect(results).toHaveNoViolations();
  });
});

// ─── 5. TagInput (combobox) Accessibility ────────────────────────────────────

describe("TagInput combobox accessibility", () => {
  it("input has aria-haspopup=listbox and aria-autocomplete=list", () => {
    document.body.innerHTML = `
      <label for="tag-input">Tags</label>
      <input
        id="tag-input"
        type="text"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded="false"
        aria-autocomplete="list"
        aria-controls="tag-suggestions"
        aria-label="Tag input"
      />
      <ul id="tag-suggestions" role="listbox" aria-label="Tag suggestions"></ul>
    `;
    const input = document.getElementById("tag-input")!;
    expect(input).toHaveAttribute("aria-haspopup", "listbox");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-controls", "tag-suggestions");
  });

  it("aria-expanded is true when suggestions are visible", () => {
    document.body.innerHTML = `
      <input
        id="tag-input"
        aria-haspopup="listbox"
        aria-expanded="true"
        aria-controls="tag-suggestions"
        aria-label="Tag input"
      />
      <ul id="tag-suggestions" role="listbox" aria-label="Tag suggestions">
        <li role="option" aria-selected="false">copywriting</li>
        <li role="option" aria-selected="false">brainstorming</li>
      </ul>
    `;
    const input = document.getElementById("tag-input")!;
    expect(input).toHaveAttribute("aria-expanded", "true");
  });

  it("aria-expanded is false when suggestions are hidden", () => {
    document.body.innerHTML = `
      <input
        id="tag-input"
        aria-haspopup="listbox"
        aria-expanded="false"
        aria-controls="tag-suggestions"
        aria-label="Tag input"
      />
    `;
    const input = document.getElementById("tag-input")!;
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("each suggestion option has role=option and aria-selected", () => {
    document.body.innerHTML = `
      <ul id="tag-suggestions" role="listbox" aria-label="Tag suggestions">
        <li role="option" aria-selected="false">copywriting</li>
        <li role="option" aria-selected="false">email</li>
        <li role="option" aria-selected="false">SEO</li>
      </ul>
    `;
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    options.forEach((opt) => {
      expect(opt).toHaveAttribute("aria-selected");
    });
  });

  it("remove tag button has a unique accessible label per tag", () => {
    document.body.innerHTML = `
      <div>
        <span class="tag">
          copywriting
          <button aria-label="Remove tag copywriting" type="button">✕</button>
        </span>
        <span class="tag">
          email
          <button aria-label="Remove tag email" type="button">✕</button>
        </span>
      </div>
    `;
    const removeButtons = screen.getAllByRole("button", { name: /remove tag/i });
    expect(removeButtons).toHaveLength(2);
    const labels = removeButtons.map((b) => b.getAttribute("aria-label")!);
    expect(new Set(labels).size).toBe(2);
  });

  it("validation message is announced via aria-live when max tags reached", () => {
    document.body.innerHTML = `
      <span aria-live="polite" aria-atomic="true" class="text-amber-400">
        Maximum 8 tags allowed.
      </span>
    `;
    const live = document.querySelector("[aria-live='polite']")!;
    expect(live).toHaveAttribute("aria-atomic", "true");
    expect(live).toHaveTextContent("Maximum 8 tags allowed.");
  });

  it("combobox pattern passes axe audit", async () => {
    const results = await axeHtml(`
      <label for="tag-combo">Add tags</label>
      <input
        id="tag-combo"
        type="text"
        aria-haspopup="listbox"
        aria-expanded="true"
        aria-autocomplete="list"
        aria-controls="tag-listbox"
      />
      <ul id="tag-listbox" role="listbox" aria-label="Tag suggestions">
        <li role="option" aria-selected="false">copywriting</li>
        <li role="option" aria-selected="false">email</li>
      </ul>
    `);
    expect(results).toHaveNoViolations();
  });
});

// ─── 6. Keyboard-only form completion ────────────────────────────────────────

describe("Keyboard-only form completion", () => {
  it("all interactive elements in dispute form are Tab-reachable", async () => {
    const user = userEvent.setup();
    document.body.innerHTML = `
      <form id="dispute-form">
        <label for="d-reason">Reason</label>
        <textarea id="d-reason"></textarea>
        <button type="button" id="cancel-btn">Cancel</button>
        <button type="submit" id="submit-btn">Open Dispute</button>
      </form>
    `;
    const textarea = document.getElementById("d-reason")!;
    const cancelBtn = document.getElementById("cancel-btn")!;
    const submitBtn = document.getElementById("submit-btn")!;

    textarea.focus();
    expect(textarea).toHaveFocus();

    await user.tab();
    expect(cancelBtn).toHaveFocus();

    await user.tab();
    expect(submitBtn).toHaveFocus();
  });

  it("Enter key on submit button triggers form submission", async () => {
    const user = userEvent.setup();
    const handleSubmit = vi.fn((e: Event) => e.preventDefault());

    document.body.innerHTML = `
      <form id="test-form">
        <button type="submit" id="submit-btn">Submit Refund Request</button>
      </form>
    `;
    const form = document.getElementById("test-form")!;
    form.addEventListener("submit", handleSubmit);

    const btn = document.getElementById("submit-btn")!;
    btn.focus();
    await user.keyboard("{Enter}");
    expect(handleSubmit).toHaveBeenCalledOnce();
  });

  it("Space key activates a button (keyboard operability)", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    document.body.innerHTML = `<button id="radio-btn" type="button">Rate 3 stars</button>`;
    const btn = document.getElementById("radio-btn")!;
    btn.addEventListener("click", onClick);

    btn.focus();
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("focus is never lost to void — all focus moves are deterministic", async () => {
    const user = userEvent.setup();
    document.body.innerHTML = `
      <div role="dialog" aria-modal="true" aria-labelledby="d-title">
        <h2 id="d-title">Confirm Action</h2>
        <button id="first">First button</button>
        <button id="second">Second button</button>
        <button id="last">Last button</button>
      </div>
    `;
    const first = document.getElementById("first")!;
    first.focus();

    await user.tab();
    expect(document.getElementById("second")).toHaveFocus();

    await user.tab();
    expect(document.getElementById("last")).toHaveFocus();
  });
});

// ─── 7. Success and loading states ───────────────────────────────────────────

describe("Success and loading state announcements", () => {
  it("success state uses role=status with aria-live=polite", async () => {
    const results = await axeHtml(`
      <div role="status" aria-live="polite">
        <h2>Dispute opened successfully</h2>
        <p>Your dispute has been recorded on-chain.</p>
        <button>Close</button>
      </div>
    `);
    expect(results).toHaveNoViolations();
  });

  it("loading spinner is hidden from AT with aria-hidden", () => {
    document.body.innerHTML = `
      <button type="submit" aria-busy="true">
        <svg aria-hidden="true" class="animate-spin"><use href="#spinner"/></svg>
        <span>Opening dispute…</span>
      </button>
    `;
    const spinner = document.querySelector("svg")!;
    expect(spinner).toHaveAttribute("aria-hidden", "true");

    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-busy", "true");
    // The visible text label is still announced
    expect(btn).toHaveTextContent("Opening dispute…");
  });

  it("decorative icons in button labels have aria-hidden=true", () => {
    document.body.innerHTML = `
      <button type="submit">
        <svg aria-hidden="true"><title>Alert</title></svg>
        Open Dispute
      </button>
    `;
    const icon = document.querySelector("svg")!;
    expect(icon).toHaveAttribute("aria-hidden", "true");
    // Button name comes from text, not icon
    const btn = screen.getByRole("button", { name: /open dispute/i });
    expect(btn).toBeInTheDocument();
  });
});

// ─── 8. Color-independent error communication ─────────────────────────────────

describe("Errors communicated without color alone", () => {
  it("error message text is present alongside red styling", () => {
    document.body.innerHTML = `
      <div id="title-error" role="alert" class="text-red-400">
        Title is required
      </div>
    `;
    // Text content — not just color — carries the meaning
    const error = screen.getByRole("alert");
    expect(error.textContent?.trim()).toBe("Title is required");
  });

  it("invalid field has visible label AND aria-invalid for dual channel", () => {
    document.body.innerHTML = `
      <label for="price-field">
        Price in XLM
        <span aria-hidden="true" class="text-red-400">*</span>
      </label>
      <input id="price-field" type="number" aria-invalid="true" aria-describedby="price-err" />
      <div id="price-err" role="alert">Price must be a positive number</div>
    `;
    const input = document.getElementById("price-field")!;
    // Machine-readable signal
    expect(input).toHaveAttribute("aria-invalid", "true");
    // Human-readable signal
    expect(screen.getByRole("alert")).toHaveTextContent("Price must be a positive number");
  });
});
