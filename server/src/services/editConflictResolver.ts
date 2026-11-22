/**
 * Conflict resolution for concurrent edits (#1170).
 *
 * The optimistic-concurrency primitive in `models/VersionedRecord.ts` rejects
 * a stale write with a version conflict, but it gives an editor nothing to do
 * next. This module turns that dead end into a resolution:
 *
 *   base   = the version both editors started from
 *   mine   = the caller's edit
 *   theirs = the other edit
 *
 * It performs a line-based three-way merge. Non-overlapping edits from both
 * sides are applied together; overlapping edits with identical results are
 * collapsed; overlapping edits with different results become explicit conflict
 * regions. Conflicts can be accepted as-is (markers, `manual`), resolved
 * wholesale with `prefer_mine`/`prefer_theirs`, or resolved one by one by
 * index on a retry — which is what lets a UI show both versions and let the
 * author choose.
 *
 * The merge is pure and deterministic: the same input always produces the same
 * bytes, so a client can safely retry with the same `base` after resolving.
 * Nothing is persisted here; the caller applies the merged content with the
 * existing version compare-and-swap.
 *
 * Authorization is enforced separately: only the wallet that owns the edit may
 * resolve it (`assertCanResolveEdits`). The HTTP layer takes the actor from the
 * verified wallet session, never from the body.
 */

export const MAX_EDIT_BYTES = 256 * 1024;
export const MAX_EDIT_LINES = 2_000;
export const MAX_MERGED_BYTES = 512 * 1024;

export type EditMergeStrategy = "manual" | "prefer_mine" | "prefer_theirs";
export type ConflictChoice = "mine" | "theirs";

export type EditConflictErrorCode =
  | "invalid_content"
  | "too_large"
  | "too_many_lines"
  | "invalid_version"
  | "invalid_strategy"
  | "invalid_resolution"
  | "authorization_required"
  | "not_edit_owner"
  | "merged_output_too_large";

export class EditConflictError extends Error {
  constructor(
    readonly code: EditConflictErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EditConflictError";
  }
}

export interface EditVersion {
  content: string;
  /** Optimistic version the content was based on. */
  version: number;
}

export interface EditConflict {
  /** Zero-based index used by `resolutions`. */
  index: number;
  /** 1-based line span in `base` that the conflict replaces. */
  baseStartLine: number;
  baseEndLine: number;
  mineLines: string[];
  theirsLines: string[];
  resolvedWith: ConflictChoice | null;
}

export interface EditConflictResolution {
  index: number;
  choice: ConflictChoice;
}

export interface ResolveEditConflictInput {
  base: EditVersion;
  mine: EditVersion;
  theirs: EditVersion;
  strategy?: EditMergeStrategy;
  resolutions?: EditConflictResolution[];
}

export interface EditConflictResolutionResult {
  status: "clean" | "merged" | "conflict";
  resolved: boolean;
  content: string;
  conflicts: EditConflict[];
  /** True when at least one side changed the base content. */
  changed: boolean;
  stats: {
    baseLines: number;
    mineLines: number;
    theirsLines: number;
    conflictCount: number;
    strategy: EditMergeStrategy;
  };
}

interface Hunk {
  /** Replace base[start, end) with `lines`. */
  start: number;
  end: number;
  lines: string[];
}

interface HunkGroup {
  /** Union span over `base` covered by every hunk in the group. */
  start: number;
  end: number;
  mine: Hunk[];
  theirs: Hunk[];
}

function assertContent(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new EditConflictError("invalid_content", `${label}.content must be a string.`);
  }
  if (Buffer.byteLength(value, "utf8") > MAX_EDIT_BYTES) {
    throw new EditConflictError(
      "too_large",
      `${label}.content exceeds ${MAX_EDIT_BYTES} bytes.`,
    );
  }
  if (value.includes("\u0000")) {
    throw new EditConflictError(
      "invalid_content",
      `${label}.content contains a NUL byte and is not editable text.`,
    );
  }
  return value;
}

