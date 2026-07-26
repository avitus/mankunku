#!/usr/bin/env bash
# deploy/app/release.sh — Promote a staged release to live.
#
# Runs ON THE SERVER. CI has already rsynced build/ and package files into
# ${MANKUNKU_ROOT}/releases/<id>/. This script finishes the deploy: installs
# production dependencies, atomically swaps the `current` symlink, restarts
# PM2, and prunes old releases.
#
# Usage:
#   bash release.sh <release-id>
#
# Environment:
#   MANKUNKU_ROOT   App root (default: /home/deploy/mankunku). Override for tests.
#   KEEP_RELEASES   How many past releases to retain (default: 5).

set -euo pipefail

RELEASE_ID="${1:-}"
ROOT="${MANKUNKU_ROOT:-/home/deploy/mankunku}"

if [[ -z "$RELEASE_ID" ]]; then
    echo "error: missing release id" >&2
    echo "usage: $0 <release-id>" >&2
    exit 2
fi

# RELEASE_ID becomes part of filesystem paths and the `current` symlink target,
# so reject anything that isn't the CI-generated format (YYYYMMDD-HHMMSS-<7-hex>).
# This forecloses path-traversal (../) and other shell-metacharacter surprises.
if [[ ! "$RELEASE_ID" =~ ^[0-9]{8}-[0-9]{6}-[0-9a-f]{7}$ ]]; then
    echo "error: invalid release id: $(printf '%q' "$RELEASE_ID")" >&2
    echo "expected format: YYYYMMDD-HHMMSS-<7-hex>" >&2
    exit 2
fi

STAGE="${ROOT}/releases/${RELEASE_ID}"
if [[ ! -d "$STAGE" ]]; then
    echo "error: staged release not found: $STAGE" >&2
    exit 2
fi

