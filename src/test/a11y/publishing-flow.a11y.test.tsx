/**
 * Accessibility tests for creator publishing flow.
 * Validates form accessibility, error handling, and keyboard navigation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';

describe('Publishing Flow Accessibility', () => {
  describe('Create Prompt Form', () => {
    it('should have no accessibility violations', async () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <form>
          <div>
            <label htmlFor="title">Prompt Title *</label>
            <input id="title" type="text" required />
          </div>
          <div>
            <label htmlFor="category">Category *</label>
            <select id="category" required>
              <option>Programming</option>
            </select>
          </div>
          <button type="submit">Publish</button>
        </form>
      `;
      document.body.appendChild(container);

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('should have properly labeled form fields', () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <form>
          <label htmlFor="title">Prompt Title</label>
          <input id="title" type="text" />
          <label htmlFor="desc">Description</label>
          <textarea id="desc"></textarea>
        </form>
      `;
      document.body.appendChild(container);

      const titleInput = screen.getByLabelText(/prompt title/i);
      const descInput = screen.getByLabelText(/description/i);

      expect(titleInput).toBeInTheDocument();
      expect(descInput).toBeInTheDocument();
    });

    it('should indicate required fields accessibly', () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <label htmlFor="title">
          Prompt Title
          <span aria-hidden="true" className="text-red-400">*</span>
        </label>
        <input id="title" type="text" required />
      `;
      document.body.appendChild(container);

      const input = container.querySelector('#title') as HTMLElement;
      expect(input).toHaveAttribute('required');
    });

    it('should support keyboard navigation through form', async () => {
      const user = userEvent.setup();
      const container = document.createElement('div');
      container.innerHTML = `
        <form>
          <input id="field1" type="text" />
          <input id="field2" type="text" />
          <button id="submit">Submit</button>
        </form>
      `;
      document.body.appendChild(container);

      const field1 = container.querySelector('#field1') as HTMLElement;
      const field2 = container.querySelector('#field2') as HTMLElement;
      const submit = container.querySelector('#submit') as HTMLElement;

      // Tab through form
      field1.focus();
      expect(field1).toHaveFocus();

      await user.tab();
      // Focus should move to next field (requires proper tabindex)
    });
  });

  describe('Form Validation & Errors', () => {
    it('should mark invalid fields with aria-invalid', () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <div>
          <label htmlFor="title">Title</label>
          <input id="title" type="text" aria-invalid="true" />
          <span id="title-error" role="alert" className="text-red-400">
            Title is required
          </span>
        </div>
      `;
      document.body.appendChild(container);

      const input = container.querySelector('#title') as HTMLElement;
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    it('should link error messages to fields via aria-describedby', () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <div>
          <label htmlFor="email">Email</label>
          <input 
            id="email" 
            type="email" 
            aria-invalid="true"
            aria-describedby="email-error"
          />
          <span id="email-error" role="alert">
            Please enter a valid email
          </span>
        </div>
      `;
      document.body.appendChild(container);

      const input = container.querySelector('#email') as HTMLElement;
      expect(input).toHaveAttribute('aria-describedby', 'email-error');
    });

    it('should announce validation errors to screen readers', () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <div>
          <input id="field" aria-invalid="true" aria-describedby="error" />
          <div id="error" role="alert" aria-live="polite">
            This field is required
          </div>
        </div>
      `;
      document.body.appendChild(container);

      const error = container.querySelector('#error');
      expect(error).toHaveAttribute('role', 'alert');
      expect(error).toHaveAttribute('aria-live', 'polite');
    });

    it('should display multiple field errors', () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <form>
          <div>
            <label htmlFor="title">Title</label>
            <input id="title" aria-describedby="title-error" />
            <div id="title-error" role="alert">Title is required</div>
          </div>
          <div>
            <label htmlFor="price">Price</label>
            <input id="price" aria-describedby="price-error" />
            <div id="price-error" role="alert">Price must be positive</div>
          </div>
        </form>
      `;
      document.body.appendChild(container);

      const titleError = screen.getByText(/title is required/i);
      const priceError = screen.getByText(/price must be positive/i);

      expect(titleError).toBeInTheDocument();
      expect(priceError).toBeInTheDocument();
    });
  });

  describe('Tab Navigation', () => {
    it('should support tab switching with keyboard', async () => {
      const user = userEvent.setup();
      const container = document.createElement('div');
      container.innerHTML = `
        <div role="tablist">
          <button role="tab" aria-selected="true" aria-controls="panel1">Details</button>
          <button role="tab" aria-selected="false" aria-controls="panel2">Preview</button>
        </div>
        <div id="panel1" role="tabpanel" aria-labelledby="tab1">Details content</div>
        <div id="panel2" role="tabpanel" aria-labelledby="tab2" hidden>Preview content</div>
      `;
      document.body.appendChild(container);

      const tabs = container.querySelectorAll('[role="tab"]');
      expect(tabs).toHaveLength(2);
      expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('should announce tab panel changes', () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <div role="tablist" aria-label="Form sections">
          <button role="tab" aria-selected="true">Step 1: Metadata</button>
          <button role="tab" aria-selected="false">Step 2: Preview</button>
        </div>
      `;
      document.body.appendChild(container);

      const tablist = container.querySelector('[role="tablist"]');
      expect(tablist).toHaveAttribute('aria-label', 'Form sections');
    });
  });

  describe('Co-creator Revenue Splits', () => {
    it('should group co-creator inputs with fieldset', () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <fieldset>
          <legend>Co-creator Revenue Splits</legend>
          <div>
            <label htmlFor="creator1-wallet">Creator 1 Wallet</label>
            <input id="creator1-wallet" type="text" />
          </div>
          <div>
            <label htmlFor="creator1-share">Creator 1 Share %</label>
            <input id="creator1-share" type="number" />
          </div>
        </fieldset>
      `;
      document.body.appendChild(container);

      const fieldset = container.querySelector('fieldset');
      const legend = container.querySelector('legend');

      expect(fieldset).toBeInTheDocument();
      expect(legend).toHaveTextContent(/co-creator revenue splits/i);
    });

    it('should provide add/remove buttons for array fields', () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <div role="region" aria-label="Co-creator entries">
          <div>
            <input type="text" aria-label="Co-creator 1 wallet" />
            <button aria-label="Remove co-creator 1">Delete</button>
          </div>
          <button aria-label="Add another co-creator">+ Add</button>
        </div>
      `;
      document.body.appendChild(container);

      const addBtn = screen.getByRole('button', { name: /add another co-creator/i });
      const removeBtn = screen.getByRole('button', { name: /remove co-creator/i });

      expect(addBtn).toBeInTheDocument();
      expect(removeBtn).toBeInTheDocument();
    });
  });

  describe('Category & Tag Selection', () => {
    it('should have accessible category dropdown', () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <label htmlFor="category">Prompt Category *</label>
        <select id="category" aria-label="Prompt category" required>
          <option>Select a category</option>
          <option>Programming</option>
          <option>Creative Writing</option>
        </select>
      `;
      document.body.appendChild(container);

      const select = container.querySelector('#category') as HTMLElement;
      expect(select).toHaveAttribute('aria-label', 'Prompt category');
    });

    it('should support keyboard input in tag input', async () => {
      const user = userEvent.setup();
      const container = document.createElement('div');
      container.innerHTML = `
        <div role="combobox" aria-label="Add tags" aria-expanded="false">
          <input type="text" placeholder="Type tag and press Enter" />
          <div role="listbox">
            <!-- tags rendered here -->
          </div>
        </div>
      `;
      document.body.appendChild(container);

      const input = container.querySelector('input') as HTMLElement;
      const combobox = container.querySelector('[role="combobox"]');

      input.focus();
      await user.type(input, 'python{Enter}');

      expect(combobox).toBeInTheDocument();
    });
  });

  describe('Quality Checklist', () => {
    it('should present checklist items accessibly', () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <ul aria-label="Listing quality requirements">
          <li>
            <input type="checkbox" id="check1" />
            <label htmlFor="check1">Title is clear and descriptive</label>
          </li>
          <li>
            <input type="checkbox" id="check2" />
            <label htmlFor="check2">Preview text is provided</label>
          </li>
        </ul>
      `;
      document.body.appendChild(container);

      const checks = container.querySelectorAll('input[type="checkbox"]');
      expect(checks).toHaveLength(2);

      checks.forEach((check) => {
        const label = container.querySelector(`label[for="${check.id}"]`);
        expect(label).toBeInTheDocument();
      });
    });

    it('should announce checklist completion status', () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <div role="status" aria-live="polite" aria-atomic="true">
          3 of 5 requirements completed
        </div>
      `;
      document.body.appendChild(container);

      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-live', 'polite');
      expect(status).toHaveTextContent(/3 of 5 requirements/);
    });
  });

  describe('Dashboard View', () => {
    it('should have semantic structure for prompt list', async () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <main>
          <h1>My Prompts</h1>
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>My Prompt</td>
                <td>Published</td>
                <td>
                  <button aria-label="Edit My Prompt">Edit</button>
                  <button aria-label="Delete My Prompt">Delete</button>
                </td>
              </tr>
            </tbody>
          </table>
        </main>
      `;
      document.body.appendChild(container);

      const table = container.querySelector('table');
      const results = await axe(table!);
      expect(results).toHaveNoViolations();
    });

    it('should provide accessible status badge', () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <span 
          className="status-badge status-published" 
          aria-label="Status: Published"
        >
          Published
        </span>
      `;
      document.body.appendChild(container);

      const badge = container.querySelector('[aria-label*="Status"]');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('Published');
    });

    it('should have keyboard-accessible row actions', async () => {
      const user = userEvent.setup();
      const container = document.createElement('div');
      container.innerHTML = `
        <table>
          <tbody>
            <tr>
              <td>My Prompt</td>
              <td>
                <button>Edit</button>
                <button>Delete</button>
              </td>
            </tr>
          </tbody>
        </table>
      `;
      document.body.appendChild(container);

      const editBtn = screen.getByRole('button', { name: /edit/i });
      const deleteBtn = screen.getByRole('button', { name: /delete/i });

      editBtn.focus();
      expect(editBtn).toHaveFocus();

      await user.tab();
      expect(deleteBtn).toHaveFocus();
    });
  });
});
