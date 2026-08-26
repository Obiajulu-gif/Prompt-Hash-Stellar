#!/usr/bin/env python3
"""
Upgrade preflight gate for the PromptHash Soroban contract (#435).

Diffs the contract's public interface (trait functions, storage-key/record
encodings, error codes, and contract events) against a checked-in baseline
snapshot to catch breaking storage/ABI changes before an upgrade is
submitted, validates the deployment environment, and — on a full
(non self-check) run — writes a deployment manifest recording exactly what
was checked, signing it if a signing key is configured.

Usage:
    python3 scripts/preflight_upgrade.py generate-baseline
    python3 scripts/preflight_upgrade.py check --self-check
    NETWORK=testnet CONTRACT_ID=C... ADMIN_ALIAS=admin \\
        python3 scripts/preflight_upgrade.py check
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
CONTRACT_SRC = REPO_ROOT / "contracts" / "prompt-hash" / "src"
TYPES_RS = CONTRACT_SRC / "types.rs"
EVENTS_RS = CONTRACT_SRC / "events.rs"
BASELINE_PATH = REPO_ROOT / "contracts" / "prompt-hash" / "spec-baseline.json"
MIGRATION_NOTES_PATH = REPO_ROOT / "contracts" / "prompt-hash" / "MIGRATION.md"
MANIFEST_DIR = REPO_ROOT / "deploy-manifests"


def normalize_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _strip_comments_and_attrs(block: str) -> str:
    lines = []
    for line in block.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("//") or stripped.startswith("#["):
            continue
        lines.append(stripped)
    return "\n".join(lines)


def _extract_block(text: str, header_pattern: str) -> Optional[str]:
    match = re.search(header_pattern + r"\s*\{", text)
    if not match:
        return None
    start = match.end()
    end = text.index("}", start)
    return text[start:end]


def _extract_all_type_blocks(text: str) -> dict:
    """Returns {name: {'kind', 'entries'}} for every #[contracttype] enum/struct,
    plus the #[contracterror] enum under the reserved key '__error__'."""
    types: dict = {}
    for match in re.finditer(
        r"#\[contract(type|error)\][^;]*?pub\s+(enum|struct)\s+(\w+)\s*\{",
        text,
        re.DOTALL,
    ):
        annotation, kind, name = match.groups()
        body_start = match.end()
        body_end = text.index("}", body_start)
        body = _strip_comments_and_attrs(text[body_start:body_end])
        entries = [normalize_ws(e) for e in body.split(",") if normalize_ws(e)]
        key = "__error__" if annotation == "error" else name
        types[key] = {"kind": kind, "entries": entries}
    return types


def extract_trait_functions(text: str) -> dict:
    body = _extract_block(text, r"pub\s+trait\s+PromptHashTrait")
    if body is None:
        raise SystemExit("Could not find `pub trait PromptHashTrait` in types.rs")

    functions: dict = {}
    for fragment in body.split(";"):
        cleaned = _strip_comments_and_attrs(fragment)
        if "fn " not in cleaned:
            continue
        cleaned = normalize_ws(cleaned[cleaned.index("fn "):])
        name_match = re.match(r"fn\s+(\w+)", cleaned)
        if not name_match:
            continue
        functions[name_match.group(1)] = cleaned
    return functions


def extract_events(text: str) -> dict:
    events: dict = {}
    for match in re.finditer(r"#\[contractevent\]\s*struct\s+(\w+)\s*\{", text):
        name = match.group(1)
        body_start = match.end()
        body_end = text.index("}", body_start)
        body = _strip_comments_and_attrs(text[body_start:body_end])
        events[name] = [normalize_ws(f) for f in body.split(",") if normalize_ws(f)]
    return events


