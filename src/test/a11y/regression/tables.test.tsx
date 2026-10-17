/**
 * Accessibility regression: dense data tables (purchases, sales, ledgers).
 */

import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccessibleTable } from "@/components/accessibility/AccessibleTable";
import { tabStops } from "./helpers";

const headers = ["Prompt", "Buyer", "Price", "Status", "Actions"];

describe("AccessibleTable semantics", () => {
  const rows = [
    ["Alpha", "GA…1", "10 XLM", "Settled", "—"],
    ["Beta", "GB…2", "25 XLM", "Pending", "—"],
  ];

  it("exposes a named table with column headers", () => {
    render(<AccessibleTable caption="Recent sales" headers={headers} rows={rows} />);
    const table = screen.getByRole("table", { name: "Recent sales" });
    const cols = within(table).getAllByRole("columnheader");
    expect(cols.map((c) => c.textContent)).toEqual(headers);
    cols.forEach((c) => expect(c).toHaveAttribute("scope", "col"));
  });

  it("marks the first cell of every row as a row header (th scope=row), not a td", () => {
    render(<AccessibleTable caption="Recent sales" headers={headers} rows={rows} />);
    const rowHeaders = screen.getAllByRole("rowheader");
    expect(rowHeaders.map((r) => r.textContent)).toEqual(["Alpha", "Beta"]);
    rowHeaders.forEach((r) => {
      expect(r.tagName).toBe("TH");
      expect(r).toHaveAttribute("scope", "row");
    });
    expect(document.querySelectorAll("td[scope]")).toHaveLength(0);
  });

  it("can opt out of row headers for tables without an identifying first column", () => {
    render(
      <AccessibleTable caption="Totals" headers={["A", "B"]} rows={[["1", "2"]]} firstColumnIsRowHeader={false} />,
    );
    expect(screen.queryAllByRole("rowheader")).toHaveLength(0);
    expect(screen.getAllByRole("cell")).toHaveLength(2);
  });

  it("lets each data cell be resolved to its row and column", () => {
    render(<AccessibleTable caption="Recent sales" headers={headers} rows={rows} />);
    const row = screen.getByRole("row", { name: /Beta/ });
    expect(within(row).getByRole("cell", { name: "25 XLM" })).toBeInTheDocument();
    expect(within(row).getByRole("rowheader", { name: "Beta" })).toBeInTheDocument();
  });

  it("has no tab stops when the table is static", () => {
    render(<AccessibleTable headers={headers} rows={rows} />);
    expect(tabStops()).toHaveLength(0);
  });

  it("makes a captioned scroll container keyboard-reachable and named", () => {
    render(<AccessibleTable caption="Recent sales" headers={headers} rows={rows} />);
    const region = screen.getByRole("region", { name: "Recent sales" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveClass("overflow-x-auto");
  });

  it("does not add an unnamed focusable region when there is no caption", () => {
    render(<AccessibleTable headers={headers} rows={rows} />);
    expect(screen.queryByRole("region")).toBeNull();
  });
});

describe("AccessibleTable empty and error-adjacent states", () => {
  it("renders a spanning, readable empty message instead of a blank body", () => {
    render(<AccessibleTable caption="Sales" headers={headers} rows={[]} emptyMessage="No sales yet." />);
    const cell = screen.getByRole("cell", { name: "No sales yet." });
    expect(cell).toHaveAttribute("colspan", String(headers.length));
  });

  it("falls back to a default empty message", () => {
    render(<AccessibleTable headers={headers} rows={[]} />);
    expect(screen.getByRole("cell", { name: "No results." })).toBeInTheDocument();
  });
});

describe("AccessibleTable with interactive cells", () => {
  function Harness({ onRetry }: { onRetry: (name: string) => void }) {
    const [failed, setFailed] = useState<string[]>(["Alpha"]);
    return (
      <>
        <AccessibleTable
          caption="Settlements"
          headers={["Prompt", "Status", "Actions"]}
          rows={["Alpha", "Beta"].map((name) => [
            name,
            failed.includes(name) ? "Failed" : "Settled",
            failed.includes(name) ? (
              <button
                key="retry"
                aria-label={`Retry settlement for ${name}`}
                onClick={() => {
                  onRetry(name);
                  setFailed((f) => f.filter((x) => x !== name));
                }}
              >
                Retry
              </button>
            ) : (
              "—"
            ),
          ])}
        />
        <p role="status">{failed.length} failed</p>
      </>
    );
  }

  it("keeps action controls uniquely named per row", () => {
    render(<Harness onRetry={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Retry settlement for Alpha" })).toBeInTheDocument();
  });

  it("supports keyboard activation and reflects recovery in a status region", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<Harness onRetry={onRetry} />);
    expect(screen.getByRole("status")).toHaveTextContent("1 failed");
    await user.tab(); // scroll region
    expect(screen.getByRole("region", { name: "Settlements" })).toHaveFocus();
    await user.tab(); // retry button
    await user.keyboard("{Enter}");
    expect(onRetry).toHaveBeenCalledWith("Alpha");
    expect(screen.getByRole("status")).toHaveTextContent("0 failed");
    expect(screen.getByRole("row", { name: /Alpha/ })).toHaveTextContent("Settled");
  });
});