function assertVersion(value: unknown, label: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new EditConflictError(
      "invalid_version",
      `${label}.version must be an integer >= ${minimum}.`,
    );
  }
  return value;
}

function splitLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > MAX_EDIT_LINES) {
    throw new EditConflictError(
      "too_many_lines",
      `content exceeds the ${MAX_EDIT_LINES}-line merge limit.`,
    );
  }
  return lines;
}

/**
 * Longest-common-subsequence diff of `other` against `base`, expressed as
 * replacement hunks over base line indices. Iterative DP bounded by
 * {@link MAX_EDIT_LINES} so the table stays small.
 */
function diffHunks(base: string[], other: string[]): Hunk[] {
  const n = base.length;
  const m = other.length;
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * width + j] =
        base[i] === other[j]
          ? dp[(i + 1) * width + (j + 1)] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
    }
  }

  const hunks: Hunk[] = [];
  let hunk: Hunk | null = null;
  let i = 0;
  let j = 0;

  const flush = () => {
    if (hunk) {
      hunks.push(hunk);
      hunk = null;
    }
  };

  while (i < n && j < m) {
    if (base[i] === other[j]) {
      flush();
      i += 1;
      j += 1;
      continue;
    }
    if (!hunk) hunk = { start: i, end: i, lines: [] };
    if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      i += 1;
      hunk.end = i;
    } else {
      hunk.lines.push(other[j]);
      j += 1;
    }
  }

  if (i < n || j < m || hunk) {
    if (!hunk) hunk = { start: i, end: i, lines: [] };
    while (i < n) {
      i += 1;
      hunk.end = i;
    }
    while (j < m) {
      hunk.lines.push(other[j]);
      j += 1;
    }
    hunks.push(hunk);
  }

  return hunks;
}

/** True when two replacement ranges touch or overlap on the same base text. */
function hunksCollide(a: Hunk, b: Hunk): boolean {
  if (a.start < b.end && b.start < a.end) return true;
  // Two insertions at the same caret are ambiguous unless identical.
  return a.start === a.end && b.start === b.end && a.start === b.start;
}

/**
 * Cluster hunks into conflict groups over transitive overlap.
 *
 * A single replacement on one side can overlap several hunks on the other
 * side. The whole overlap is one group spanning the union, so an edit can
 * never leak past the conflict and unchanged base context between hunks is
 * kept. Hunks are sorted by base position, so comparing each newcomer with
 * the group's members finds the full transitive closure in one pass.
 */
function groupHunks(mine: Hunk[], theirs: Hunk[]): HunkGroup[] {
  const all: Array<{ side: "mine" | "theirs"; hunk: Hunk }> = [
    ...mine.map((hunk) => ({ side: "mine" as const, hunk })),
    ...theirs.map((hunk) => ({ side: "theirs" as const, hunk })),
  ].sort((a, b) => a.hunk.start - b.hunk.start || a.hunk.end - b.hunk.end);

  const groups: HunkGroup[] = [];
  for (const entry of all) {
    const last = groups[groups.length - 1];
    const collidesWithGroup =
      last !== undefined &&
      [...last.mine, ...last.theirs].some((hunk) => hunksCollide(entry.hunk, hunk));

    if (last && collidesWithGroup) {
      last.start = Math.min(last.start, entry.hunk.start);
      last.end = Math.max(last.end, entry.hunk.end);
      last[entry.side].push(entry.hunk);
    } else {
      groups.push({
        start: entry.hunk.start,
        end: entry.hunk.end,
        mine: entry.side === "mine" ? [entry.hunk] : [],
        theirs: entry.side === "theirs" ? [entry.hunk] : [],
      });
    }
  }

  return groups;
}

/**
 * Rebuild one side's content across a group's full union span by applying all
 * of that side's hunks in base order and keeping untouched base lines in
 * between. Without this, a group holding several hunks would only expose the
 * first one and drop the rest of that side's edit.
 */
