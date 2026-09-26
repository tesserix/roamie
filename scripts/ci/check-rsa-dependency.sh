#!/usr/bin/env bash
set -euo pipefail
# Revisit the unused SQLx MySQL lock entry before this date.
if [[ "$(date -u +%Y-%m-%d)" > '2026-10-26' ]]; then
  echo 'The SQLx unused-rsa advisory exception has expired.' >&2
  exit 1
fi
resolved=$(cargo tree --locked --workspace --all-features --target all --edges normal,build,dev --prefix none)
if printf '%s\n' "$resolved" | grep -Eq '^rsa v'; then
  echo 'rsa is reachable; the unused-dependency advisory exception is invalid.' >&2
  exit 1
fi
