# Automated Dependency Updates & Maintainer Guide

This document describes the automated dependency update strategy, grouping rules, CI quality validation, and maintainer review process for **Prompt-Hash-Stellar**.

---

## 1. Overview & Ecosystem Scope

Automated dependency updates are managed via Dependabot (`.github/dependabot.yml`) on a weekly schedule (Mondays at 09:00 UTC).

The workflow covers four distinct package ecosystems:
1. **Frontend / Root Workspace (Yarn / npm)**: `package-ecosystem: "npm"`, directory `"/"`
2. **Server Workspace (Express / Node.js)**: `package-ecosystem: "npm"`, directory `"/server"`
3. **Smart Contracts (Rust / Cargo Workspace)**: `package-ecosystem: "cargo"`, directory `"/"`
4. **CI / Workflows (GitHub Actions)**: `package-ecosystem: "github-actions"`, directory `"/"`

---

## 2. Grouping Policy (Routine vs. Major Upgrades)

To minimize PR clutter while ensuring safety, updates are categorized by semantic versioning impact:

- **Routine (Patch & Minor Updates)**:
  - Automatically grouped into single consolidated PRs per ecosystem using Dependabot `groups` rules (`update-types: ["patch", "minor"]`).
  - Allows backward-compatible bug fixes and minor features to be tested and merged in a single review step.
- **Major Upgrades**:
  - Kept **isolated in individual pull requests** (not grouped).
  - Every major version bump (e.g. React 18 -> 19 or Soroban SDK major bumps) opens a dedicated PR for isolated review and testing.

---

## 3. Automated Quality Checks & CI Validation

Every dependency update PR automatically triggers the full CI suite defined in `.github/workflows/ci.yml`:

- **Contracts Job**: Runs `cargo fmt`, `cargo clippy --deny warnings`, `cargo test`, and WASM build validation.
- **Frontend Job**: Runs `yarn typecheck`, `yarn lint`, `yarn build`, and `yarn test:frontend`.
- **API Server Job**: Runs `yarn test:api`.
- **CI Gate**: Ensures all jobs pass before the PR is eligible for merging.

---

## 4. Maintainer Review & Merge Process

Maintainers should follow this step-by-step review process when evaluating automated dependency PRs:

1. **Verify CI Gate**: Ensure all automated GitHub Action checks have succeeded. Do NOT merge PRs with failing checks.
2. **Review Grouped Patch/Minor PRs**:
   - Confirm no unexpected major version bumps were included in the group.
   - If CI passes, approve and merge via squash merge.
3. **Review Major Version PRs**:
   - Inspect the upstream release notes/changelog linked in the PR description.
   - Check for breaking API changes or deprecated features affecting `contracts/`, `server/`, or `src/`.
   - Optionally check out the PR branch locally (`gh pr checkout <number>`) and run local dev/test servers.
   - Approve and merge once validated.

---

## 5. Rollback & Emergency Recovery

If a merged dependency update causes an unexpected regression or production defect:

1. **Identify the Commit**: Locate the squash commit created by the dependency PR.
2. **Revert the PR**:
   ```bash
   git checkout main
   git pull origin main
   git revert -m 1 <commit-hash>
   ```
3. **Open Emergency Hotfix PR**: Push the revert commit and verify all CI checks pass.
4. **Pin or Ignore Version**: If the upstream dependency is buggy, update `.github/dependabot.yml` or `package.json` / `Cargo.toml` with version pins or `ignore` directives until a fixed version is released.
