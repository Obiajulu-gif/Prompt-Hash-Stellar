import type mongoose from "mongoose";
import Prompt from "../models/Prompt";
import PromptRelation, {
  PROVENANCE_KINDS,
  ProvenanceKind,
  ProvenanceOrigin,
} from "../models/PromptRelation";

/**
 * Deterministic prompt provenance graph (#753).
 *
 * Lineage is rebuilt from explicit PromptRelation records. Traversal is
 * breadth-first with a visited set and a depth cap, and every list is sorted
 * the same way, so the same records always produce the same lineage. Linked
 * prompts that are hidden by moderation, unlisted, or deleted are rendered as
 * placeholders — their relations are kept, their details are not exposed.
 */

export const MAX_LINEAGE_DEPTH = 25;
export const MAX_DERIVATIVES = 50;
/** Fork/remix chains at least this deep across creators are flagged. */
export const SUSPICIOUS_FORK_CHAIN_DEPTH = 3;

const KIND_ORDER: Record<ProvenanceKind, number> = { parent: 0, source: 1, fork: 2, remix: 3 };

export class ProvenanceError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type NodeVisibility = "public" | "private" | "hidden" | "deleted";

interface RelationEdge {
  promptId: string;
  relatedPromptId: string;
  kind: ProvenanceKind;
  origin: ProvenanceOrigin;
}

