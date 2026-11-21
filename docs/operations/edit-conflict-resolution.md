# Conflict resolution for concurrent edits (#1170)

Optimistic concurrency already refuses a stale write: `updateWithVersionCheck`
matches on `version` and increments it, so exactly one of N writers wins. What
was missing is what the losing writer does next. This change adds a
deterministic three-way merge for text edits.

## Flow

```
both editors load version V
        │
   mine (V → V+1)          theirs (V → V+1)
        └──────────┬──────────────┘
                   ▼
 POST /api/concurrency/conflicts/resolve
   { ownerWallet, base, mine, theirs, strategy?, resolutions? }
                   │
      ┌────────────┴─────────────┐
      ▼                          ▼
 status "clean"/"merged"     status "conflict"
 apply `content` with the    show `conflicts[]`
 expected version (CAS)      → retry with resolutions[]
```

`base` is the version both sides started from. `mine` and `theirs` carry their
own optimistic versions (`>= base.version`). The endpoint is advisory: it
returns merged bytes and the client still writes them through the existing
version compare-and-swap, so a third concurrent writer is still detected.

## Merge semantics

Line-based diff3 (LCS), no external dependency:

| Situation | Result |
| --- | --- |
| Neither side changed | `clean`, content = base |
| One side changed | `merged`, that side wins |
| Both changed different regions | `merged`, both applied |
| Both made the same change | `merged`, applied once |
| Both changed the same region differently | `conflict`, marker block |
| Insertions at the same caret, different text | `conflict` |
| Insertion at the boundary of the other side's replacement | both applied deterministically |

Conflict markers are GitHub-compatible and name the versions:

```
    <<<<<<< mine (v5)
    MINE
    =======
    THEIRS
    >>>>>>> theirs (v6)
```

Each entry in `conflicts[]` carries `index`, `baseStartLine`/`baseEndLine`
(1-based, for display), `mineLines`, `theirsLines`, and `resolvedWith`.

## Resolving and retrying

- `strategy: "manual"` (default) — leave markers, `status: "conflict"`.
- `strategy: "prefer_mine"` / `"prefer_theirs"` — resolve every conflict.
- `resolutions: [{ index, choice: "mine" | "theirs" }]` — resolve individual
  conflicts. This is the retry path: call once, let the author choose, call
  again with the same `base`/`mine`/`theirs` plus choices. The merge is pure and
  deterministic, so both calls produce the same conflict indices.
- A partial resolution returns `status: "conflict"` with only the unresolved
  markers still present.

## Authorization

`POST /api/concurrency/conflicts/resolve` is mounted with
`requireWalletSession((req) => req.body.ownerWallet)`. The session must be a
valid, unrevoked wallet session for that wallet. The controller additionally
requires `sessionWallet` to equal `ownerWallet` (case-insensitive). Changing
`ownerWallet` in the body does not help: the session is bound to it.

| Condition | Response |
| --- | --- |
| No/invalid wallet session | 401 by middleware |
| No `ownerWallet` or session wallet | 401 `authorization_required` |
| Session wallet ≠ owner | 403 `not_edit_owner` |
| Unknown strategy / bad version / oversized | 400 with a stable code + remedy |

## Failure modes

| Input | Behaviour |
| --- | --- |
| Non-string content | 400 `invalid_content` |
| NUL byte | 400 `invalid_content` (not editable text) |
| > 256 KiB per side | 400 `too_large` |
| > 2,000 lines per side | 400 `too_many_lines` |
| `mine.version` or `theirs.version` < `base.version` | 400 `invalid_version` |
| Non-integer version | 400 `invalid_version` |
| Merged output > 512 KiB | 400 `merged_output_too_large` |
| `resolutions[].index` out of range | 400 `invalid_resolution` |

## Edge cases

- CRLF input: splitting is on `\n`, so `\r` stays part of each line and is
  preserved byte-for-byte.
- Empty files: an empty side is one empty line; merges and conflicts behave
  normally.
- Adjacent edits (mine ends exactly where theirs begins) do **not** conflict.
- The same caret insertion from both sides conflicts only when the text differs.
- A conflict whose chosen result happens to contain a marker-shaped line is
  written verbatim; indices, not marker scanning, are the contract.
- Large files are rejected rather than silently truncated.

## Rollback

No persistence and no schema change:

1. Remove the `/api/concurrency/conflicts` mount and the
   `editConflictRouter` import from `server.ts`.
2. Delete the service/controller/route files. Existing version-check behaviour
   is untouched, so stale writes still return 409 as before.
3. No data migration or backfill is needed: merged content only exists in the
   response and is written by the client's normal update path.

## Preserved contracts

- `updateWithVersionCheck` and `UpdateWithVersionCheck` are unchanged; stale
  writes still return 409 with `currentVersion`.
- The legacy `concurrencyRouter` remains unmounted, so this change does not
  expose its endpoint.
- Conflict resolution is additive: callers that never call the new route see no
  behavioural change.

## Tests

`server/src/tests/editConflicts.test.ts` covers clean one-sided and
non-overlapping merges, identical edits, overlapping and same-point conflicts,
multiple conflicts, marker shape and base line numbers, both strategy modes,
per-conflict retry (including partial resolution), determinism, every
validation failure, owner authorization, and the HTTP 200/400/401/403 contract.
