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

# Atomic symlink swap: write a temporary symlink, then rename it over `current`.
# `mv -f` uses rename(2), which is atomic on POSIX filesystems. When the
# destination is itself a symlink (not a directory), rename(2) replaces the
# symlink in one step without following it — so no -T flag needed (GNU-only).
echo "==> Swapping current -> releases/${RELEASE_ID}"
TMP_LINK="${ROOT}/current.tmp.$$"
# Clean up the temp symlink if anything below fails before the mv completes.
trap 'rm -f "$TMP_LINK"' EXIT
ln -sfn "releases/${RELEASE_ID}" "$TMP_LINK"
# If `current` exists as a real directory (not a symlink), `mv -f` would move
# TMP_LINK *into* it rather than replacing it. Abort instead.
if [[ -e "${ROOT}/current" && ! -L "${ROOT}/current" ]]; then
    echo "error: ${ROOT}/current exists and is not a symlink; refusing to swap" >&2
    exit 1
fi
mv -f "$TMP_LINK" "${ROOT}/current"
trap - EXIT

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