export function isPromptId(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function byNumericId(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

export function sortEdges<T extends RelationEdge>(edges: T[]): T[] {
  return [...edges].sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      byNumericId(a.relatedPromptId, b.relatedPromptId) ||
      byNumericId(a.promptId, b.promptId),
  );
}

type ParentLoader = (promptIds: string[]) => Promise<RelationEdge[]>;

function relationLoader(kinds?: ProvenanceKind[]): ParentLoader {
  return async (promptIds) =>
    (await PromptRelation.find({
      promptId: { $in: promptIds },
      ...(kinds ? { kind: { $in: kinds } } : {}),
    })
      .select("promptId relatedPromptId kind origin")
      .lean()) as RelationEdge[];
}

/**
 * Walks ancestor edges breadth-first from `promptId`, one query per level.
 * `truncated` is set when the depth cap stopped the walk early.
 */
export async function walkAncestors(
  promptId: string,
  load: ParentLoader = relationLoader(),
): Promise<{ edges: Array<RelationEdge & { depth: number }>; truncated: boolean }> {
  const edges: Array<RelationEdge & { depth: number }> = [];
  const visited = new Set<string>([promptId]);
  let frontier = [promptId];
  let depth = 0;

  while (frontier.length > 0) {
    if (depth === MAX_LINEAGE_DEPTH) return { edges, truncated: true };
    depth += 1;
    const next: string[] = [];
    for (const row of sortEdges(await load(frontier))) {
      edges.push({
        promptId: String(row.promptId),
        relatedPromptId: String(row.relatedPromptId),
        kind: row.kind,
        origin: row.origin,
        depth,
      });
      const ancestor = String(row.relatedPromptId);
      if (!visited.has(ancestor)) {
        visited.add(ancestor);
        next.push(ancestor);
      }
    }
    frontier = next;
  }
  return { edges, truncated: false };
}

/**
 * Adding `promptId → relatedPromptId` closes a cycle when `promptId` is the
 * related prompt itself or already one of its ancestors. A lineage too deep
 * to check fully is refused rather than assumed acyclic.
 */
export async function assertNoCycle(
  promptId: string,
  relatedPromptId: string,
  load: ParentLoader = relationLoader(),
): Promise<void> {
  if (promptId === relatedPromptId) {
    throw new ProvenanceError(409, "A prompt cannot derive from itself.");
  }
  const { edges, truncated } = await walkAncestors(relatedPromptId, load);
  if (edges.some((edge) => edge.relatedPromptId === promptId)) {
    throw new ProvenanceError(409, "This relationship would create a provenance cycle.");
  }
  if (truncated) {
    throw new ProvenanceError(409, "The related prompt's lineage is too deep to verify.");
  }
}

function visibilityOf(doc: any): NodeVisibility {
  if (!doc) return "deleted";
  if (doc.moderationStatus === "restricted" || doc.moderationStatus === "retired") {
    return "hidden";
  }
  if (doc.isActive === false || doc.listingStatus === "archived") return "private";
  return "public";
}

async function loadNodes(promptIds: string[]) {
  const docs: any[] = promptIds.length
    ? await Prompt.find({ onChainId: { $in: promptIds } })
        .select("onChainId title isActive listingStatus moderationStatus")
        .lean()
    : [];
  const byId = new Map(docs.map((doc) => [String(doc.onChainId), doc]));
  return (promptId: string) => {
    const doc = byId.get(promptId);
    const visibility = visibilityOf(doc);
    return visibility === "public"
      ? { visibility, title: doc.title ?? `Prompt #${promptId}`, link: `/prompts/${promptId}` }
      : { visibility, title: null, link: null };
  };
}

export async function getLineage(promptId: string) {
  if (!isPromptId(promptId)) throw new ProvenanceError(400, "Invalid prompt id.");

  const [{ edges, truncated }, derivativeRows] = await Promise.all([
    walkAncestors(promptId),
    PromptRelation.find({ relatedPromptId: promptId })
      .select("promptId relatedPromptId kind origin")
      .lean()
      .exec() as Promise<RelationEdge[]>,
  ]);
  const derivatives = sortEdges(derivativeRows).slice(0, MAX_DERIVATIVES);

  const node = await loadNodes([
    ...new Set([
      promptId,
      ...edges.map((edge) => edge.relatedPromptId),
      ...derivatives.map((edge) => String(edge.promptId)),
    ]),
  ]);

  return {
    promptId,
    visibility: node(promptId).visibility,
    ancestors: edges.map((edge) => ({
      promptId: edge.relatedPromptId,
      derivedPromptId: edge.promptId,
      kind: edge.kind,
      origin: edge.origin,
      depth: edge.depth,
      ...node(edge.relatedPromptId),
    })),
    derivatives: derivatives.map((edge) => ({
      promptId: String(edge.promptId),
      kind: edge.kind,
      origin: edge.origin,
      ...node(String(edge.promptId)),
    })),
    derivativeCount: derivativeRows.length,
    truncated,
  };
}

async function assertCreator(promptId: string, wallet: string) {
  const prompt: any = await Prompt.findOne({ onChainId: promptId })
    .select("owner")
    .populate("owner", "walletAddress")
    .lean();
  if (!prompt) throw new ProvenanceError(404, "Prompt not found.");
  const owner = String(prompt.owner?.walletAddress ?? "").toLowerCase();
  if (!owner || owner !== wallet.toLowerCase()) {
    throw new ProvenanceError(403, "Only the listing's creator can change its provenance.");
  }
}

function relationView(row: any) {
  return {
    promptId: String(row.promptId),
    relatedPromptId: String(row.relatedPromptId),
    kind: row.kind as ProvenanceKind,
    origin: row.origin as ProvenanceOrigin,
    createdAt: row.createdAt,
  };
}

/**
 * Records that `promptId` derives from `relatedPromptId`. Only the creator of
 * `promptId` may declare it. A backfilled relation for the same pair is
 * confirmed (and re-kinded) by the declaration.
 */
export async function declareRelation(input: {
  promptId: string;
  relatedPromptId: unknown;
  kind: unknown;
  wallet: string;
}) {
  const { promptId, relatedPromptId, kind, wallet } = input;
  if (!isPromptId(promptId) || !isPromptId(relatedPromptId)) {
    throw new ProvenanceError(400, "promptId and relatedPromptId must be on-chain prompt ids.");
  }
  if (!PROVENANCE_KINDS.includes(kind as ProvenanceKind)) {
    throw new ProvenanceError(400, `kind must be one of: ${PROVENANCE_KINDS.join(", ")}`);
  }

  await assertCreator(promptId, wallet);
  if (!(await Prompt.exists({ onChainId: relatedPromptId }))) {
    throw new ProvenanceError(404, "The related prompt does not exist.");
  }

  const existing: any = await PromptRelation.findOne({ promptId, relatedPromptId }).lean();
  if (existing?.origin === "creator") {
    throw new ProvenanceError(409, "This relationship is already recorded.");
  }
  if (kind === "parent") {
    const otherParent = await PromptRelation.exists({
      promptId,
      kind: "parent",
      relatedPromptId: { $ne: relatedPromptId },
    });
    if (otherParent) throw new ProvenanceError(409, "This prompt already has a parent listing.");
  }
  await assertNoCycle(promptId, relatedPromptId);

  const saved: any = await PromptRelation.findOneAndUpdate(
    { promptId, relatedPromptId },
    { $set: { kind, origin: "creator", declaredBy: wallet.toLowerCase() } },
    { upsert: true, new: true },
  ).lean();

  // Two declarations racing in opposite directions can each pass the check
  // above; re-check with the edge in place and back out if a cycle slipped in.
  const { edges } = await walkAncestors(relatedPromptId);
  if (edges.some((edge) => edge.relatedPromptId === promptId)) {
    await PromptRelation.deleteOne({ _id: saved._id });
    throw new ProvenanceError(409, "This relationship would create a provenance cycle.");
  }

  return relationView(saved);
}

export async function removeRelation(input: {
  promptId: string;
  relatedPromptId: string;
  wallet: string;
}) {
  if (!isPromptId(input.promptId) || !isPromptId(input.relatedPromptId)) {
    throw new ProvenanceError(400, "Invalid prompt id.");
  }
  await assertCreator(input.promptId, input.wallet);
  const result = await PromptRelation.deleteOne({
    promptId: input.promptId,
    relatedPromptId: input.relatedPromptId,
  });
  if (result.deletedCount !== 1) throw new ProvenanceError(404, "Relationship not found.");
}

export type ProvenanceFlagType =
  | "unconfirmed_attribution"
  | "undeclared_similarity"
  | "cross_creator_parent"
  | "deep_fork_chain";

export interface ProvenanceFlag {
  type: ProvenanceFlagType;
  promptId: string;
  relatedPromptIds: string[];
  detail: string;
}

const FLAG_ORDER: ProvenanceFlagType[] = [
  "cross_creator_parent",
  "deep_fork_chain",
  "undeclared_similarity",
  "unconfirmed_attribution",
];

async function ownerIds(promptIds: string[]): Promise<Map<string, string>> {
  const docs: any[] = promptIds.length
    ? await Prompt.find({ onChainId: { $in: promptIds } }).select("onChainId owner").lean()
    : [];
  return new Map(docs.map((doc) => [String(doc.onChainId), String(doc.owner)]));
}

/**
 * Moderation view (#753): suspicious fork chains and attribution conflicts
 * among the most recently changed relations.
 */
export async function getProvenanceFlags(limit = 100): Promise<ProvenanceFlag[]> {
  const flags: ProvenanceFlag[] = [];

  const [backfilled, similar, parents, forks] = await Promise.all([
    PromptRelation.find({ origin: "backfill" }).sort({ updatedAt: -1 }).limit(limit).lean(),
    Prompt.find({
      similarityFlag: "highly_similar",
      similarTo: { $ne: null },
      onChainId: { $ne: null },
    })
      .select("onChainId similarTo")
      .sort({ similarityCheckedAt: -1 })
      .limit(limit)
      .lean(),
    PromptRelation.find({ kind: "parent" }).sort({ updatedAt: -1 }).limit(limit).lean(),
    PromptRelation.find({ kind: { $in: ["fork", "remix"] } })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean(),
  ]);

  for (const row of backfilled as any[]) {
    flags.push({
      type: "unconfirmed_attribution",
      promptId: String(row.promptId),
      relatedPromptIds: [String(row.relatedPromptId)],
      detail: "Migrated from similarity detection; the creator has not confirmed it.",
    });
  }

  // Listings detected as copies that declare no relation to what they copy.
  if (similar.length > 0) {
    const declared: any[] = await PromptRelation.find({
      $or: (similar as any[]).map((p) => ({
        promptId: String(p.onChainId),
        relatedPromptId: String(p.similarTo),
      })),
    })
      .select("promptId relatedPromptId")
      .lean();
    const pairs = new Set(declared.map((r) => `${r.promptId}|${r.relatedPromptId}`));
    for (const p of similar as any[]) {
      if (!pairs.has(`${p.onChainId}|${p.similarTo}`)) {
        flags.push({
          type: "undeclared_similarity",
          promptId: String(p.onChainId),
          relatedPromptIds: [String(p.similarTo)],
          detail: "Highly similar to an earlier listing but declares no relationship to it.",
        });
      }
    }
  }

  // A "parent" is the creator's own earlier edition; a parent owned by someone
  // else is an authorship claim worth reviewing (or a completed transfer).
  if (parents.length > 0) {
    const owners = await ownerIds([
      ...new Set((parents as any[]).flatMap((r) => [String(r.promptId), String(r.relatedPromptId)])),
    ]);
    for (const row of parents as any[]) {
      const child = owners.get(String(row.promptId));
      const parent = owners.get(String(row.relatedPromptId));
      if (child && parent && child !== parent) {
        flags.push({
          type: "cross_creator_parent",
          promptId: String(row.promptId),
          relatedPromptIds: [String(row.relatedPromptId)],
          detail: "Declares a parent listing owned by a different creator.",
        });
      }
    }
  }

  // Long fork/remix chains passing through several creators.
  const forkLoader = relationLoader(["fork", "remix"]);
  for (const childId of [...new Set((forks as any[]).map((r) => String(r.promptId)))]) {
    const { edges } = await walkAncestors(childId, forkLoader);
    const depth = Math.max(0, ...edges.map((edge) => edge.depth));
    if (depth < SUSPICIOUS_FORK_CHAIN_DEPTH) continue;
    const chain = [...new Set(edges.map((edge) => edge.relatedPromptId))];
    const owners = await ownerIds([childId, ...chain]);
    if (new Set(owners.values()).size < 2) continue;
    flags.push({
      type: "deep_fork_chain",
      promptId: childId,
      relatedPromptIds: chain.sort(byNumericId),
      detail: `Fork/remix chain ${depth} levels deep across ${new Set(owners.values()).size} creators.`,
    });
  }

  return flags.sort(
    (a, b) =>
      FLAG_ORDER.indexOf(a.type) - FLAG_ORDER.indexOf(b.type) || byNumericId(a.promptId, b.promptId),
  );
}

/**
 * Migration/backfill for legacy prompt records (#753): listings that
 * similarity detection flagged as highly similar to an earlier listing get an
 * unconfirmed `source` relation (origin "backfill"). Idempotent; skips
 * self-references, missing or newer "sources", and anything that would close
 * a cycle. Legacy documents may store `onChainId` as a number, so lookups
 * accept both representations.
 */
export async function backfillProvenanceFromSimilarity(
  db: mongoose.mongo.Db,
): Promise<{ created: number; skipped: number }> {
  const prompts = db.collection("prompts");
  const relations = db.collection("promptrelations");

  await relations.createIndex({ promptId: 1, relatedPromptId: 1 }, { unique: true });
  await relations.createIndex({ relatedPromptId: 1, kind: 1 });
  await relations.createIndex({ origin: 1, updatedAt: -1 });

  const rawLoader: ParentLoader = async (promptIds) =>
    (await relations
      .find({ promptId: { $in: promptIds } })
      .project({ promptId: 1, relatedPromptId: 1, kind: 1, origin: 1 })
      .toArray()) as unknown as RelationEdge[];

  const candidates = prompts
    .find(
      { similarityFlag: "highly_similar", similarTo: { $ne: null }, onChainId: { $ne: null } },
      { projection: { onChainId: 1, similarTo: 1, createdAt: 1 } },
    )
    .sort({ createdAt: -1 });

  let created = 0;
  let skipped = 0;
  for await (const doc of candidates) {
    const promptId = String(doc.onChainId);
    const relatedPromptId = String(doc.similarTo);
    if (!isPromptId(promptId) || !isPromptId(relatedPromptId) || promptId === relatedPromptId) {
      skipped += 1;
      continue;
    }

    const related = await prompts.findOne(
      { onChainId: { $in: [relatedPromptId, Number(relatedPromptId)] } },
      { projection: { createdAt: 1 } },
    );
    // A derivative cannot predate what it derives from.
    if (!related || (doc.createdAt && related.createdAt && related.createdAt > doc.createdAt)) {
      skipped += 1;
      continue;
    }

    try {
      await assertNoCycle(promptId, relatedPromptId, rawLoader);
    } catch {
      skipped += 1;
      continue;
    }

    const now = new Date();
    const result = await relations.updateOne(
      { promptId, relatedPromptId },
      {
        $setOnInsert: {
          promptId,
          relatedPromptId,
          kind: "source",
          origin: "backfill",
          declaredBy: null,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount > 0) created += 1;
    else skipped += 1;
  }

  return { created, skipped };
}
