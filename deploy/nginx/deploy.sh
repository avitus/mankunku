#!/usr/bin/env bash
# deploy/nginx/deploy.sh — Deploy nginx config for mankunkujazz.com.
#
# Runs ON THE SERVER. CircleCI scps this script and the new config to /tmp,
# then invokes this script via SSH. Can also be run by hand after copying the
# staged config onto the server.
#
# Usage:
#   bash deploy.sh <path-to-staged-config>
#
# Example:
#   bash deploy.sh /tmp/mankunku.nginx.staged
#
# Behavior:
#   1. Back up /etc/nginx/sites-available/mankunku to a timestamped file.
#   2. Install the staged config at the live path (mode 0644, root:root).
#   3. Ensure the sites-enabled symlink exists.
#   4. Run `sudo nginx -t`.
#   5. On success: reload nginx.
#   6. On failure: restore the backup, re-validate, and exit non-zero.

set -euo pipefail

STAGED_CONFIG="${1:-}"
LIVE_CONFIG="/etc/nginx/sites-available/mankunku"
ENABLED_LINK="/etc/nginx/sites-enabled/mankunku"
BACKUP_DIR="/etc/nginx/backups"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="${BACKUP_DIR}/mankunku.${TIMESTAMP}.conf"

if [[ -z "$STAGED_CONFIG" ]]; then
    echo "error: missing staged config path" >&2
    echo "usage: $0 <path-to-staged-config>" >&2
    exit 2
fi

if [[ ! -f "$STAGED_CONFIG" ]]; then
    echo "error: staged config not found: $STAGED_CONFIG" >&2
    exit 2
fi

echo "==> Ensuring backup directory exists"
sudo mkdir -p "$BACKUP_DIR"

BACKED_UP=0
if [[ -f "$LIVE_CONFIG" ]]; then
    echo "==> Backing up ${LIVE_CONFIG} -> ${BACKUP_FILE}"
    sudo cp -p "$LIVE_CONFIG" "$BACKUP_FILE"
    BACKED_UP=1
else
    echo "==> No existing live config at ${LIVE_CONFIG} (first deploy)"
fi

echo "==> Installing new config at ${LIVE_CONFIG}"
sudo install -m 0644 -o root -g root "$STAGED_CONFIG" "$LIVE_CONFIG"

if [[ ! -L "$ENABLED_LINK" ]]; then
    echo "==> Creating sites-enabled symlink"
    sudo ln -sf "$LIVE_CONFIG" "$ENABLED_LINK"
fi

echo "==> Validating nginx config (nginx -t)"
if ! sudo nginx -t; then
    echo "!!! nginx config test failed — rolling back" >&2
    if [[ "$BACKED_UP" -eq 1 ]]; then
        sudo install -m 0644 -o root -g root "$BACKUP_FILE" "$LIVE_CONFIG"
        echo "==> Re-validating after rollback"
        sudo nginx -t
    else
        sudo rm -f "$LIVE_CONFIG" "$ENABLED_LINK"
    fi
    exit 1
fi

echo "==> Reloading nginx"
sudo systemctl reload nginx

echo "==> Cleaning up staged config"
rm -f "$STAGED_CONFIG"

echo "==> Done. Backup kept at ${BACKUP_FILE}"
