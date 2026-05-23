#!/usr/bin/env bash
# One-stop refresh for shared/protocol.ts:
#   1. cargo test → ts-rs writes per-type bindings to shared/bindings/*.ts
#   2. regen-protocol.mjs → splices bindings + unions template into shared/protocol.ts
#
# Run this after editing engine/engine-core/src/protocol.rs or
# shared/protocol.unions.ts.tmpl. The frontends import @shared/protocol,
# so the generated file is the contract every TS consumer sees.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"

# Find cargo: PATH first, then the default rustup install location.
if command -v cargo >/dev/null 2>&1; then
  CARGO=cargo
elif [[ -x "$HOME/.cargo/bin/cargo" ]]; then
  CARGO="$HOME/.cargo/bin/cargo"
else
  echo "cargo not found in PATH or $HOME/.cargo/bin/ — install rustup and try again" >&2
  exit 1
fi

echo "→ refreshing shared/bindings via cargo test"
(cd "$REPO_ROOT/engine" && "$CARGO" test --quiet protocol::export_bindings >/dev/null)

echo "→ regenerating shared/protocol.ts"
node "$HERE/regen-protocol.mjs"
