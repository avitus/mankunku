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
# Record every invocation so tests can assert an install was SKIPPED, and
# materialise node_modules the way a real `npm ci` would.
if [ -n "${NPM_STUB_CALLS:-}" ]; then
    echo "npm $*" >> "$NPM_STUB_CALLS"
fi
mkdir -p node_modules && echo "installed" > node_modules/.stub-marker
if [ -n "${NPM_STUB_LOG:-}" ]; then
    echo "$(date +%s) start ${NPM_STUB_MARKER:-npm}" >> "$NPM_STUB_LOG"
fi
if [ -n "${NPM_STUB_DELAY:-}" ]; then
    sleep "$NPM_STUB_DELAY"
fi
if [ -n "${NPM_STUB_LOG:-}" ]; then
    echo "$(date +%s) end ${NPM_STUB_MARKER:-npm}" >> "$NPM_STUB_LOG"
fi
# NPM_STUB_EXIT lets a test simulate the install failing — the real-world case
# being the OOM kill that broke deploys on 2026-08-07/08.
exit "${NPM_STUB_EXIT:-0}"
EOF
chmod +x "${STUB_BIN}/npm"
cat > "${STUB_BIN}/pm2" <<'EOF'
#!/bin/sh
# PM2_STUB_EXIT simulates a restart failure, which happens AFTER `current` has
# been swapped onto the staged release.
exit "${PM2_STUB_EXIT:-0}"
EOF
chmod +x "${STUB_BIN}/pm2"
# curl stub for the post-restart smoke check, standing in for /api/health.
#
# By default it reports whatever `current` points at, which is what a correctly
# restarted app does — so every pre-existing test keeps passing untouched.
# CURL_STUB_DOWN=1 simulates an app that never comes up; CURL_STUB_RELEASE
# pins a different id to simulate a stale process still serving the old build.
cat > "${STUB_BIN}/curl" <<'EOF'
#!/bin/sh
# CURL_STUB_DELAY stands in for real curl burning up to its --max-time against
# an app that accepts connections but never answers.
if [ -n "${CURL_STUB_DELAY:-}" ]; then
    sleep "$CURL_STUB_DELAY"
fi
if [ -n "${CURL_STUB_DOWN:-}" ]; then
    exit 7   # curl's "failed to connect"
fi
rel="${CURL_STUB_RELEASE:-}"
if [ -z "$rel" ]; then
    rel=$(readlink "${MANKUNKU_ROOT}/current" 2>/dev/null | sed 's|^releases/||')