# --- Whole-deploy serialization ---
#
# CI does not serialize deploys: two merges landing close together run two
# release.sh's concurrently, and concurrent `npm ci` runs memory-thrash the
# droplet badly enough to take the whole site down (2026-07-13 incident: two
# collided deploys plus a rerun kept production unresponsive for ~30 minutes;
# a lone npm ci finishes in under a minute). Hold an exclusive lock for the
# entire release so a second deploy queues instead of competing.
#
# flock, not a mkdir mutex like the pool lock below: the kernel releases a
# flock when the holding process dies — SIGKILL, dropped SSH session, OOM —
# so a crashed deploy can never wedge the queue and no staleness heuristic
# is needed. We poll with `-n` rather than block with `-w` because the
# waiting deploy must keep emitting output: CircleCI kills any step silent
# for 10 minutes, which is exactly how the colliding deploys died.
#
# Queued deploys are serialized, not ordered: if two are waiting, whichever
# grabs the lock last wins `current`. Both are main builds within seconds of
# each other, so the stakes are one commit of drift, visible in CI logs and
# healed by any subsequent deploy.
#
# The lock file itself is never deleted — unlinking a flock'd path lets the
# next opener lock a different inode and defeats the mutex.
#
# flock ships with util-linux, always present on the Ubuntu server. macOS
# lacks it; there the local test harness warns and runs unserialized.
DEPLOY_LOCK_FILE="${ROOT}/.deploy.lock"
DEPLOY_LOCK_WAIT_SECS="${DEPLOY_LOCK_WAIT_SECS:-900}"
# Guard to a number (same convention as the stat-mtime guard below): a bare
# word here is a fatal set -u error at the first *contended* poll — latent
# until the exact collision the lock exists for — and a non-integer like
# "15m" makes (( )) return false forever, so the waiter would keepalive past
# its budget indefinitely, defeating CircleCI's no-output kill.
[[ "$DEPLOY_LOCK_WAIT_SECS" =~ ^[0-9]+$ ]] || DEPLOY_LOCK_WAIT_SECS=900
# Force base-10: a leading zero ("0900") passes the regex but (( )) would
# parse it as octal and error, making the give-up branch unreachable.
DEPLOY_LOCK_WAIT_SECS=$(( 10#$DEPLOY_LOCK_WAIT_SECS ))
if command -v flock >/dev/null 2>&1; then
    exec 9>"$DEPLOY_LOCK_FILE"
    waited=0
    until flock -n 9; do
        if (( waited >= DEPLOY_LOCK_WAIT_SECS )); then
            echo "error: another deploy still holds ${DEPLOY_LOCK_FILE} after ${waited}s; giving up" >&2
            exit 1
        fi
        if (( waited % 30 == 0 )); then
            echo "==> Another deploy is in progress; waiting (${waited}s elapsed)"
        fi
        sleep 5
        waited=$((waited + 5))
    done
    echo "==> Deploy lock acquired"
    # Re-check after the wait: a deploy queued long enough can have its
    # staged dir pruned by the keep-last-5 pass of deploys that ran ahead
    # of it. Fail with the curated message, not a bare cd error at npm ci.
    if [[ ! -d "$STAGE" ]]; then
        echo "error: staged release disappeared while queued for the deploy lock: $STAGE" >&2
        exit 2
    fi
else
    echo "warn: flock not found; deploys are NOT serialized" >&2
fi

# Snapshot ecosystem.config.cjs state at every stage. The last several deploys
# had this file mysteriously arrive as pre-atomic-release content on the server
# despite CI rsyncing the correct content — these snapshots narrow down at
# which step the flip happens.
snapshot_ecosystem() {
    local label="$1"
    local target="$2"
    echo "==> ecosystem snapshot [$label]"
    if [[ ! -e "$target" ]]; then
        echo "    MISSING: $target"
        return
    fi
    echo "    path:      $target"
    echo "    realpath:  $(readlink -f "$target" 2>/dev/null || echo 'n/a')"
    echo "    sha256:    $(sha256sum "$target" | cut -d' ' -f1)"
    echo "    size/mtime:$(stat -c ' %s bytes / %y' "$target" 2>/dev/null || stat -f ' %z bytes / %Sm' "$target")"
    echo "    cwd|script lines:"
    { grep -E "^[[:space:]]*(cwd|script):" "$target" || true; } | sed 's/^/      /'
}

snapshot_ecosystem "after rsync" "${STAGE}/ecosystem.config.cjs"

# `9>&-` here and on the PM2 subshell below: don't let child processes
# inherit the deploy-lock fd. A child that outlives this script (the PM2
# God daemon when `pm2 start` has to spawn it; in principle an npm
# lifecycle script) would keep the flock held forever, timing out every
# subsequent deploy. Closing the fd in the subshell doesn't release the
# parent's lock — flock lives on the parent's open file description.
echo "==> Installing production dependencies in staged release"
(
    cd "$STAGE"
    npm ci --omit=dev
) 9>&-

snapshot_ecosystem "after npm ci" "${STAGE}/ecosystem.config.cjs"

# --- Shared immutable-asset pool (fixes Sentry MANKUNKU-8) ---
#
# Each deploy stages its own build/ and `current` flips to it atomically, so the
# server only ever serves THIS release's _app/immutable chunks. But those chunks
# are content-hashed precisely so old and new can coexist: a browser tab opened
# against an older deploy still requests that deploy's chunk hashes. Serving only
# `current`'s assets 404s them ("error loading dynamically imported module").
#
# Keep every release's immutable assets in one shared, accumulating pool so a
# tab on any recent version can still fetch its chunks. The pool is SERVED by
# hardlinking it into each staged release's own client dir (see the hydration
# step below) — the Node server is the mechanism of record. nginx/mankunku.conf
# has an alias that would serve the pool directly, but it never went live on
# the box (discovered 2026-07-25 after months of the pool sitting unserved);
# if it ever lands, it simply answers first for the same bytes. Content hashes
# never collide, so the union is always self-consistent.
SHARED_IMMUTABLE="${ROOT}/shared/_app/immutable"
STAGE_IMMUTABLE="${STAGE}/build/client/_app/immutable"
if [[ -d "$STAGE_IMMUTABLE" ]]; then
    # Serialize all shared-pool mutations behind a lock. CI does not serialize
    # deploys, so two release.sh runs can overlap; without a lock one run's
    # eviction can race the other's merge (e.g. delete a directory the other
    # just created before it copies into it), re-introducing the very 404s this
    # block fixes. Portable mutex via mkdir atomicity. A lock older than
    # LOCK_STALE_SECS is assumed orphaned by a crashed deploy and broken, so a
    # stale lock can't wedge every future deploy. The whole merge+evict runs in
    # a subshell whose EXIT trap releases the lock even on failure; it's held
    # only for this fast section, not across npm ci / pm2 restart.
    mkdir -p "${ROOT}/shared"
    LOCK_DIR="${ROOT}/shared/.immutable-pool.lock"
    LOCK_STALE_SECS="${POOL_LOCK_STALE_SECS:-120}"
    waited=0
    until mkdir "$LOCK_DIR" 2>/dev/null; do
        # GNU first: `stat -c %Y` (epoch mtime). BSD's `stat -c` fails cleanly
        # with no stdout, so the `||` falls through to BSD's `stat -f %m`. The
        # reverse order is unsafe — GNU treats `-f` as --file-system and prints
        # a "File:" block to stdout, which would poison the arithmetic below.
        # Guard to a number so a non-numeric result can never trip `set -u`.
        lock_mtime="$(stat -c %Y "$LOCK_DIR" 2>/dev/null || stat -f %m "$LOCK_DIR" 2>/dev/null || echo 0)"
        [[ "$lock_mtime" =~ ^[0-9]+$ ]] || lock_mtime=0
        if (( $(date +%s) - lock_mtime > LOCK_STALE_SECS )); then
            echo "==> Breaking stale immutable-pool lock ($LOCK_DIR)"
            rmdir "$LOCK_DIR" 2>/dev/null || true
            continue
        fi
        sleep 1
        waited=$((waited + 1))
        if (( waited > LOCK_STALE_SECS + 30 )); then
            echo "error: could not acquire immutable-pool lock after ${waited}s" >&2
            exit 1
        fi
    done

    (
        trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

        echo "==> Merging immutable assets into shared pool: ${SHARED_IMMUTABLE}"
        mkdir -p "$SHARED_IMMUTABLE"

        # For each chunk this release ships: copy it in if the pool doesn't
        # already have it (a new hash), otherwise just refresh its mtime.
        # Refreshing the mtime makes the eviction below measure age from the
        # last deploy that shipped a chunk, not the first time it appeared.
        # `find -print0` is portable across BSD (macOS test harness) and GNU;
        # `find -printf` is GNU-only — avoid it.
        #
        # Writes are ATOMIC (copy to a temp name, then rename): the pool is now
        # SERVED (hydrated into every release below), so a deploy killed
        # mid-copy — OOM, dropped SSH, the crash class the stale-lock breaker
        # above exists for — must never leave a truncated chunk under a
        # content-hashed name where every future release would link and serve
        # it. The rename also keeps in-flight downloads of an existing chunk
        # safe, which the old skip-if-exists branch protected with plain cp.
        # Existing entries are re-copied when their size disagrees with the
        # staged file: that repairs any truncated entry from a pre-atomic-era
        # crash the next time a build ships the same hash.
        ( cd "$STAGE_IMMUTABLE" && find . -type f -print0 ) \
            | while IFS= read -r -d '' rel; do
                  src="${STAGE_IMMUTABLE}/${rel}"
                  dest="${SHARED_IMMUTABLE}/${rel}"
                  if [[ -f "$dest" ]] && [[ "$(wc -c <"$dest")" -eq "$(wc -c <"$src")" ]]; then
                      touch -c "$dest"
                  else
                      mkdir -p "$(dirname "$dest")"
                      cp "$src" "${dest}.tmp.$$"
                      mv -f "${dest}.tmp.$$" "$dest"
                  fi
              done

        # Evict chunks no deploy has shipped in POOL_RETENTION_DAYS (default 30)
        # — far longer than any realistic open-tab lifetime. Bounds disk growth
        # while keeping recently-open tabs working. This, not KEEP_RELEASES,
        # governs how stale a tab may be before its chunks disappear.
        RETAIN="${POOL_RETENTION_DAYS:-30}"
        find "$SHARED_IMMUTABLE" -type f -mtime "+${RETAIN}" -delete 2>/dev/null || true
        find "$SHARED_IMMUTABLE" -mindepth 1 -type d -empty -delete 2>/dev/null || true

        # Hydrate the staged release from the pool: hardlink every pooled
        # chunk this build doesn't ship into the release's own client dir, so
        # the NODE SERVER itself serves prior releases' chunks. Serving was
        # designed to come from nginx's /_app/immutable/ alias onto the pool
        # (nginx/mankunku.conf), but that block never went live on the box —
        # verified 2026-07-25 when a 10-day-old chunk URL 404'd in production
        # while this pool held 555MB of chunks nothing was serving. Node-side
        # serving lives entirely in this script, so it cannot rot on the box;
        # if the nginx alias ever lands it simply answers first for the same
        # bytes. Hardlinks add no disk cost and keep serving even after pool
        # eviction (the inode survives until its last link goes). Runs AFTER
        # eviction so beyond-retention chunks are not resurrected, and inside
        # the pool lock so a concurrent deploy's eviction can't race the link
        # loop. `ln` falls back to `cp` for cross-filesystem layouts.
        echo "==> Hydrating staged release from shared pool"
        ( cd "$SHARED_IMMUTABLE" && find . -type f -print0 ) \
            | while IFS= read -r -d '' rel; do
                  dest="${STAGE_IMMUTABLE}/${rel}"
                  if [[ ! -e "$dest" ]]; then
                      mkdir -p "$(dirname "$dest")"
                      ln "${SHARED_IMMUTABLE}/${rel}" "$dest" 2>/dev/null \
                          || cp "${SHARED_IMMUTABLE}/${rel}" "$dest"
                  fi
              done
    )
else
    echo "==> No _app/immutable in staged build; skipping shared pool merge"
fi

# Swap `current` to point at the new release.
#
# The previous version of this code used `mv -f TMP_LINK current` — that was
# broken: when `current` is a symlink to a directory, `mv` dereferences the
# symlink and moves TMP_LINK *into* that directory rather than replacing the
# symlink (rename(2) would have been fine, but mv adds its own "target is a
# dir" heuristic on top). Every atomic-release deploy since 5ff2fc4 silently
# left `current` pointing at the pre-migration dir and the snapshot
# diagnostics on 2026-04-23 caught it.
#
# `ln -sfn` does the right thing: `-f` removes the existing symlink, `-n`
# ensures a symlink-to-dir destination isn't followed. Not strictly atomic
# (millisecond-scale window between unlink and re-link) but PM2 isn't running
# during this window, so no live-traffic race.
echo "==> Swapping current -> releases/${RELEASE_ID}"
if [[ -e "${ROOT}/current" && ! -L "${ROOT}/current" ]]; then
    echo "error: ${ROOT}/current exists and is not a symlink; refusing to swap" >&2
    exit 1
fi
ln -sfn "releases/${RELEASE_ID}" "${ROOT}/current"

snapshot_ecosystem "via current/ after swap" "${ROOT}/current/ecosystem.config.cjs"

echo "==> Restarting PM2 against new release"
# `pm2 startOrRestart` reuses the existing in-daemon app definition when one
# is already registered (from a prior `pm2 save` / `pm2 resurrect`), which
# means changes to script/cwd in ecosystem.config.cjs are silently ignored.
# Deleting first guarantees the new ecosystem config is applied verbatim.
# We cd into `current` because `pm2 start ecosystem.config.cjs` looks up the
# config file relative to its own cwd and does not search parent dirs.
(
    cd "${ROOT}/current"

    # Pre-flight: log what PM2 is about to see. Past deploys failed with
    # "Script not found" because PM2 resolved against an unexpected cwd;
    # these lines make the cause visible in CI logs on any future failure.
    echo "    pwd: $(pwd)"
    echo "    ecosystem.config.cjs cwd/script:"
    { grep -E "^[[:space:]]*(cwd|script):" ecosystem.config.cjs || true; } | sed 's/^/      /'
    echo "    build/index.js: $(test -f build/index.js && echo OK || echo MISSING)"
    # Runtime secrets live in a git-ignored file loaded by ecosystem.config.cjs
    # (ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY). Mirror the loader's path
    # (including the MANKUNKU_RUNTIME_ENV_FILE override) and check readability,
    # not just existence, so this reflects what the loader can actually read.
    # File-only secrets (e.g. ANTHROPIC_API_KEY) go unset when it's absent or
    # unreadable; others may still arrive via the inherited login-shell env.
    runtime_env_file="${MANKUNKU_RUNTIME_ENV_FILE:-${ROOT}/shared/runtime.env}"
    if [[ -f "$runtime_env_file" && -r "$runtime_env_file" ]]; then
        runtime_env_status="present"
    elif [[ -e "$runtime_env_file" ]]; then
        runtime_env_status="UNREADABLE (file-only secrets unset; others via inherited env)"
    else
        runtime_env_status="MISSING (file-only secrets unset; others via inherited env)"
    fi
    echo "    runtime env: ${runtime_env_file}: ${runtime_env_status}"

    pm2 delete mankunku 2>/dev/null || true
    pm2 start ecosystem.config.cjs --env production
    pm2 save
) 9>&-

echo "==> Pruning old releases (keep last ${KEEP_RELEASES:-5})"
KEEP="${KEEP_RELEASES:-5}"
# `ls -1t` lists by mtime, newest first. Portable across macOS and Linux
# (unlike `find -printf`, which is GNU-only and matters for the local test
# harness). `tail -n +N` skips the first KEEP entries; the rest are pruned.
cd "${ROOT}/releases"
# shellcheck disable=SC2012
ls -1t | tail -n +$((KEEP + 1)) | while read -r dir; do
    [[ -n "$dir" ]] || continue
    # Release IDs are generated by CI as YYYYMMDD-HHMMSS-<7-hex>. Anything else
    # is human-created (or worse) and must not be passed to `rm -rf`.
    if [[ ! "$dir" =~ ^[0-9]{8}-[0-9]{6}-[0-9a-f]{7}$ ]]; then
        echo "    skipping non-matching release-id: $(printf '%q' "$dir")" >&2
        continue
    fi
    echo "    pruning releases/${dir}"
    rm -rf -- "$dir"
done

echo "==> Done. Live release: $(readlink "${ROOT}/current")"
