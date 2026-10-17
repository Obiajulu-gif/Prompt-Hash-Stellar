/**
 * Accessibility regression: dense forms and error recovery.
 *
 * Covers keyboard order, labelling, error association/announcement, focus
 * movement to the error summary and back to fields, and recovery.
 */

import { useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  announceStatus,
  getFocusableElements,
  getFormFieldAriaAttrs,
  renderErrorMessage,
  renderLabel,
} from "@/lib/accessibility/formHelpers";
import { ErrorSummary, type ErrorSummaryItem } from "@/components/accessibility/ErrorSummary";
import { installLayoutShim, tabStops } from "./helpers";

// ─── Harness: a dense listing form built from the shared helpers ─────────────

type Values = Record<string, string | boolean>;

const FIELDS = [
  { id: "title", label: "Title", help: "Up to 80 characters" },
  { id: "email", label: "Contact email" },
  { id: "price", label: "Price (XLM)" },
  { id: "category", label: "Category" },
  { id: "tags", label: "Tags" },
  { id: "description", label: "Description" },
] as const;

function validate(v: Values): ErrorSummaryItem[] {
  const errors: ErrorSummaryItem[] = [];
  if (!String(v.title ?? "").trim()) errors.push({ fieldId: "title", message: "Title is required" });
  if (!/^\S+@\S+\.\S+$/.test(String(v.email ?? "")))
    errors.push({ fieldId: "email", message: "Enter a valid email address" });
  if (!(Number(v.price) > 0)) errors.push({ fieldId: "price", message: "Price must be greater than 0" });
  if (String(v.description ?? "").length < 20)
    errors.push({ fieldId: "description", message: "Description needs at least 20 characters" });
  if (!v.terms) errors.push({ fieldId: "terms", message: "You must accept the license terms" });
  return errors;
}

function DenseForm() {
  const [values, setValues] = useState<Values>({ category: "writing", license: "personal" });
  const [errors, setErrors] = useState<ErrorSummaryItem[]>([]);
  const [saved, setSaved] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const errorFor = (id: string) => errors.find((e) => e.fieldId === id)?.message;
  const set = (id: string, value: string | boolean) => {
    const next = { ...values, [id]: value };
    setValues(next);
    // Re-validate once errors are showing so fixed fields recover immediately.
    if (errors.length > 0) setErrors(validate(next));
  };

  function field(id: (typeof FIELDS)[number]["id"], label: string, help?: string) {
    const error = errorFor(id);
    const attrs = getFormFieldAriaAttrs({
      fieldId: id,
      hasError: !!error,
      errorMessage: error,
      helpTextId: help ? `${id}-help` : undefined,
      isRequired: id !== "tags" && id !== "category",
    });
    const common = {
      id,
      ...attrs,
      value: String(values[id] ?? ""),
      onChange: (e: { target: { value: string } }) => set(id, e.target.value),
    };
    return (
      <div key={id}>
        <label {...renderLabel(id, label)}>{label}</label>
        {id === "description" ? (
          <textarea {...common} />
        ) : id === "category" ? (
          <select {...common}>
            <option value="writing">Writing</option>
            <option value="code">Code</option>
          </select>
        ) : (
          <input {...common} type={id === "price" ? "number" : "text"} />
        )}
        {help && <p id={`${id}-help`}>{help}</p>}
        {error && <p {...renderErrorMessage(id, error)}>Error: {error}</p>}
      </div>
    );
  }

  return (
    <form
      noValidate
      aria-label="Create listing"
      onSubmit={(e) => {
        e.preventDefault();
        const found = validate(values);
        setErrors(found);
        setAttempts((n) => n + 1);
        if (found.length === 0) {
          setSaved(true);
          announceStatus("Listing saved", "polite");
        }
      }}
    >
      <ErrorSummary errors={errors} focusToken={attempts} />
      {FIELDS.map((f) => field(f.id, f.label, "help" in f ? f.help : undefined))}
      <fieldset>
        <legend>License</legend>
        <label>
          <input
            type="radio"
            name="license"
            checked={values.license === "personal"}
            onChange={() => set("license", "personal")}
          />
          Personal
        </label>
        <label>
          <input
            type="radio"
            name="license"
            checked={values.license === "commercial"}
            onChange={() => set("license", "commercial")}
          />
          Commercial
        </label>
      </fieldset>
      <div>
        <input
          id="terms"
          type="checkbox"
          checked={!!values.terms}
          aria-invalid={!!errorFor("terms")}
          aria-describedby={errorFor("terms") ? "terms-error" : undefined}
          onChange={(e) => set("terms", e.target.checked)}
        />
        <label htmlFor="terms">I accept the license terms</label>
        {errorFor("terms") && <p {...renderErrorMessage("terms", "")}>Error: {errorFor("terms")}</p>}
      </div>
      <button type="submit">Publish</button>
      {saved && <p>Saved</p>}
    </form>
  );
}

let restoreLayout: () => void;
beforeEach(() => {
  restoreLayout = installLayoutShim();
});
afterEach(() => restoreLayout());

