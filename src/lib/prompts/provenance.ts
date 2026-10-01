/**
 * Client for the prompt provenance graph (#753). Lineage is public; declaring
 * or removing a relationship needs a wallet session for the listing's
 * creator (see src/lib/auth/walletSession.ts).
 */

export type ProvenanceKind = "parent" | "fork" | "remix" | "source";
export type ProvenanceOrigin = "creator" | "backfill";
export type NodeVisibility = "public" | "private" | "hidden" | "deleted";

export interface LineageNode {
  promptId: string;
  kind: ProvenanceKind;
  origin: ProvenanceOrigin;
  visibility: NodeVisibility;
  /** Only present for publicly visible listings. */
  title: string | null;
  link: string | null;
}

export interface Lineage {
  promptId: string;
  visibility: NodeVisibility;
  ancestors: Array<LineageNode & { derivedPromptId: string; depth: number }>;
  derivatives: LineageNode[];
  derivativeCount: number;
  truncated: boolean;
}

export interface ProvenanceFlag {
  type: "unconfirmed_attribution" | "undeclared_similarity" | "cross_creator_parent" | "deep_fork_chain";
  promptId: string;
  relatedPromptIds: string[];
  detail: string;
}

export const PROVENANCE_KINDS: ProvenanceKind[] = ["parent", "fork", "remix", "source"];

export const PROVENANCE_KIND_LABELS: Record<ProvenanceKind, string> = {
  parent: "New edition of",
  fork: "Forked from",
  remix: "Remix of",
  source: "Based on",
};

export const HIDDEN_NODE_LABELS: Record<Exclude<NodeVisibility, "public">, string> = {
  private: "Private listing",
  hidden: "Listing hidden by moderation",
  deleted: "Deleted listing",
};

async function throwServerError(res: Response): Promise<never> {
  const payload = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new Error(payload?.error || `Request failed (${res.status}).`);
}

export async function fetchLineage(promptId: string): Promise<Lineage> {
  const res = await fetch(`/api/provenance/${encodeURIComponent(promptId)}`);
  if (!res.ok) return throwServerError(res);
  return res.json();
}

export async function declareProvenance(
  creatorWallet: string,
  sessionToken: string,
  promptId: string,
  relation: { relatedPromptId: string; kind: ProvenanceKind },
): Promise<void> {
  const res = await fetch(`/api/provenance/${encodeURIComponent(promptId)}/relations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({ creatorWallet, ...relation }),
  });
  if (!res.ok) return throwServerError(res);
}

export async function removeProvenance(
  creatorWallet: string,
  sessionToken: string,
  promptId: string,
  relatedPromptId: string,
): Promise<void> {
  const res = await fetch(
    `/api/provenance/${encodeURIComponent(promptId)}/relations/${encodeURIComponent(
      relatedPromptId,
    )}?creatorWallet=${encodeURIComponent(creatorWallet)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${sessionToken}` } },
  );
  if (!res.ok) return throwServerError(res);
}

/** Moderation flags; needs an admin token with the `provenance:read` scope. */
export async function fetchProvenanceFlags(): Promise<ProvenanceFlag[]> {
  const res = await fetch("/api/provenance/admin/flags", {
    headers: { Authorization: `Bearer ${localStorage.getItem("adminToken") || ""}` },
  });
  if (!res.ok) return throwServerError(res);
  const body = (await res.json()) as { flags: ProvenanceFlag[] };
  return body.flags;
}