fi
printf '{"status":"ok","version":"abc123","releaseId":"%s","node":"v26.5.1"}' "$rel"
exit 0
EOF
chmod +x "${STUB_BIN}/curl"
# node stub — release.sh records the Node version alongside the lockfile so a
# runtime upgrade invalidates the shared dependency tree. NODE_STUB_VERSION lets
# a test simulate the box being upgraded under an unchanged lockfile.
cat > "${STUB_BIN}/node" <<'EOF'
#!/bin/sh
echo "${NODE_STUB_VERSION:-v26.5.1}"
EOF
chmod +x "${STUB_BIN}/node"
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
#
# $3 is the package-lock.json payload. Deps are installed into a shared dir and
# reused while the lockfile is unchanged, so tests that care about whether an
# install RAN vary this; everything else takes the default and shares one tree.
stage_release() {
    local id="$1" chunk="$2" lock="${3:-baseline-deps}"
    local dir="${MANKUNKU_ROOT}/releases/${id}"
    mkdir -p "${dir}/build/client/_app/immutable/nodes"
    echo "// ${chunk}" > "${dir}/build/client/_app/immutable/nodes/${chunk}"
    echo "console.log('server')" > "${dir}/build/index.js"
    printf 'module.exports = { apps: [{ name: "mankunku", script: "build/index.js", cwd: "." }] }\n' \
        > "${dir}/ecosystem.config.cjs"
    printf '{"name":"mankunku","version":"0.0.1"}\n' > "${dir}/package.json"
    printf '{"lockfileVersion":3,"payload":"%s"}\n' "$lock" > "${dir}/package-lock.json"
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

# --- Failed deploys must not leak their staged release (2026-08-08) ---
# `npm ci` runs on the server and was OOM-killed on two consecutive deploys.
# Pruning happens at the END of a successful run, so each failure stranded a
# ~600MB staged dir forever. Worse than the disk cost: `ls -1t | tail -n +N`
# retains the NEWEST releases, so stranded failures occupy retention slots and
# push genuinely-working releases out of the rollback window.
LIVE_BEFORE="$(readlink "${MANKUNKU_ROOT}/current")"
ID8="20260108-000000-8888888"
# Distinct lockfile so the install actually RUNS and can be made to fail — with
# the shared-deps cache an unchanged lockfile skips npm ci entirely.
stage_release "$ID8" "2.HHHHHHH.js" "deps-failing-install"
set +e
NPM_STUB_EXIT=1 bash "$RELEASE_SH" "$ID8" >/dev/null 2>&1
rc=$?
set -e
[[ $rc -ne 0 ]] || fail "deploy reported success despite npm ci failing"
ok "deploy fails when npm ci fails"
[[ ! -d "${MANKUNKU_ROOT}/releases/${ID8}" ]] \
    || fail "failed deploy leaked its staged release dir"
ok "failed deploy cleans up its staged release"
[[ "$(readlink "${MANKUNKU_ROOT}/current")" == "$LIVE_BEFORE" ]] \
    || fail "failed deploy moved current away from the live release"
ok "failed deploy leaves current on the previous release"

# The guard that makes the cleanup safe. Once `current` has been swapped onto
# the staged release, that dir IS production — a later failure (PM2 refusing to
# start) must NOT delete it, or the cleanup would take the site down harder
# than the failure it is tidying up after.
ID9="20260109-000000-9999999"
stage_release "$ID9" "2.IIIIIII.js"
set +e
PM2_STUB_EXIT=1 bash "$RELEASE_SH" "$ID9" >/dev/null 2>&1
rc=$?
set -e
[[ $rc -ne 0 ]] || fail "deploy reported success despite pm2 failing"
ok "deploy fails when pm2 restart fails"
[[ -d "${MANKUNKU_ROOT}/releases/${ID9}" ]] \
    || fail "cleanup deleted the release that current points at (would break prod)"
ok "cleanup spares a staged release that current already points at"
[[ -f "${MANKUNKU_ROOT}/releases/${ID9}/build/index.js" ]] \
    || fail "live release left incomplete by cleanup"
ok "spared release still has its build intact"

# --- Shared node_modules, reinstalled only when the lockfile changes ---
# `npm ci` peaks around 500MB installing 378MB/22k files, on a 961MB box. It
# was the OOM victim on 2026-08-07/08 — and the lockfile was byte-identical
# across all three of those deploys, so it rebuilt the same tree every time.
CALLS="${WORK}/npm-calls.log"

ID10="20260110-000000-aaa1111"
: > "$CALLS"
stage_release "$ID10" "2.JJJJJJJ.js" "deps-v1"
NPM_STUB_CALLS="$CALLS" bash "$RELEASE_SH" "$ID10" >/dev/null
grep -q "npm ci" "$CALLS" || fail "first deploy on a new lockfile did not install"
ok "install runs when the shared tree is cold"
[[ -e "${MANKUNKU_ROOT}/releases/${ID10}/node_modules/.stub-marker" ]] \
    || fail "release cannot reach node_modules"
# Pin the MECHANISM: a per-release copy would defeat the whole point, so the
# release must reach deps through a symlink into the shared tree.
[[ -L "${MANKUNKU_ROOT}/releases/${ID10}/node_modules" ]] \
    || fail "release node_modules is a real directory, not a link to the shared tree"
[[ "${MANKUNKU_ROOT}/releases/${ID10}/node_modules" -ef "${MANKUNKU_ROOT}/shared/deps/node_modules" ]] \
    || fail "release node_modules does not resolve to the shared tree"
ok "release resolves node_modules through the shared tree"

ID11="20260111-000000-bbb2222"
: > "$CALLS"
stage_release "$ID11" "2.KKKKKKK.js" "deps-v1"   # same lockfile as ID10
NPM_STUB_CALLS="$CALLS" bash "$RELEASE_SH" "$ID11" >/dev/null
[[ ! -s "$CALLS" ]] || fail "npm ci ran again for an unchanged lockfile: $(cat "$CALLS")"
ok "install is skipped when the lockfile is unchanged"
[[ -e "${MANKUNKU_ROOT}/releases/${ID11}/node_modules/.stub-marker" ]] \
    || fail "reused deps not reachable from the new release"
ok "reused deps reachable from the new release"

ID12="20260112-000000-ccc3333"
: > "$CALLS"
stage_release "$ID12" "2.LLLLLLL.js" "deps-v2"   # dependencies actually changed
NPM_STUB_CALLS="$CALLS" bash "$RELEASE_SH" "$ID12" >/dev/null
grep -q "npm ci" "$CALLS" || fail "npm ci skipped despite a changed lockfile"
ok "install runs again when the lockfile changes"

# A failed install must not be recorded as satisfying the new lockfile, or the
# next deploy would happily reuse a half-installed tree.
ID13="20260113-000000-ddd4444"
stage_release "$ID13" "2.MMMMMMM.js" "deps-v3"
set +e
NPM_STUB_EXIT=1 bash "$RELEASE_SH" "$ID13" >/dev/null 2>&1
set -e
: > "$CALLS"
ID14="20260114-000000-eee5555"
stage_release "$ID14" "2.NNNNNNN.js" "deps-v3"   # same lockfile the install died on
NPM_STUB_CALLS="$CALLS" bash "$RELEASE_SH" "$ID14" >/dev/null
grep -q "npm ci" "$CALLS" || fail "reused a tree from an install that failed"
ok "a failed install is not recorded as satisfied"

# A Node upgrade must invalidate the shared tree even when the lockfile has not
# moved: native bindings are compiled against a Node ABI, and nothing in the
# lockfile records which runtime built them. This box went 18 -> 26 on
# 2026-08-06 and has a history of Node-skew incidents (MANKUNKU-1F, 1G), so
# "same deps, different runtime" is a real state, not a hypothetical.
ID19="20260119-000000-555dddd"
: > "$CALLS"
stage_release "$ID19" "2.SSSSSSS.js" "deps-v3"   # identical lockfile to ID14
NPM_STUB_CALLS="$CALLS" NODE_STUB_VERSION="v28.0.0" \
    bash "$RELEASE_SH" "$ID19" >/dev/null
grep -q "npm ci" "$CALLS" || fail "shared tree reused across a Node version change"
ok "install runs again when the Node version changes"

# The stage now contains a SYMLINK into shared/deps. Cleanup must unlink it,
# never follow it — wiping the shared tree on every failed deploy would be far
# worse than the leak the cleanup exists to fix. Needs a failure that lands
# after deps are linked but before the current swap, and there is a real one:
# release.sh refuses to swap when `current` is a directory instead of a symlink.
PREV_CURRENT="$(readlink "${MANKUNKU_ROOT}/current")"
ID17="20260117-000000-777bbbb"
stage_release "$ID17" "2.QQQQQQQ.js"
rm -f "${MANKUNKU_ROOT}/current"
mkdir -p "${MANKUNKU_ROOT}/current"
set +e
bash "$RELEASE_SH" "$ID17" >/dev/null 2>&1
rc=$?
set -e
rmdir "${MANKUNKU_ROOT}/current"
ln -sfn "$PREV_CURRENT" "${MANKUNKU_ROOT}/current"
[[ $rc -ne 0 ]] || fail "deploy swapped current even though it was a real directory"
ok "deploy refuses to swap when current is not a symlink"
[[ ! -d "${MANKUNKU_ROOT}/releases/${ID17}" ]] \
    || fail "failure after dependency linking leaked its stage"
ok "stage cleaned up after a failure that follows dependency linking"
[[ -e "${MANKUNKU_ROOT}/shared/deps/node_modules/.stub-marker" ]] \
    || fail "cleanup followed the symlink and destroyed the shared dependency tree"
ok "cleanup unlinks node_modules rather than following it into shared/deps"

# --- Post-restart smoke check ---
# `pm2 start` returns 0 the moment the process is SPAWNED. Without a check, an
# app that crashes on boot (missing secret, bad build, Node skew — MANKUNKU-1F
# and 1G were both that) leaves PM2 restart-looping and the deploy GREEN.
LIVE_BEFORE_SMOKE="$(readlink "${MANKUNKU_ROOT}/current")"
ID15="20260115-000000-fff6666"
stage_release "$ID15" "2.OOOOOOO.js"
set +e
OUT=$(CURL_STUB_DOWN=1 HEALTH_TIMEOUT_SECS=1 bash "$RELEASE_SH" "$ID15" 2>&1)
rc=$?
set -e
[[ $rc -ne 0 ]] || fail "deploy went green while the app never answered"
ok "deploy fails when the restarted app never answers"
echo "$OUT" | grep -qi "health" || fail "no health-check diagnostic in the failure output"
ok "failure output names the health check"

# The stale-process case: the app answers, but is still serving the OLD build.
# A plain "is it up?" check passes here — only comparing the release id catches
# it, which is the whole reason /api/health reports one.
ID16="20260116-000000-999aaaa"
stage_release "$ID16" "2.PPPPPPP.js"
set +e
# Strip the `releases/` prefix that readlink returns: the stub only strips it on
# its default branch, so passing the raw value would make the "stale process"
# report a MALFORMED id. That still fails the deploy — but for the wrong reason,
# and the point here is a well-formed id belonging to the previous release.
CURL_STUB_RELEASE="${LIVE_BEFORE_SMOKE#releases/}" HEALTH_TIMEOUT_SECS=1 \
    bash "$RELEASE_SH" "$ID16" >/dev/null 2>&1
rc=$?
set -e
[[ $rc -ne 0 ]] || fail "deploy went green while the app served a different release"
ok "deploy fails when the app reports a different release id"

# And the staged release must survive both smoke-check failures — `current`
# already points at it, so the cleanup guard has to hold here too.
[[ -d "${MANKUNKU_ROOT}/releases/${ID16}" ]] \
    || fail "smoke-check failure deleted the release current points at"
ok "smoke-check failure leaves the live release in place"

# The budget is WALL CLOCK, not accumulated sleep. curl can burn its --max-time
# against an app that accepts connections but never answers, so counting only
# sleeps overran badly: at a 3s budget with a 3s-per-call curl the old loop took
# ~13s (3+2+3+2+3), and at the 60s default roughly 3.5 minutes.
ID18="20260118-000000-666cccc"
stage_release "$ID18" "2.RRRRRRR.js"
smoke_start=$SECONDS
set +e
CURL_STUB_DOWN=1 CURL_STUB_DELAY=3 HEALTH_TIMEOUT_SECS=3 \
    bash "$RELEASE_SH" "$ID18" >/dev/null 2>&1
rc=$?
set -e
smoke_elapsed=$(( SECONDS - smoke_start ))
[[ $rc -ne 0 ]] || fail "deploy went green against an app that never answered"
(( smoke_elapsed <= 8 )) \
    || fail "health check overran its 3s budget: ${smoke_elapsed}s elapsed (counting sleeps, not wall clock?)"
ok "health-check budget measures wall clock, not accumulated sleep (${smoke_elapsed}s)"

# --- Whole-deploy lock (2026-07-13 incident) ---
# Two release.sh runs must serialize: concurrent npm ci's memory-thrashed the
# droplet when two merges deployed at once. Gated on flock availability — the
# server (Ubuntu) always has it; a stock macOS dev box does not, and there
# release.sh intentionally degrades to unserialized with a warning.
if command -v flock >/dev/null 2>&1; then
    ID5="20260105-000000-eeeeeee"
    ID6="20260106-000000-fffffff"
    # Distinct lockfiles so BOTH deploys really run npm ci — this test exists to
    # prove two installs never overlap, and the shared-deps cache would
    # otherwise skip the second one and quietly hollow the test out.
    stage_release "$ID5" "2.EEEEEEE.js" "deps-serialize-a"
    stage_release "$ID6" "2.FFFFFFF.js" "deps-serialize-b"
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