describe("dense form: structure and keyboard", () => {
  it("gives every control an accessible name", () => {
    render(<DenseForm />);
    for (const label of ["Title", "Contact email", "Price (XLM)", "Category", "Tags", "Description"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("checkbox", { name: "I accept the license terms" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
  });

  it("groups related controls with a fieldset legend", () => {
    render(<DenseForm />);
    const group = screen.getByRole("group", { name: "License" });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
  });

  it("links help text to its field via aria-describedby", () => {
    render(<DenseForm />);
    expect(screen.getByLabelText("Title")).toHaveAccessibleDescription("Up to 80 characters");
  });

  it("uses no positive tabindex and visits controls in DOM order", async () => {
    const user = userEvent.setup();
    render(<DenseForm />);
    expect(document.querySelector('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')).toBeNull();

    const nameOf = (el: HTMLElement) => el.id || el.getAttribute("name") || el.textContent;
    const expected = tabStops(document.body).map(nameOf);
    const visited: (string | null)[] = [];
    // Radios in one group are a single tab stop, so walk until the last control.
    for (let i = 0; i < expected.length; i++) {
      await user.tab();
      const name = nameOf(document.activeElement as HTMLElement);
      visited.push(name);
      if (name === "Publish") break;
    }
    expect(visited[visited.length - 1]).toBe("Publish");
    let cursor = 0;
    for (const name of visited) {
      const at = expected.indexOf(name, cursor);
      expect(at).toBeGreaterThanOrEqual(cursor);
      cursor = at;
    }
    // The only skipped stop is the unchecked radio.
    expect(expected.length - visited.length).toBeLessThanOrEqual(1);
  });

  it("is completable by keyboard alone, with no keyboard trap", async () => {
    const user = userEvent.setup();
    render(<DenseForm />);
    await user.click(screen.getByLabelText("Title"));
    await user.keyboard("My prompt");
    await user.tab();
    await user.keyboard("me@example.com");
    await user.tab();
    await user.keyboard("12");
    await user.tab(); // category select
    await user.tab(); // tags
    await user.tab(); // description
    await user.keyboard("A sufficiently long description.");
    await user.tab(); // license radio group
    await user.tab(); // terms
    await user.keyboard(" ");
    await user.tab(); // publish
    expect(screen.getByRole("button", { name: "Publish" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });
});

describe("dense form: error announcement and recovery", () => {
  async function submitEmpty() {
    const user = userEvent.setup();
    render(<DenseForm />);
    await user.click(screen.getByRole("button", { name: "Publish" }));
    return user;
  }

  it("moves focus to a role=alert summary that counts the errors", async () => {
    await submitEmpty();
    const summary = screen.getByRole("alert", { name: /please fix the following \(5 errors\)/i });
    expect(summary).toHaveFocus();
  });

  it("flags each invalid field and wires its error through aria-describedby", async () => {
    await submitEmpty();
    for (const label of ["Title", "Contact email", "Price (XLM)", "Description"]) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute("aria-invalid", "true");
      const describedBy = input.getAttribute("aria-describedby")!;
      expect(describedBy).toContain(`${input.id}-error`);
      const error = document.getElementById(`${input.id}-error`)!;
      expect(error).toHaveAttribute("role", "alert");
      expect(error).toHaveAttribute("aria-live", "assertive");
    }
  });

  it("does not rely on colour alone: error text carries an 'Error:' prefix", async () => {
    await submitEmpty();
    expect(document.getElementById("title-error")).toHaveTextContent(/^Error: Title is required$/);
  });

  it("moves focus to the field when its summary link is activated by keyboard", async () => {
    const user = await submitEmpty();
    const link = screen.getByRole("link", { name: "Enter a valid email address" });
    link.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("Contact email")).toHaveFocus();
  });

  it("clears invalid state and the summary entry as each field is fixed", async () => {
    const user = await submitEmpty();
    await user.type(screen.getByLabelText("Title"), "Prompt");
    expect(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByLabelText("Title")).not.toHaveAttribute("aria-describedby", expect.stringContaining("error"));
    expect(screen.queryByRole("link", { name: "Title is required" })).toBeNull();
    expect(screen.getByRole("alert", { name: /\(4 errors\)/ })).toBeInTheDocument();
  });

  it("does not steal focus from the field being edited while errors update", async () => {
    const user = await submitEmpty();
    const title = screen.getByLabelText("Title");
    await user.type(title, "abc");
    expect(title).toHaveFocus();
  });

  it("announces success politely once everything is fixed", async () => {
    const user = userEvent.setup();
    render(<DenseForm />);
    await user.click(screen.getByRole("button", { name: "Publish" }));
    await user.type(screen.getByLabelText("Title"), "Prompt");
    await user.type(screen.getByLabelText("Contact email"), "a@b.co");
    await user.type(screen.getByLabelText("Price (XLM)"), "5");
    await user.type(screen.getByLabelText("Description"), "This is a long enough description.");
    await user.click(screen.getByRole("checkbox", { name: "I accept the license terms" }));
    expect(screen.queryByRole("alert", { name: /please fix/i })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      const region = document.querySelector('[aria-live="polite"]');
      expect(region).toHaveTextContent("Listing saved");
    });
  });
});

describe("announceStatus live regions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("uses an assertive atomic region for errors and a polite one for status", () => {
    announceStatus("Payment failed", "assertive");
    announceStatus("Saved", "polite");
    act(() => {
      vi.advanceTimersByTime(60);
    });
    const assertive = document.querySelector('[aria-live="assertive"]')!;
    const polite = document.querySelector('[aria-live="polite"]')!;
    expect(assertive).toHaveTextContent("Payment failed");
    expect(assertive).toHaveAttribute("aria-atomic", "true");
    expect(polite).toHaveTextContent("Saved");
  });

  it("clears the region before re-announcing an identical message", () => {
    announceStatus("Try again", "assertive");
    act(() => {
      vi.advanceTimersByTime(60);
    });
    const region = document.querySelector('[aria-live="assertive"]')!;
    announceStatus("Try again", "assertive");
    expect(region.textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(region).toHaveTextContent("Try again");
  });

  it("keeps announcement regions out of the tab order", () => {
    announceStatus("Hello", "polite");
    const region = document.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(getFocusableElements(region)).toHaveLength(0);
    expect(region).not.toHaveAttribute("tabindex");
  });
});
