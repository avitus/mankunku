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
# Reap background deploys/blockers before removing WORK — an assertion
# failing mid-test would otherwise leave an orphaned release.sh writing
# error noise into CI output after the FAIL line.
trap 'kill $(jobs -p) 2>/dev/null || true; wait 2>/dev/null || true; rm -rf "$WORK"' EXIT

# --- Stub external commands release.sh shells out to ---
STUB_BIN="${WORK}/bin"
mkdir -p "$STUB_BIN"
# The npm stub can log start/end timestamps and hold for a bit, so the
# deploy-lock tests below can prove two npm ci's never overlap.
cat > "${STUB_BIN}/npm" <<'EOF'
#!/bin/sh
if [ -n "${NPM_STUB_LOG:-}" ]; then
    echo "$(date +%s) start ${NPM_STUB_MARKER:-npm}" >> "$NPM_STUB_LOG"
fi
if [ -n "${NPM_STUB_DELAY:-}" ]; then
    sleep "$NPM_STUB_DELAY"
fi
if [ -n "${NPM_STUB_LOG:-}" ]; then
    echo "$(date +%s) end ${NPM_STUB_MARKER:-npm}" >> "$NPM_STUB_LOG"
fi
exit 0
EOF
chmod +x "${STUB_BIN}/npm"
cat > "${STUB_BIN}/pm2" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "${STUB_BIN}/pm2"
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

# Hydration: the pool is only useful if something SERVES it. The nginx alias
# onto the pool (nginx/mankunku.conf) was never live on the box — verified
# 2026-07-25 when a 10-day-old chunk URL 404'd in production while the pool
# held 555MB. So release.sh must hardlink pooled chunks this build doesn't
# ship into the release's own client dir, where the Node server (sirv) serves
# them with no box-side config at all.
HYDRATED_A="${MANKUNKU_ROOT}/releases/${ID2}/build/client/_app/immutable/nodes/2.AAAAAAA.js"
[[ -f "$HYDRATED_A" ]] \
    || fail "old chunk not hydrated into new release's client dir (node can't serve it)"
ok "old chunk hydrated into the new release's client dir"
grep -q "2.AAAAAAA" "$HYDRATED_A" \
    || fail "hydrated chunk content mismatch"
ok "hydrated chunk carries the original content"
# Pin the MECHANISM, not just the content: hydration must hardlink (same
# inode), or a silent regression to the cp fallback would multiply the pool's
# full size into every retained release.
[[ "$HYDRATED_A" -ef "${POOL}/2.AAAAAAA.js" ]] \
    || fail "hydrated chunk is not a hardlink to the pool inode"
ok "hydrated chunk is a hardlink to the pool inode"
[[ -f "${MANKUNKU_ROOT}/releases/${ID2}/build/client/_app/immutable/nodes/2.BBBBBBB.js" ]] \
    || fail "release's own chunk clobbered by hydration"
ok "release's own chunks untouched by hydration"

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
# Ordering: eviction must run BEFORE hydration, so a beyond-retention chunk is
# not resurrected into the fresh release's client dir.
[[ ! -f "${MANKUNKU_ROOT}/releases/${ID3}/build/client/_app/immutable/nodes/2.AAAAAAA.js" ]] \
    || fail "evicted chunk hydrated into new release (evict must precede hydrate)"
ok "evicted chunk stays out of the new release"

# Self-repair: a crashed deploy can leave a TRUNCATED file in the pool (the
# copy is interrupted mid-write). Hydration now serves pool bytes, so a
# poisoned entry would be linked into every future release for the whole
# retention window. When a build ships the same hash again, the merge must
# detect the size mismatch and replace the corrupt pool copy.
ID3B="20260103-120000-c2c2c2c"
printf 'trunc' > "${POOL}/2.BBBBBBB.js"   # simulate interrupted copy of chunk B
stage_release "$ID3B" "2.BBBBBBB.js"       # next deploy ships pristine chunk B
bash "$RELEASE_SH" "$ID3B" >/dev/null
grep -q "2.BBBBBBB" "${POOL}/2.BBBBBBB.js" \
    || fail "truncated pool chunk not repaired by a build shipping the same hash"
ok "truncated pool chunk repaired from the next build that ships it"

