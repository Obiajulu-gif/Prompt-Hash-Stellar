/**
 * Accessible table component.
 * Provides semantic HTML table structure with proper heading associations.
 */

import React, { ReactNode } from 'react';

export interface AccessibleTableProps {
  caption?: string;
  headers: string[];
  rows: (ReactNode | string)[][];
  className?: string;
  headerClassName?: string;
  rowClassName?: string;
  cellClassName?: string;
  /** Treat the first cell of each row as the row header (default true). */
  firstColumnIsRowHeader?: boolean;
  /** Text shown (and announced) when there are no rows. */
  emptyMessage?: string;
}

export function AccessibleTable({
  caption,
  headers,
  rows,
  className = '',
  headerClassName = 'bg-slate-800 text-white font-semibold',
  rowClassName = '',
  cellClassName = 'p-3 text-slate-300',
  firstColumnIsRowHeader = true,
  emptyMessage = 'No results.',
}: AccessibleTableProps) {
  return (
    // A horizontally scrollable region must be keyboard reachable, and needs a
    // name so screen readers can say what they landed on.
    <div
      className="overflow-x-auto"
      {...(caption ? { role: 'region', 'aria-label': caption, tabIndex: 0 } : {})}
    >
      <table className={`w-full border-collapse ${className}`}>
        {caption && (
          <caption className="sr-only">
            {caption}
          </caption>
        )}
        
        <thead>
          <tr>
            {headers.map((header, idx) => (
              <th
                key={idx}
                className={`text-left ${headerClassName} ${cellClassName}`}
                scope="col"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={Math.max(headers.length, 1)} className={cellClassName}>
                {emptyMessage}
              </td>
            </tr>
          )}
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx} className={`border-b border-slate-700/50 ${rowClassName}`}>
              {row.map((cell, cellIdx) =>
                cellIdx === 0 && firstColumnIsRowHeader ? (
                  <th
                    key={cellIdx}
                    scope="row"
                    className={`text-left font-normal ${cellClassName}`}
                  >
                    {cell}
                  </th>
                ) : (
                  <td key={cellIdx} className={cellClassName}>
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default AccessibleTable;
