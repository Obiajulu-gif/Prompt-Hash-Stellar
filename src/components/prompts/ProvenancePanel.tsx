import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitFork, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWallet } from "@/hooks/useWallet";
import { getWalletSession } from "@/lib/auth/walletSession";
import { getSourcePromptId } from "@/lib/prompts/remixAttribution";
import {
  declareProvenance,
  fetchLineage,
  HIDDEN_NODE_LABELS,
  PROVENANCE_KIND_LABELS,
  PROVENANCE_KINDS,
  removeProvenance,
  type LineageNode,
  type ProvenanceKind,
} from "@/lib/prompts/provenance";

function NodeLabel({ node }: { node: LineageNode }) {
  if (node.visibility !== "public" || !node.link) {
    return (
      <span className="italic text-slate-500">
        {HIDDEN_NODE_LABELS[node.visibility as keyof typeof HIDDEN_NODE_LABELS]} (#{node.promptId})
      </span>
    );
  }
  return (
    <Link to={node.link} className="font-semibold underline underline-offset-4 hover:text-white">
      {node.title} (#{node.promptId})
    </Link>
  );
}

/**
 * Provenance history for a prompt detail page (#753): where the listing came
 * from and what was derived from it, rebuilt from explicit relationship
 * records. The listing's creator can also declare or remove relationships.
 */
export function ProvenancePanel({ promptId, creator }: { promptId: string; creator: string }) {
  const { address, signMessage } = useWallet();
  const queryClient = useQueryClient();
  const isCreator = Boolean(address) && address!.toLowerCase() === creator.toLowerCase();

  const { data: lineage, isLoading, isError } = useQuery({
    queryKey: ["prompt-provenance", promptId],
    queryFn: () => fetchLineage(promptId),
    retry: false,
  });

  const directAncestorIds = new Set(
    (lineage?.ancestors ?? []).filter((a) => a.depth === 1).map((a) => a.promptId),
  );
  // Remix attributions used to live only in this browser; offer to record it.
  const legacySource = isCreator ? getSourcePromptId(promptId) : undefined;
  const pendingLegacySource =
    legacySource && lineage && !directAncestorIds.has(legacySource) ? legacySource : undefined;

  const [kind, setKind] = useState<ProvenanceKind>("remix");
  const [relatedPromptId, setRelatedPromptId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const change = useMutation<void, Error, (token: string) => Promise<void>>({
    mutationFn: async (action) => {
      if (!address || !signMessage) throw new Error("Connect the creator wallet first.");
      return action(await getWalletSession(address, signMessage));
    },
    onSuccess: () => {
      setError(null);
      setRelatedPromptId("");
      return queryClient.invalidateQueries({ queryKey: ["prompt-provenance", promptId] });
    },
    onError: (err) => setError(err.message),
  });

  const declare = (related: string, relationKind: ProvenanceKind) =>
    change.mutate((token) =>
      declareProvenance(address as string, token, promptId, {
        relatedPromptId: related,
        kind: relationKind,
      }),
    );

  if (isLoading) return null;

  const ancestors = lineage?.ancestors ?? [];
  const derivatives = lineage?.derivatives ?? [];

  return (
    <section
      data-testid="provenance-panel"
      className="rounded-2xl border border-white/10 bg-[#0f1419] p-6 space-y-4"
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
        <GitFork className="h-4 w-4 text-violet-300" />
        Provenance
      </h2>

      {isError ? (
        <p className="text-xs text-slate-500">Provenance history is unavailable right now.</p>
      ) : ancestors.length === 0 && derivatives.length === 0 ? (
        <p className="text-xs text-slate-400">
          Original listing — no recorded sources or derivatives.
        </p>
      ) : null}

      {ancestors.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Derived from</p>
          <ol className="space-y-1.5 text-sm text-slate-300">
            {ancestors.map((ancestor) => (
              <li
                key={`${ancestor.derivedPromptId}-${ancestor.promptId}`}
                className="flex flex-wrap items-center gap-2"
                style={{ paddingLeft: `${(ancestor.depth - 1) * 16}px` }}
              >
                <span className="text-slate-400">{PROVENANCE_KIND_LABELS[ancestor.kind]}</span>
                <NodeLabel node={ancestor} />
                {ancestor.depth > 1 && (
                  <span className="text-xs text-slate-500">via #{ancestor.derivedPromptId}</span>
                )}
                {ancestor.origin === "backfill" && (
                  <span className="rounded border border-amber-400/20 bg-amber-400/10 px-1.5 text-[10px] text-amber-200">
                    Unconfirmed
                  </span>
                )}
                {isCreator && ancestor.depth === 1 && (
                  <>
                    {ancestor.origin === "backfill" && (
                      <button
                        type="button"
                        onClick={() => declare(ancestor.promptId, ancestor.kind)}
                        disabled={change.isPending}
                        className="text-xs text-cyan-300 hover:text-white"
                      >
                        Confirm
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`Remove relationship to #${ancestor.promptId}`}
                      onClick={() =>
                        change.mutate((token) =>
                          removeProvenance(address as string, token, promptId, ancestor.promptId),
                        )
                      }
                      disabled={change.isPending}
                      className="text-slate-500 hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ol>
          {lineage?.truncated && (
            <p className="text-xs text-slate-500">Older history is not shown.</p>
          )}
        </div>
      )}

      {derivatives.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
            Derivatives ({lineage?.derivativeCount ?? derivatives.length})
          </p>
          <ul className="space-y-1.5 text-sm text-slate-300">
            {derivatives.map((derivative) => (
              <li key={derivative.promptId} className="flex flex-wrap items-center gap-2">
                <NodeLabel node={derivative} />
                <span className="text-xs text-slate-500">
                  {PROVENANCE_KIND_LABELS[derivative.kind].toLowerCase()} this listing
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isCreator && (
        <form
          className="space-y-2 border-t border-white/10 pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (/^\d+$/.test(relatedPromptId.trim())) declare(relatedPromptId.trim(), kind);
          }}
        >
          <p className="text-xs text-slate-400">
            As the creator, record where this listing came from.
          </p>
          {pendingLegacySource && (
            <button
              type="button"
              onClick={() => declare(pendingLegacySource, "remix")}
              disabled={change.isPending}
              className="text-xs text-cyan-300 underline underline-offset-4 hover:text-white"
            >
              Record the remix of #{pendingLegacySource} saved in this browser
            </button>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              aria-label="Relationship"
              value={kind}
              onChange={(event) => setKind(event.target.value as ProvenanceKind)}
              className="h-9 rounded-md border border-white/10 bg-white/[0.04] px-2 text-xs text-slate-200"
            >
              {PROVENANCE_KINDS.map((option) => (
                <option key={option} value={option}>
                  {PROVENANCE_KIND_LABELS[option]}
                </option>
              ))}
            </select>
            <Input
              aria-label="Related prompt ID"
              placeholder="Prompt ID, e.g. 42"
              inputMode="numeric"
              value={relatedPromptId}
              onChange={(event) => setRelatedPromptId(event.target.value)}
              className="h-9"
            />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              disabled={change.isPending || !/^\d+$/.test(relatedPromptId.trim())}
              className="h-9 shrink-0 border border-white/10 text-slate-200 hover:bg-white/10"
            >
              {change.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Record
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-rose-300">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