def build_spec() -> dict:
    types_text = TYPES_RS.read_text()
    events_text = EVENTS_RS.read_text()

    type_blocks = _extract_all_type_blocks(types_text)
    error_entries = type_blocks.pop("__error__", {"entries": []})["entries"]
    errors = {}
    for entry in error_entries:
        name, _, value = entry.partition("=")
        errors[name.strip()] = value.strip().rstrip(",")

    return {
        "functions": extract_trait_functions(types_text),
        "errors": errors,
        "data_types": {name: info["entries"] for name, info in type_blocks.items()},
        "events": extract_events(events_text),
    }


def spec_hash(spec: dict) -> str:
    return hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()


def diff_spec(baseline: dict, current: dict) -> list:
    """Breaking-change descriptions. Additions (new fn/error/type/event/variant) are never breaking."""
    breaking = []

    for name, sig in baseline.get("functions", {}).items():
        if name not in current.get("functions", {}):
            breaking.append(f"function `{name}` was removed from PromptHashTrait")
        elif current["functions"][name] != sig:
            breaking.append(f"function `{name}` signature changed")

    for name, code in baseline.get("errors", {}).items():
        if name not in current.get("errors", {}):
            breaking.append(f"Error variant `{name}` (={code}) was removed")
        elif current["errors"][name] != code:
            breaking.append(
                f"Error variant `{name}` discriminant changed ({code} -> {current['errors'][name]})"
            )

    for type_name, entries in baseline.get("data_types", {}).items():
        current_entries = current.get("data_types", {}).get(type_name)
        if current_entries is None:
            breaking.append(f"type `{type_name}` was removed")
            continue
        current_set = set(current_entries)
        for entry in entries:
            if entry not in current_set:
                breaking.append(f"`{type_name}`: `{entry}` was removed or changed shape")

    for name, fields in baseline.get("events", {}).items():
        current_fields = current.get("events", {}).get(name)
        if current_fields is None:
            breaking.append(f"event `{name}` was removed")
        elif current_fields != fields:
            breaking.append(f"event `{name}` field list changed")

    return breaking


def cmd_generate_baseline(_args: argparse.Namespace) -> int:
    spec = build_spec()
    BASELINE_PATH.write_text(json.dumps(spec, indent=2, sort_keys=True) + "\n")
    print(f"Wrote {BASELINE_PATH.relative_to(REPO_ROOT)} ({spec_hash(spec)[:12]})")
    return 0


def _migration_notes_cover(breaking: list) -> Optional[str]:
    if not MIGRATION_NOTES_PATH.exists():
        return None
    content = MIGRATION_NOTES_PATH.read_text()
    acks = re.findall(r"ACK-BREAKING:\s*(.+)", content)
    if not acks:
        return None
    unacknowledged = [
        change for change in breaking if not any(change in ack or ack in change for ack in acks)
    ]
    return None if unacknowledged else content


def cmd_check(args: argparse.Namespace) -> int:
    if not BASELINE_PATH.exists():
        print(
            f"No baseline found at {BASELINE_PATH.relative_to(REPO_ROOT)}. "
            "Run `generate-baseline` once and commit it.",
            file=sys.stderr,
        )
        return 1

    baseline = json.loads(BASELINE_PATH.read_text())
    current = build_spec()
    breaking = diff_spec(baseline, current)

    if breaking:
        print("BREAKING interface/storage changes detected:")
        for change in breaking:
            print(f"  - {change}")

        if _migration_notes_cover(breaking) is None:
            print(
                f"\nPreflight FAILED: breaking changes must be acknowledged in "
                f"{MIGRATION_NOTES_PATH.relative_to(REPO_ROOT)}, one `ACK-BREAKING: <description>` "
                "line per change, before they can ship.",
                file=sys.stderr,
            )
            return 1
        print(f"\nBreaking changes acknowledged in {MIGRATION_NOTES_PATH.name} — continuing.")
    else:
        print("No breaking interface/storage changes detected.")

    if args.self_check:
        return 0

    env_errors = validate_environment()
    if env_errors:
        print("\nEnvironment preflight FAILED:", file=sys.stderr)
        for err in env_errors:
            print(f"  - {err}", file=sys.stderr)
        return 1

    write_manifest(current, breaking)
    return 0


