#!/usr/bin/env bash
set -euo pipefail
# SQLx 0.8's webpki-roots 0.26 shim re-exports 1.x, so the advisory exception holds only while 1.x is patched.
versions=$(cargo tree --locked --workspace --all-features --target all --edges normal,build --prefix none | sed -n 's/^webpki-roots v\([0-9.]*\).*/\1/p' | sort -u)
for v in $versions; do
  [[ $v == 0.26.11 || $(printf '%s\n' 1.0.10 "$v" | sort -V | head -1) == 1.0.10 ]] && continue
  echo "webpki-roots $v predates the RUSTSEC-2026-0381 fix; the advisory exception is invalid." >&2
  exit 1
done
