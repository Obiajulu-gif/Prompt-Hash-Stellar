#!/usr/bin/env python3
"""
PromptHash contract storage migration dry-run tool (#712).

Lets maintainers preview the effect of a contract upgrade on persistent
storage BEFORE any state is written or any upgrade is submitted. It reuses
the preflight baseline diff (scripts/preflight_upgrade.py) and classifies
every detected interface/storage change into one of three migration classes:

  no-op         — No behavioural/storage change detected (clean).
  additive      — New keys, functions, events or variants added. Existing
                  records and indexes are untouched; safe to upgrade.
  incompatible  — A removed or reshaped key/record/function/event. Requires
                  an explicit data migration and an ACK-BREAKING entry in
                  contracts/prompt-hash/MIGRATION.md.

The report includes affected storage-key families, expected write counts,
TTL implications and rollback notes, and it NEVER writes to chain state.

Usage:
    python3 scripts/dry-run-migration.py report
    python3 scripts/dry-run-migration.py report --json
    python3 scripts/dry-run-migration.py self-test
"""
import argparse
import json
import sys
from pathlib import Path

from preflight_upgrade import build_spec, spec_hash, REPO_ROOT, BASELINE_PATH


def _entries_mean_storage_family(entries):
    """Extract the storage-key family names from a data_type's entries.

    For a `#[contracttype] enum DataKey`, entries are enum variants like
    `Prompt(u64)`. We return each variant's first identifier as the storage
    family (e.g. "Prompt", "BuyerPrompts", "AllPrompts").
    """
    families = []
    for entry in entries:
        # entry normalized form: "Prompt(u64)" -> "Prompt"; "AllPrompts" -> "AllPrompts"
        name = entry.split("(")[0].strip().rstrip(",")
        if name:
            families.append(name)
    return families


def classify_change(baseline: dict, current: dict) -> dict:
    """Classify the diff between baseline and current spec.

    Returns a report object with `class`, `breakout`, `storage_families`,
    `expected_writes`, `sample_keys`, `risk_notes`, `rollback_notes`,
    `suppressed`. Mirrors preflight's breaking-change detection so both tools
    stay in lockstep.
    """
    breaking = []
    added_functions = []
    added_types = []
    added_variants = []
    added_events = []
    suppressed = []

    for name, sig in baseline.get("functions", {}).items():
        if name not in current.get("functions", {}):
            breaking.append(f"function `{name}` was removed from PromptHashTrait")
        elif current["functions"][name] != sig:
            breaking.append(f"function `{name}` signature changed")
    for name in current.get("functions", {}):
        if name not in baseline.get("functions", {}):
            added_functions.append(name)

    for name, code in baseline.get("errors", {}).items():
        if name not in current.get("errors", {}):
            breaking.append(f"Error variant `{name}` (={code}) was removed")
        elif current["errors"][name] != code:
            breaking.append(
                f"Error variant `{name}` discriminant changed"
            )
    for name in current.get("errors", {}):
        if name not in baseline.get("errors", {}):
            added_variants.append(f"Error::{name}")

    for type_name, entries in baseline.get("data_types", {}).items():
        current_entries = current.get("data_types", {}).get(type_name)
        if current_entries is None:
            breaking.append(f"type `{type_name}` was removed")
            continue
        current_set = set(current_entries)
        for entry in entries:
            if entry not in current_set:
                breaking.append(f"`{type_name}`: `{entry}` was removed or changed shape")
    for type_name in current.get("data_types", {}):
        if type_name not in baseline.get("data_types", {}):
            added_types.append(type_name)
        else:
            baseline_set = set(baseline["data_types"].get(type_name, []))
            for entry in current["data_types"].get(type_name, []):
                if entry not in baseline_set:
                    added_variants.append(f"{type_name}::{entry}")

    for name, fields in baseline.get("events", {}).items():
        current_fields = current.get("events", {}).get(name)
        if current_fields is None:
            breaking.append(f"event `{name}` was removed")
        elif current_fields != fields:
            breaking.append(f"event `{name}` field list changed")
    for name in current.get("events", {}):
        if name not in baseline.get("events", {}):
            added_events.append(name)

    # Storage families touched by breaking changes.
    storage_families = set()
    for change in breaking:
        # "`DataKey`: `Prompt(u64)` was removed or changed shape" -> Prompt
        if ":" in change.split("` was")[0] and "`" in change:
            kind = change.split("`")[1]
            fam = change.split("`")[3].split("(")[0]
            if kind == "DataKey":
                storage_families.add(fam)
    # Also treat removed data types as affected families.
    for type_name in baseline.get("data_types", {}):
        if type_name not in current.get("data_types", {}):
            storage_families.add(type_name)

    if breaking:
        classification = "incompatible"
    elif added_functions or added_types or added_variants or added_events:
        classification = "additive"
    else:
        classification = "no-op"

    return {
        "class": classification,
        "breaking": breaking,
        "added_functions": added_functions,
        "added_types": added_types,
        "added_variants": added_variants,
        "added_events": added_events,
        "storage_families": sorted(storage_families),
        "suppressed": suppressed,
    }


