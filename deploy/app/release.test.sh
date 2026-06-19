#!/usr/bin/env bash
# deploy/app/release.test.sh — Regression tests for release.sh.
#
# Focus: the shared immutable-asset pool that keeps content-hashed chunks
# servable across deploys (Sentry MANKUNKU-8). Runs release.sh against a
# throwaway MANKUNKU_ROOT with npm/pm2 (and macOS-missing sha256sum) stubbed
# onto PATH, so it executes locally and in CI without touching the real system.
#
# Usage: bash deploy/app/release.test.sh   (exit 0 = pass)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_SH="${SCRIPT_DIR}/release.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- Stub external commands release.sh shells out to ---
STUB_BIN="${WORK}/bin"
mkdir -p "$STUB_BIN"
for cmd in npm pm2; do
    cat > "${STUB_BIN}/${cmd}" <<'EOF'
#!/bin/sh
exit 0
EOF
    chmod +x "${STUB_BIN}/${cmd}"
done
# macOS lacks sha256sum (release.sh's snapshot helper uses it); shim via shasum.
if ! command -v sha256sum >/dev/null 2>&1; then
    cat > "${STUB_BIN}/sha256sum" <<'EOF'
#!/bin/sh
shasum -a 256 "$@"
EOF
    chmod +x "${STUB_BIN}/sha256sum"
fi
export PATH="${STUB_BIN}:${PATH}"

export MANKUNKU_ROOT="${WORK}/app"
POOL="${MANKUNKU_ROOT}/shared/_app/immutable/nodes"

pass=0
fail() { echo "FAIL: $*" >&2; exit 1; }
ok()   { echo "ok - $*"; pass=$((pass + 1)); }

# Build a staged release dir shipping a single immutable chunk.
stage_release() {
    local id="$1" chunk="$2"
    local dir="${MANKUNKU_ROOT}/releases/${id}"
    mkdir -p "${dir}/build/client/_app/immutable/nodes"
    echo "// ${chunk}" > "${dir}/build/client/_app/immutable/nodes/${chunk}"
    echo "console.log('server')" > "${dir}/build/index.js"
    printf 'module.exports = { apps: [{ name: "mankunku", script: "build/index.js", cwd: "." }] }\n' \
        > "${dir}/ecosystem.config.cjs"
}

ID1="20260101-000000-aaaaaaa"
ID2="20260102-000000-bbbbbbb"
ID3="20260103-000000-ccccccc"

# Release 1 ships chunk A.
stage_release "$ID1" "2.AAAAAAA.js"
bash "$RELEASE_SH" "$ID1" >/dev/null
[[ -f "${POOL}/2.AAAAAAA.js" ]] || fail "release 1 chunk not in pool"
ok "release 1 chunk pooled"

# Release 2 ships chunk B and no longer ships chunk A (new hash after a change).
stage_release "$ID2" "2.BBBBBBB.js"
bash "$RELEASE_SH" "$ID2" >/dev/null

# The regression: chunk A must survive so tabs on release 1 still load it.
[[ -f "${POOL}/2.AAAAAAA.js" ]] \
    || fail "release 1 chunk evicted after release 2 (MANKUNKU-8 regression)"
ok "old chunk still served after a newer deploy"
[[ -f "${POOL}/2.BBBBBBB.js" ]] || fail "release 2 chunk not in pool"
ok "new chunk pooled"

# `current` points at the newest release.
[[ "$(readlink "${MANKUNKU_ROOT}/current")" == "releases/${ID2}" ]] \
    || fail "current not swapped to release 2"
ok "current swapped to newest release"

# Retention: a chunk no recent deploy ships ages out; still-shipped chunks stay.
touch -t "$(date -v-40d +%Y%m%d0000 2>/dev/null || date -d '40 days ago' +%Y%m%d0000)" \
    "${POOL}/2.AAAAAAA.js"
stage_release "$ID3" "2.BBBBBBB.js"   # still ships chunk B → refreshes its mtime
POOL_RETENTION_DAYS=30 bash "$RELEASE_SH" "$ID3" >/dev/null
[[ ! -f "${POOL}/2.AAAAAAA.js" ]] || fail "stale chunk not evicted past retention window"
ok "stale chunk evicted past retention window"
[[ -f "${POOL}/2.BBBBBBB.js" ]] || fail "still-shipped chunk wrongly evicted"
ok "still-shipped chunk retained despite earlier age"

echo "PASSED (${pass} assertions)"
