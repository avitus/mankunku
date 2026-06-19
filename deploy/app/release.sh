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

echo "==> Installing production dependencies in staged release"
(
    cd "$STAGE"
    npm ci --omit=dev
)

snapshot_ecosystem "after npm ci" "${STAGE}/ecosystem.config.cjs"

# --- Shared immutable-asset pool (fixes Sentry MANKUNKU-8) ---
#
# Each deploy stages its own build/ and `current` flips to it atomically, so the
# server only ever serves THIS release's _app/immutable chunks. But those chunks
# are content-hashed precisely so old and new can coexist: a browser tab opened
# against an older deploy still requests that deploy's chunk hashes. Serving only
# `current`'s assets 404s them ("error loading dynamically imported module").
#
# Keep every release's immutable assets in one shared, accumulating pool so a tab
# on any recent version can still fetch its chunks. nginx serves /_app/immutable/
# straight from this pool (see nginx/mankunku.conf), with Node as the fallback.
# Content hashes never collide, so the union is always self-consistent.
SHARED_IMMUTABLE="${ROOT}/shared/_app/immutable"
STAGE_IMMUTABLE="${STAGE}/build/client/_app/immutable"
if [[ -d "$STAGE_IMMUTABLE" ]]; then
    echo "==> Merging immutable assets into shared pool: ${SHARED_IMMUTABLE}"
    mkdir -p "$SHARED_IMMUTABLE"

    # For each chunk this release ships: copy it in if the pool doesn't already
    # have it (a new hash), otherwise just refresh its mtime. Copying only the
    # missing files means an in-flight download of an existing (identical) chunk
    # by another tab is never truncated. Refreshing the mtime makes the eviction
    # below measure age from the last deploy that shipped a chunk, not the first
    # time it appeared. `find -print0` is portable across BSD (macOS test
    # harness) and GNU; `find -printf` is GNU-only — avoid it. (BSD `cp -n`
    # exits non-zero when it skips, so we branch on existence ourselves rather
    # than rely on a no-clobber flag.)
    ( cd "$STAGE_IMMUTABLE" && find . -type f -print0 ) \
        | while IFS= read -r -d '' rel; do
              dest="${SHARED_IMMUTABLE}/${rel}"
              if [[ -f "$dest" ]]; then
                  touch -c "$dest"
              else
                  mkdir -p "$(dirname "$dest")"
                  cp "${STAGE_IMMUTABLE}/${rel}" "$dest"
              fi
          done

    # Evict chunks no deploy has shipped in POOL_RETENTION_DAYS (default 30) —
    # far longer than any realistic open-tab lifetime. Bounds disk growth while
    # keeping recently-open tabs working. This, not KEEP_RELEASES, governs how
    # stale a tab may be before its chunks disappear.
    RETAIN="${POOL_RETENTION_DAYS:-30}"
    find "$SHARED_IMMUTABLE" -type f -mtime "+${RETAIN}" -delete 2>/dev/null || true
    find "$SHARED_IMMUTABLE" -mindepth 1 -type d -empty -delete 2>/dev/null || true
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

    pm2 delete mankunku 2>/dev/null || true
    pm2 start ecosystem.config.cjs --env production
    pm2 save
)

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
