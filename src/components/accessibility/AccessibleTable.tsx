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
}

export function AccessibleTable({
  caption,
  headers,
  rows,
  className = '',
  headerClassName = 'bg-slate-800 text-white font-semibold',
  rowClassName = '',
  cellClassName = 'p-3 text-slate-300',
}: AccessibleTableProps) {
  return (
    <div className="overflow-x-auto">
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
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx} className={`border-b border-slate-700/50 ${rowClassName}`}>
              {row.map((cell, cellIdx) => (
                <td
                  key={cellIdx}
                  className={cellClassName}
                  // First cell can be a row header in some contexts
                  scope={cellIdx === 0 ? 'row' : undefined}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default AccessibleTable;
