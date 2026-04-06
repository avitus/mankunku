#!/bin/bash
# Fetch CodeRabbit review comments after git push.
# Polls the GitHub API until CodeRabbit posts a review, then outputs
# the findings for Claude to read and address.

set -euo pipefail

BRANCH=$(git branch --show-current 2>/dev/null)
if [ -z "$BRANCH" ]; then
  exit 0
fi

# Check if there's an open PR for this branch
PR_NUMBER=$(gh pr view "$BRANCH" --json number -q '.number' 2>/dev/null || true)
if [ -z "$PR_NUMBER" ]; then
  exit 0
fi

REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')
PUSH_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)

CR_USER="coderabbitai[bot]"

# Poll for CodeRabbit review (10 attempts, 15s apart = ~2.5 min)
for i in $(seq 1 10); do
  sleep 15

  # Check for a CodeRabbit review submitted after the push
  REVIEW_BODY=$(gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" \
    --jq '[.[] | select(.user.login == "'"$CR_USER"'" and .submitted_at > "'"$PUSH_TIME"'")] | last | .body // empty' 2>/dev/null || true)

  if [ -n "$REVIEW_BODY" ]; then
    # Fetch inline review comments posted after the push
    INLINE=$(gh api "repos/$REPO/pulls/$PR_NUMBER/comments" \
      --jq '[.[] | select(.user.login == "'"$CR_USER"'" and .created_at > "'"$PUSH_TIME"'")] | .[] | "In `" + .path + "`:\n- Around line " + (.line // .original_line // "?" | tostring) + ": " + .body + "\n"' 2>/dev/null || true)

    # Fetch the issue-level summary comment (CodeRabbit's walkthrough)
    SUMMARY=$(gh api "repos/$REPO/issues/$PR_NUMBER/comments" \
      --jq '[.[] | select(.user.login == "'"$CR_USER"'" and .created_at > "'"$PUSH_TIME"'")] | last | .body // empty' 2>/dev/null || true)

    echo "CodeRabbit review for PR #$PR_NUMBER on branch $BRANCH:"
    echo ""

    if [ -n "$SUMMARY" ]; then
      echo "=== Summary ==="
      echo "$SUMMARY"
      echo ""
    fi

    if [ -n "$REVIEW_BODY" ]; then
      echo "=== Review ==="
      echo "$REVIEW_BODY"
      echo ""
    fi

    if [ -n "$INLINE" ]; then
      echo "=== Inline Comments ==="
      echo "$INLINE"
    fi

    if [ -z "$INLINE" ] && [ -z "$REVIEW_BODY" ] && [ -z "$SUMMARY" ]; then
      echo "No actionable comments from CodeRabbit."
    fi

    exit 0
  fi
done

echo "CodeRabbit review not received within 2.5 minutes for PR #$PR_NUMBER. You can check manually: gh api repos/$REPO/pulls/$PR_NUMBER/reviews"
exit 0