def ttl_notes(classification: str, family_count: int) -> list:
    if family_count == 0:
        return ["No persistent keys affected — TTL policy unchanged."]
    if classification == "additive":
        return [
            "New keys inherit the TTL policy of their family "
            "(see contracts/prompt-hash/src/ttl_policy.rs, get_ttl_for_key).",
            "Existing records/lifetimes are untouched.",
        ]
    return [
        "Removed or reshaped keys may retain stale TTL entries until the "
        "migration `remove`s them or `extend_key_ttl` is re-applied.",
        "Run a bounded `renew_critical_keys` sweep after the migration to "
        "normalise lifetimes.",
    ]


def rollback_notes(classification: str) -> list:
    if classification == "no-op":
        return ["No migration required; nothing to roll back."]
    if classification == "additive":
        return [
            "Additive changes are backward compatible; downgrade keeps the "
            "old Wasm hash live with no data rewrite.",
            "Keep the previous WASM_HASH recorded in deploy-manifests/ for "
            "a pure downgrade rollback.",
        ]
    return [
        "Incompatible changes are not reversible in place. Before shipping:",
        "  1. Snapshot canonical records (on-chain) and index state.",
        "  2. Acknowledge each ACK-BREAKING line in MIGRATION.md.",
        "  3. Ship the data migration in the SAME upgrade that changes the code.",
        "  4. Verify with scripts/verify.sh; be prepared to restore the "
        "snapshot if verification fails.",
    ]


def build_report(report: dict) -> dict:
    dc = report["class"]
    families = report["storage_families"]
    return {
        "dry_run": True,
        "wrote_state": False,
        "class": dc,
        "semantic_notes": {
            "breaking": report["breaking"],
            "added_functions": report["added_functions"],
            "added_types": report["added_types"],
            "added_variants": report["added_variants"],
            "added_events": report["added_events"],
        },
        "storage": {
            "affected_key_families": list(families),
            "family_count": len(families),
            "sample_keys": [f"{f}(<id>)" for f in sorted(families)[:5]],
        },
        "expected_writes": {
            "count": (
                len(report["breaking"])
                if dc == "incompatible"
                else len(families)
            ),
            "note": (
                "The migration must rewrite/replace every affected key family."
                if dc == "incompatible"
                else "No writes are required beyond the additive keys described."
            ),
        },
        "ttl_implications": ttl_notes(dc, len(families)),
        "rollback_notes": rollback_notes(dc),
        "recommendation": (
            "SAFE TO UPGRADE — no storage migration required."
            if dc == "no-op"
            else (
                "SAFE TO UPGRADE — additive only; existing records untouched."
                if dc == "additive"
                else "BLOCKED — incompatible storage change; complete MIGRATION.md "
                "ACK-BREAKING entries and a data migration before upgrading."
            )
        ),
    }


