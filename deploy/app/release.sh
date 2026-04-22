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

STAGE="${ROOT}/releases/${RELEASE_ID}"
if [[ ! -d "$STAGE" ]]; then
    echo "error: staged release not found: $STAGE" >&2
    exit 2
fi

echo "==> Installing production dependencies in staged release"
(
    cd "$STAGE"
    npm ci --omit=dev
)

# Atomic symlink swap: write a temporary symlink, then rename it over `current`.
# `mv -f` uses rename(2), which is atomic on POSIX filesystems. When the
# destination is itself a symlink (not a directory), rename(2) replaces the
# symlink in one step without following it — so no -T flag needed (GNU-only).
echo "==> Swapping current -> releases/${RELEASE_ID}"
TMP_LINK="${ROOT}/current.tmp.$$"
ln -sfn "releases/${RELEASE_ID}" "$TMP_LINK"
mv -f "$TMP_LINK" "${ROOT}/current"

echo "==> Restarting PM2 against new release"
pm2 startOrRestart "${ROOT}/current/ecosystem.config.cjs" --env production
pm2 save

echo "==> Pruning old releases (keep last ${KEEP_RELEASES:-5})"
KEEP="${KEEP_RELEASES:-5}"
# `ls -1t` lists by mtime, newest first. Portable across macOS and Linux
# (unlike `find -printf`, which is GNU-only and matters for the local test
# harness). `tail -n +N` skips the first KEEP entries; the rest are pruned.
cd "${ROOT}/releases"
# shellcheck disable=SC2012
ls -1t | tail -n +$((KEEP + 1)) | while read -r dir; do
    [[ -n "$dir" ]] || continue
    echo "    pruning releases/${dir}"
    rm -rf -- "$dir"
done

echo "==> Done. Live release: $(readlink "${ROOT}/current")"
