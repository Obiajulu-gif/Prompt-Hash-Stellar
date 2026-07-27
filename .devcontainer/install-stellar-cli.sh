#!/usr/bin/env bash
# Installs the Stellar CLI (with Soroban support) inside the dev container.
# Runs once on container creation (devcontainer onCreateCommand).
set -euo pipefail

if command -v stellar >/dev/null 2>&1; then
  echo "stellar CLI already installed: $(stellar --version | head -n1)"
  exit 0
fi

echo "Installing Stellar CLI via cargo (this runs once)..."
cargo install --locked stellar-cli

echo "Installed: $(stellar --version | head -n1)"
