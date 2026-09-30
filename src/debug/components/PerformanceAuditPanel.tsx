import { useState } from "react";
import {
  clearAuditLog,
  getAuditLog,
  getAuditSummary,
} from "@/lib/observability/performanceAudit";

const OVER_BUDGET_CLASS = "text-red-400";
const OK_CLASS = "text-emerald-400";

export function PerformanceAuditPanel() {
  const [, forceRender] = useState(0);

  const log = getAuditLog();
  const summary = getAuditSummary();

  const handleClear = () => {
    clearAuditLog();
    forceRender((n) => n + 1);
  };

  const handleRefresh = () => {
    forceRender((n) => n + 1);
  };

  return (
    <div className="rounded-xl border border-white/10 bg-slate-950 p-4 text-xs font-mono text-slate-200 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Performance Audit</h3>
        <div className="flex gap-2">
          <button
            onClick={handleRefresh}
            className="rounded px-2 py-1 bg-slate-800 hover:bg-slate-700"
          >
            Refresh
          </button>
          <button
            onClick={handleClear}
            className="rounded px-2 py-1 bg-slate-800 hover:bg-slate-700 text-red-400"
          >
            Clear
          </button>
        </div>
      </div>

      {summary.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Summary</p>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-slate-400 border-b border-white/10">
                <th className="pb-1 pr-4">Scope</th>
                <th className="pb-1 pr-4 text-right">Count</th>
                <th className="pb-1 pr-4 text-right">Avg ms</th>
                <th className="pb-1 pr-4 text-right">Max ms</th>
                <th className="pb-1 text-right">Over budget</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => (
                <tr key={row.scope} className="border-b border-white/5">
                  <td className="py-1 pr-4 text-indigo-300">{row.scope}</td>
                  <td className="py-1 pr-4 text-right">{row.count}</td>
                  <td className={`py-1 pr-4 text-right ${row.overBudget > 0 ? OVER_BUDGET_CLASS : OK_CLASS}`}>
                    {row.avgMs}
                  </td>
                  <td className={`py-1 pr-4 text-right ${row.maxMs > 0 && row.overBudget > 0 ? OVER_BUDGET_CLASS : OK_CLASS}`}>
                    {row.maxMs}
                  </td>
                  <td className={`py-1 text-right ${row.overBudget > 0 ? OVER_BUDGET_CLASS : OK_CLASS}`}>
                    {row.overBudget}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">
          Recent entries ({log.length})
        </p>
        {log.length === 0 ? (
          <p className="text-slate-500">No entries yet.</p>
        ) : (
          <div className="max-h-48 overflow-y-auto space-y-1">
            {[...log].reverse().map((entry, i) => (
              <div
                key={i}
                className="flex items-center gap-3 py-0.5 border-b border-white/5"
              >
                <span className="text-indigo-400 shrink-0">{entry.scope}</span>
                <span
                  className={`shrink-0 ${entry.duration > 1500 ? OVER_BUDGET_CLASS : OK_CLASS}`}
                >
                  {entry.duration}ms
                </span>
                {entry.metadata && (
                  <span className="text-slate-500 truncate">
                    {JSON.stringify(entry.metadata)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