function reconstructSide(base: string[], group: HunkGroup, side: "mine" | "theirs"): string[] {
  const hunks = group[side];
  if (hunks.length === 0) return [];

  const lines: string[] = [];
  let cursor = group.start;
  for (const hunk of [...hunks].sort((a, b) => a.start - b.start || a.end - b.end)) {
    for (let index = cursor; index < hunk.start; index += 1) lines.push(base[index]);
    lines.push(...hunk.lines);
    cursor = Math.max(cursor, hunk.end);
  }
  for (let index = cursor; index < group.end; index += 1) lines.push(base[index]);
  return lines;
}

function sameLines(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

function conflictMarker(
  conflict: Omit<EditConflict, "index" | "resolvedWith">,
  mineVersion: number,
  theirsVersion: number,
): string[] {
  return [
    `<<<<<<< mine (v${mineVersion})`,
    ...conflict.mineLines,
    "=======",
    ...conflict.theirsLines,
    `>>>>>>> theirs (v${theirsVersion})`,
  ];
}

/**
 * Validate, merge and resolve. Throws {@link EditConflictError} for malformed
 * input; a genuine content conflict is a successful result with
 * `status: "conflict"`, not an exception.
 */
export function resolveEditConflict(
  input: ResolveEditConflictInput,
): EditConflictResolutionResult {
  const baseContent = assertContent(input.base?.content, "base");
  const mineContent = assertContent(input.mine?.content, "mine");
  const theirsContent = assertContent(input.theirs?.content, "theirs");

  const baseVersion = assertVersion(input.base?.version, "base", 0);
  const mineVersion = assertVersion(input.mine?.version, "mine", baseVersion);
  const theirsVersion = assertVersion(input.theirs?.version, "theirs", baseVersion);

  const strategy = input.strategy ?? "manual";
  if (!["manual", "prefer_mine", "prefer_theirs"].includes(strategy)) {
    throw new EditConflictError(
      "invalid_strategy",
      "strategy must be `manual`, `prefer_mine` or `prefer_theirs`.",
    );
  }

  const base = splitLines(baseContent);
  const mine = splitLines(mineContent);
  const theirs = splitLines(theirsContent);

  const mineHunks = diffHunks(base, mine);
  const theirsHunks = diffHunks(base, theirs);
  const groups = groupHunks(mineHunks, theirsHunks);

  const conflicts: EditConflict[] = [];
  const out: string[] = [];
  let cursor = 0;

  for (const group of groups) {
    for (let index = cursor; index < group.start; index += 1) out.push(base[index]);

    const mineLines = group.mine.length > 0 ? reconstructSide(base, group, "mine") : null;
    const theirsLines =
      group.theirs.length > 0 ? reconstructSide(base, group, "theirs") : null;

    if (mineLines && theirsLines) {
      if (sameLines(mineLines, theirsLines)) {
        out.push(...mineLines);
      } else {
        const conflict = {
          index: conflicts.length,
          baseStartLine: group.start + 1,
          baseEndLine: group.end + 1,
          mineLines,
          theirsLines,
        };
        conflicts.push({ ...conflict, resolvedWith: null });
        out.push(...conflictMarker(conflict, mineVersion, theirsVersion));
      }
    } else if (mineLines) {
      out.push(...mineLines);
    } else if (theirsLines) {
      out.push(...theirsLines);
    }

    cursor = Math.max(cursor, group.end);
  }
  for (let index = cursor; index < base.length; index += 1) out.push(base[index]);

  // Apply resolutions. Explicit per-conflict choices win over the strategy.
  const requested = new Map<number, ConflictChoice>();
  for (const resolution of input.resolutions ?? []) {
    if (
      !resolution ||
      !Number.isInteger(resolution.index) ||
      (resolution.choice !== "mine" && resolution.choice !== "theirs")
    ) {
      throw new EditConflictError(
        "invalid_resolution",
        "Each resolution needs an integer index and a choice of `mine` or `theirs`.",
      );
    }
    if (resolution.index < 0 || resolution.index >= conflicts.length) {
      throw new EditConflictError(
        "invalid_resolution",
        `resolution.index ${resolution.index} is out of range for ${conflicts.length} conflict(s).`,
      );
    }
    requested.set(resolution.index, resolution.choice);
  }

  const resolvedConflicts = conflicts.map((conflict) => {
    let choice: ConflictChoice | null = requested.get(conflict.index) ?? null;
    if (!choice && strategy === "prefer_mine") choice = "mine";
    if (!choice && strategy === "prefer_theirs") choice = "theirs";
    if (choice) {
      conflict.resolvedWith = choice;
      const chosen = choice === "mine" ? conflict.mineLines : conflict.theirsLines;
      const marker = conflictMarker(conflict, mineVersion, theirsVersion);
      const at = findMarkerStart(out, marker);
      if (at >= 0) out.splice(at, marker.length, ...chosen);
    }
    return conflict;
  });

  const content = out.join("\n");
  if (Buffer.byteLength(content, "utf8") > MAX_MERGED_BYTES) {
    throw new EditConflictError(
      "merged_output_too_large",
      `Merged content exceeds ${MAX_MERGED_BYTES} bytes.`,
    );
  }

  const unresolved = resolvedConflicts.filter((conflict) => conflict.resolvedWith === null).length;
  const changed = mineContent !== baseContent || theirsContent !== baseContent;

  return {
    status: unresolved > 0 ? "conflict" : changed ? "merged" : "clean",
    resolved: unresolved === 0,
    content,
    conflicts: resolvedConflicts,
    changed,
    stats: {
      baseLines: base.length,
      mineLines: mine.length,
      theirsLines: theirs.length,
      conflictCount: resolvedConflicts.length,
      strategy,
    },
  };
}

/**
 * Locate a conflict marker block in the assembled output. Markers are
 * generated uniquely per conflict, so a linear scan is exact and avoids
 * tracking output offsets through every preceding hunk.
 */
function findMarkerStart(out: string[], marker: string[]): number {
  const first = marker[0];
  outer: for (let index = 0; index <= out.length - marker.length; index += 1) {
    if (out[index] !== first) continue;
    for (let offset = 1; offset < marker.length; offset += 1) {
      if (out[index + offset] !== marker[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

/**
 * Only the wallet that owns the edit may resolve its conflicts. Wallets are
 * compared case-insensitively (Stellar addresses are canonically uppercase).
 */
export function assertCanResolveEdits(actorWallet: unknown, ownerWallet: unknown): void {
  const actor = typeof actorWallet === "string" ? actorWallet.trim().toUpperCase() : "";
  const owner = typeof ownerWallet === "string" ? ownerWallet.trim().toUpperCase() : "";
  if (!actor) {
    throw new EditConflictError(
      "authorization_required",
      "An authenticated wallet is required to resolve edit conflicts.",
    );
  }
  if (!owner) {
    throw new EditConflictError(
      "authorization_required",
      "The edit owner wallet is required to resolve edit conflicts.",
    );
  }
  if (actor !== owner) {
    throw new EditConflictError(
      "not_edit_owner",
      "Only the wallet that owns this edit may resolve its conflicts.",
    );
  }
}

/** Human-readable remedy for each error code (safe to return to callers). */
export function editConflictRemedy(code: EditConflictErrorCode): string {
  switch (code) {
    case "invalid_content":
      return "Provide text content for base, mine and theirs.";
    case "too_large":
      return `Keep each side under ${MAX_EDIT_BYTES} bytes.`;
    case "too_many_lines":
      return `Keep each side under ${MAX_EDIT_LINES} lines.`;
    case "invalid_version":
      return "Send the integer version each side was based on; mine and theirs must be at least base.version.";
    case "invalid_strategy":
      return "Use `manual`, `prefer_mine` or `prefer_theirs`.";
    case "invalid_resolution":
      return "Resolve conflicts using the index returned in `conflicts` and a choice of `mine` or `theirs`.";
    case "authorization_required":
      return "Sign in with the wallet that owns the edit.";
    case "not_edit_owner":
      return "Only the wallet that owns this edit may resolve its conflicts.";
    case "merged_output_too_large":
      return `The merged result exceeds ${MAX_MERGED_BYTES} bytes; split the edit.`;
  }
}
