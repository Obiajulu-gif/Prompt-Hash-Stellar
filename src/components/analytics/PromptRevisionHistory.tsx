import { useQuery } from "@tanstack/react-query";
import { History, Clock, Hash } from "lucide-react";

interface RevisionEntry {
  versionIndex: number;
  changeNote: string;
  createdAt: string;
  createdBy: string;
}

interface PromptRevisionHistoryProps {
  promptId: string;
  currentRevision: number;
}

export function PromptRevisionHistory({
  promptId,
  currentRevision,
}: PromptRevisionHistoryProps) {
  const { data: revisions, isLoading } = useQuery({
    queryKey: ["prompt-revisions", promptId],
    queryFn: async () => {
      const res = await fetch(`/api/versions/${promptId}/history`);
      if (!res.ok) return [];
      return res.json() as Promise<RevisionEntry[]>;
    },
    staleTime: 30_000,
    enabled: Boolean(promptId),
  });

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-4 flex items-center gap-2">
        <History className="h-4 w-4 text-amber-300" />
        <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">
          Revision History
        </h3>
        <span className="ml-auto text-xs text-slate-500">
          v{currentRevision}
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg border border-white/5 bg-white/[0.02]"
            />
          ))}
        </div>
      ) : revisions && revisions.length > 0 ? (
        <div className="space-y-3">
          {revisions.map((rev) => (
            <div
              key={rev.versionIndex}
              className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
            >
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Hash className="h-3 w-3" />
                <span className="font-mono font-semibold text-slate-300">
                  v{rev.versionIndex}
                </span>
                <Clock className="ml-2 h-3 w-3" />
                <span>
                  {new Date(rev.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
              {rev.changeNote ? (
                <p className="mt-1.5 text-sm text-slate-300">
                  {rev.changeNote}
                </p>
              ) : (
                <p className="mt-1.5 text-xs italic text-slate-500">
                  No change note
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">No revisions recorded yet.</p>
      )}
    </div>
  );
}