def cmd_report(args: argparse.Namespace) -> int:
    if not BASELINE_PATH.exists():
        print(
            f"No baseline found at {BASELINE_PATH.relative_to(REPO_ROOT)}. "
            "Run `python3 scripts/preflight_upgrade.py generate-baseline` once.",
            file=sys.stderr,
        )
        return 1

    baseline = json.loads(BASELINE_PATH.read_text())
    current = build_spec()
    report = build_report(classify_change(baseline, current))

    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print("=" * 72)
        print("PROMPTHASH CONTRACT MIGRATION DRY-RUN")
        print("=" * 72)
        print(f"dry-run: {report['dry_run']}   wrote_state: {report['wrote_state']}")
        print(f"baseline: {spec_hash(baseline)[:12]}  current: {spec_hash(current)[:12]}")
        print(f"class: {report['class']}")
        print(f"recommendation: {report['recommendation']}")
        print()
        print(f"storage families affected: {report['storage']['family_count']}")
        for key in report["storage"]["sample_keys"]:
            print(f"  - {key}")
        print()
        print("expected writes:")
        print(f"  count: {report['expected_writes']['count']}")
        print(f"  {report['expected_writes']['note']}")
        print()
        print("TTL implications:")
        for note in report["ttl_implications"]:
            print(f"  - {note}")
        print()
        print("rollback notes:")
        for note in report["rollback_notes"]:
            print(f"  - {note}")
        print()
        if report["semantic_notes"]["breaking"]:
            print("breaking changes:")
            for change in report["semantic_notes"]["breaking"]:
                print(f"  ! {change}")
        print()
    return 0


def cmd_self_test(_args: argparse.Namespace) -> int:
    """Offline tests covering no-op, additive, and incompatible migrations."""
    empty = {"functions": {}, "errors": {}, "data_types": {}, "events": {}}

    no_op = classify_change(empty, empty)
    assert no_op["class"] == "no-op", no_op
    assert no_op["breaking"] == []

    additive = classify_change(
        empty,
        {
            "functions": {"new_fn": "fn new_fn()"},
            "events": {"NewEvent": ["field"]},
            "data_types": {"DataKey": ["BrandNew(u64)"]},
        },
    )
    assert additive["class"] == "additive", additive
    assert additive["breaking"] == []

    baseline_keys = {"data_types": {"DataKey": ["Prompt(u64)", "AllPrompts"]}}
    removed_key = classify_change(
        baseline_keys,
        {"data_types": {"DataKey": ["AllPrompts"]}},
    )
    assert removed_key["class"] == "incompatible", removed_key
    assert "Prompt" in removed_key["storage_families"], removed_key

    reshaped = classify_change(
        {"data_types": {"Prompt": ["pub id: u64", "pub price: i128"]}},
        {"data_types": {"Prompt": ["pub id: u64", "pub price: String"]}},
    )
    assert reshaped["class"] == "incompatible", reshaped

    report = build_report(no_op)
    assert report["dry_run"] and not report["wrote_state"]
    assert report["recommendation"].startswith("SAFE")

    incompatible_report = build_report(removed_key)
    assert incompatible_report["recommendation"].startswith("BLOCKED")
    assert incompatible_report["expected_writes"]["count"] == len(
        removed_key["breaking"]
    )

    print("self-test OK: no-op, additive, and incompatible migrations classified correctly")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="PromptHash contract storage migration dry-run report."
    )
    sub = parser.add_subparsers(dest="command", required=True)
    report_parser = sub.add_parser(
        "report", help="Print a dry-run migration report for the current diff."
    )
    report_parser.add_argument(
        "--json", action="store_true", help="Emit the report as JSON."
    )
    sub.add_parser(
        "self-test",
        help="Run offline unit tests for no-op/additive/incompatible classification.",
    )
    args = parser.parse_args()
    if args.command == "self-test":
        return cmd_self_test(args)
    return cmd_report(args)


if __name__ == "__main__":
    sys.exit(main())