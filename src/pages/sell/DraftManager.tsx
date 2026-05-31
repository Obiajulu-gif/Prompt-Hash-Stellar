import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock, Edit3, Eye, Send, Archive, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWallet } from "@/hooks/useWallet";

interface DraftPrompt {
  _id: string;
  title: string;
  image: string;
  price: number;
  category: string;
  listingStatus: "draft" | "ready" | "published" | "archived";
  missingFields: string[];
  isPublishable: boolean;
  updatedAt: string;
}

async function fetchDrafts(walletAddress: string): Promise<DraftPrompt[]> {
  const res = await fetch(`/api/prompts/creator/${walletAddress}/drafts`);
  if (!res.ok) throw new Error("Failed to fetch drafts");
  const data = await res.json();
  return data.drafts ?? [];
}

async function publishDraft(id: string): Promise<void> {
  const res = await fetch(`/api/prompts/${id}/publish`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.reason ?? "Failed to publish");
  }
}

async function archiveDraft(id: string): Promise<void> {
  const res = await fetch(`/api/prompts/${id}/archive`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to archive");
}

function StatusBadge({ status }: { status: DraftPrompt["listingStatus"] }) {
  const variants: Record<DraftPrompt["listingStatus"], { label: string; className: string }> = {
    draft: { label: "Draft", className: "bg-yellow-100 text-yellow-800 border-yellow-300" },
    ready: { label: "Ready", className: "bg-green-100 text-green-800 border-green-300" },
    published: { label: "Published", className: "bg-blue-100 text-blue-800 border-blue-300" },
    archived: { label: "Archived", className: "bg-gray-100 text-gray-600 border-gray-300" },
  };
  const v = variants[status];
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${v.className}`}>{v.label}</span>;
}

export function DraftManager() {
  const { address } = useWallet();
  const queryClient = useQueryClient();
  const [publishError, setPublishError] = useState<Record<string, string>>({});

  const draftsQuery = useQuery({
    queryKey: ["creator-drafts", address],
    queryFn: () => fetchDrafts(address!),
    enabled: Boolean(address),
  });

  const publishMutation = useMutation({
    mutationFn: publishDraft,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["creator-drafts"] }),
    onError: (err, id) => setPublishError((prev) => ({ ...prev, [id]: (err as Error).message })),
  });

  const archiveMutation = useMutation({
    mutationFn: archiveDraft,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["creator-drafts"] }),
  });

  if (!address) {
    return (
      <div className="rounded-xl border border-dashed border-white/15 p-10 text-center">
        <FileText className="mx-auto mb-3 h-10 w-10 text-slate-500" />
        <p className="text-slate-400">Connect your wallet to manage draft listings.</p>
      </div>
    );
  }

  if (draftsQuery.isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-white/5" />
        ))}
      </div>
    );
  }

  if (draftsQuery.isError) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center text-red-400">
        Failed to load drafts. Please try again.
      </div>
    );
  }

  const drafts = draftsQuery.data ?? [];

  if (drafts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/15 p-10 text-center">
        <FileText className="mx-auto mb-3 h-10 w-10 text-slate-500" />
        <h3 className="mb-1 text-lg font-semibold text-white">No draft listings</h3>
        <p className="text-sm text-slate-400">Listings you save as drafts will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-white">Draft Listings <span className="text-sm font-normal text-slate-400">({drafts.length})</span></h2>
      {drafts.map((draft) => (
        <article key={draft._id} className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-white truncate">{draft.title || <em className="text-slate-500">Untitled</em>}</h3>
                <StatusBadge status={draft.listingStatus} />
              </div>
              <p className="mt-0.5 text-xs text-slate-400 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Last updated {new Date(draft.updatedAt).toLocaleDateString()}
              </p>

              {draft.missingFields.length > 0 && (
                <div className="mt-2 flex items-start gap-1.5">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-yellow-400" />
                  <p className="text-xs text-yellow-400">
                    Missing: {draft.missingFields.join(", ")}
                  </p>
                </div>
              )}

              {draft.isPublishable && (
                <div className="mt-2 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                  <p className="text-xs text-green-400">Ready to publish</p>
                </div>
              )}

              {publishError[draft._id] && (
                <p className="mt-1 text-xs text-red-400">{publishError[draft._id]}</p>
              )}
            </div>

            <div className="flex flex-wrap gap-2 sm:shrink-0">
              <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-slate-300 hover:text-white" asChild>
                <a href={`/sell/edit/${draft._id}`}>
                  <Edit3 className="h-3.5 w-3.5" />
                  Edit
                </a>
              </Button>
              <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-slate-300 hover:text-white">
                <Eye className="h-3.5 w-3.5" />
                Preview
              </Button>
              <Button
                size="sm"
                className="h-8 gap-1.5 bg-cyan-200 text-slate-950 hover:bg-cyan-100"
                disabled={!draft.isPublishable || publishMutation.isPending}
                onClick={() => { setPublishError((p) => ({ ...p, [draft._id]: "" })); publishMutation.mutate(draft._id); }}
              >
                <Send className="h-3.5 w-3.5" />
                Publish
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 text-slate-500 hover:text-white"
                disabled={archiveMutation.isPending}
                onClick={() => { if (window.confirm("Archive this draft?")) archiveMutation.mutate(draft._id); }}
              >
                <Archive className="h-3.5 w-3.5" />
                Archive
              </Button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