def validate_environment() -> list:
    errors = []
    network = os.environ.get("NETWORK", "testnet")
    contract_id = os.environ.get("CONTRACT_ID", "")
    admin_alias = os.environ.get("ADMIN_ALIAS", "admin")

    if not contract_id or contract_id.startswith("CXXXXXXXX"):
        errors.append("CONTRACT_ID is not set or is still the placeholder.")

    rpc_url = os.environ.get("RPC_URL") or {
        "testnet": "https://soroban-testnet.stellar.org",
        "local": "http://localhost:8000",
    }.get(network)
    if not rpc_url:
        errors.append(f"No RPC_URL configured for network '{network}'.")
    else:
        try:
            urllib.request.urlopen(rpc_url, timeout=5)
        except urllib.error.HTTPError:
            pass  # Any HTTP response (even an error code) proves the host is reachable.
        except Exception as exc:  # noqa: BLE001 - reachability probe; report any real failure
            errors.append(f"RPC endpoint '{rpc_url}' is unreachable: {exc}")

    try:
        result = subprocess.run(
            ["stellar", "keys", "address", admin_alias],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if result.returncode != 0:
            errors.append(
                f"Admin identity '{admin_alias}' is not configured in the local stellar-cli."
            )
    except FileNotFoundError:
        errors.append("stellar-cli is not installed or not on PATH.")
    except Exception as exc:  # noqa: BLE001
        errors.append(f"Could not verify admin identity '{admin_alias}': {exc}")

    return errors


def write_manifest(current_spec: dict, breaking: list) -> None:
    MANIFEST_DIR.mkdir(exist_ok=True)
    git_commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=REPO_ROOT
    ).stdout.strip()

    manifest = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "network": os.environ.get("NETWORK", "testnet"),
        "contract_id": os.environ.get("CONTRACT_ID", ""),
        "admin_alias": os.environ.get("ADMIN_ALIAS", "admin"),
        "git_commit": git_commit,
        "baseline_hash": spec_hash(json.loads(BASELINE_PATH.read_text())),
        "new_spec_hash": spec_hash(current_spec),
        "breaking_changes": breaking,
    }

    stamp = manifest["generated_at"].replace(":", "")
    manifest_path = MANIFEST_DIR / f"{stamp}-{manifest['network']}.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(f"Wrote deployment manifest: {manifest_path.relative_to(REPO_ROOT)}")

    signing_key = os.environ.get("MANIFEST_SIGNING_KEY")
    if not signing_key:
        print(
            "WARNING: MANIFEST_SIGNING_KEY is not set — manifest was written unsigned. "
            "Sign it retroactively with:\n"
            f"  openssl dgst -sha256 -sign <key.pem> -out {manifest_path}.sig {manifest_path}"
        )
        return

    sig_path = f"{manifest_path}.sig"
    result = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", signing_key, "-out", sig_path, str(manifest_path)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"WARNING: failed to sign manifest: {result.stderr}", file=sys.stderr)
    else:
        print(f"Signed manifest: {sig_path}")
        print(
            "Verify later with:\n"
            f"  openssl dgst -sha256 -verify <pubkey.pem> -signature {sig_path} {manifest_path}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="PromptHash contract upgrade preflight gate.")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser(
        "generate-baseline",
        help="(Re)generate the checked-in spec baseline from current source.",
    )

    check_parser = sub.add_parser(
        "check", help="Diff current source against the baseline and validate the environment."
    )
    check_parser.add_argument(
        "--self-check",
        action="store_true",
        help=(
            "Offline mode: only diff the spec baseline, skip live env/network checks "
            "and manifest writing (used in CI)."
        ),
    )

    args = parser.parse_args()
    if args.command == "generate-baseline":
        return cmd_generate_baseline(args)
    return cmd_check(args)


if __name__ == "__main__":
    sys.exit(main())