# Stale lock: a lock left behind by a crashed deploy must be broken, not block
# the next deploy forever. Plant a lock older than the stale window and confirm
# the run breaks it, completes, and pools its chunk (within a few seconds, not
# the full wait budget).
ID4="20260104-000000-ddddddd"
LOCK="${MANKUNKU_ROOT}/shared/.immutable-pool.lock"
mkdir -p "$LOCK"
touch -t "$(date -v-1H +%Y%m%d%H%M 2>/dev/null || date -d '1 hour ago' +%Y%m%d%H%M)" "$LOCK"
stage_release "$ID4" "2.DDDDDDD.js"
POOL_LOCK_STALE_SECS=2 bash "$RELEASE_SH" "$ID4" >/dev/null
[[ -f "${POOL}/2.DDDDDDD.js" ]] || fail "deploy did not complete past a stale lock"
ok "stale lock broken; deploy proceeded"
[[ ! -d "$LOCK" ]] || fail "lock not released after deploy"
ok "lock released after deploy"

# --- Whole-deploy lock (2026-07-13 incident) ---
# Two release.sh runs must serialize: concurrent npm ci's memory-thrashed the
# droplet when two merges deployed at once. Gated on flock availability — the
# server (Ubuntu) always has it; a stock macOS dev box does not, and there
# release.sh intentionally degrades to unserialized with a warning.
if command -v flock >/dev/null 2>&1; then
    ID5="20260105-000000-eeeeeee"
    ID6="20260106-000000-fffffff"
    stage_release "$ID5" "2.EEEEEEE.js"
    stage_release "$ID6" "2.FFFFFFF.js"
    NPM_LOG="${WORK}/npm-stub.log"
    : > "$NPM_LOG"

    # Deploy A holds the lock for ~3s inside npm ci; deploy B starts while A
    # is mid-install and must queue behind it.
    NPM_STUB_LOG="$NPM_LOG" NPM_STUB_MARKER=A NPM_STUB_DELAY=3 \
        bash "$RELEASE_SH" "$ID5" >/dev/null &
    HOLDER=$!
    for _ in $(seq 1 50); do
        grep -q "start A" "$NPM_LOG" 2>/dev/null && break
        sleep 0.1
    done
    grep -q "start A" "$NPM_LOG" || fail "deploy A never reached npm ci"

    B_OUT="$(NPM_STUB_LOG="$NPM_LOG" NPM_STUB_MARKER=B bash "$RELEASE_SH" "$ID6")" \
        || fail "queued deploy B failed"
    wait "$HOLDER" || fail "deploy A failed"

    a_end=$(awk '$2=="end" && $3=="A" {print $1}' "$NPM_LOG")
    b_start=$(awk '$2=="start" && $3=="B" {print $1}' "$NPM_LOG")
    [[ -n "$a_end" && -n "$b_start" && "$b_start" -ge "$a_end" ]] \
        || fail "deploy B's npm ci overlapped deploy A's (b_start=${b_start:-?} a_end=${a_end:-?})"
    ok "concurrent deploys serialized (no npm ci overlap)"
    echo "$B_OUT" | grep -q "Another deploy is in progress" \
        || fail "queued deploy did not emit waiting keepalive"
    ok "queued deploy emitted keepalive output while waiting"
    [[ "$(readlink "${MANKUNKU_ROOT}/current")" == "releases/${ID6}" ]] \
        || fail "current not on deploy B after serialized deploys"
    ok "current on last serialized deploy"

    # A live-but-stuck holder must fail the waiter cleanly after its wait
    # budget — never a second concurrent npm ci.
    ID7="20260107-000000-1234567"
    stage_release "$ID7" "2.GGGGGGG.js"
    (
        exec 9>"${MANKUNKU_ROOT}/.deploy.lock"
        flock 9
        sleep 20
    ) &
    BLOCKER=$!
    # Wait until the blocker observably holds the lock — command-form
    # `flock -n <file> true` exits non-zero exactly when the lock is held.
    # A blind sleep races a slow-to-schedule blocker; the deploy under test
    # would then win the lock and fail the test with a misleading message.
    for _ in $(seq 1 50); do
        if ! flock -n "${MANKUNKU_ROOT}/.deploy.lock" true 2>/dev/null; then
            break
        fi
        sleep 0.1
    done
    if flock -n "${MANKUNKU_ROOT}/.deploy.lock" true 2>/dev/null; then
        fail "blocker never acquired the deploy lock"
    fi
    set +e
    OUT=$(DEPLOY_LOCK_WAIT_SECS=2 bash "$RELEASE_SH" "$ID7" 2>&1)
    rc=$?
    set -e
    kill "$BLOCKER" 2>/dev/null || true
    wait "$BLOCKER" 2>/dev/null || true
    [[ $rc -ne 0 ]] || fail "deploy succeeded despite a held deploy lock"
    echo "$OUT" | grep -q "giving up" || fail "no giving-up message on lock timeout"
    ok "waiter gives up cleanly on a stuck live holder"
else
    echo "skip - flock not available; deploy-lock tests skipped (run on Linux/CI)"
fi

echo "PASSED (${pass} assertions)"
