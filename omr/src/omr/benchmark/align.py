"""Alignment primitives: LCS with traceback, Needleman-Wunsch over measures."""

from __future__ import annotations

from collections.abc import Hashable, Sequence

GAP_PENALTY = -0.25


def lcs_pairs(a: Sequence[Hashable], b: Sequence[Hashable]) -> list[tuple[int, int]]:
    """Longest-common-subsequence matching, returned as (index_a, index_b) pairs."""
    n, m = len(a), len(b)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            if a[i] == b[j]:
                dp[i][j] = dp[i + 1][j + 1] + 1
            else:
                dp[i][j] = max(dp[i + 1][j], dp[i][j + 1])
    pairs: list[tuple[int, int]] = []
    i = j = 0
    while i < n and j < m:
        if a[i] == b[j]:
            pairs.append((i, j))
            i += 1
            j += 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            i += 1
        else:
            j += 1
    return pairs


def _jaccard(a: set, b: set) -> float:
    union = a | b
    if not union:
        return 1.0  # two empty measures are structurally identical
    return len(a & b) / len(union)


def align_measures(
    gt_sets: list[set], pred_sets: list[set], *, gap_penalty: float = GAP_PENALTY
) -> list[tuple[int, int]]:
    """Global (Needleman-Wunsch) alignment of measure sequences.

    Similarity is the Jaccard overlap of each measure's pitch set, so the
    alignment follows musical content rather than raw position — a dropped
    measure shifts everything after it into the right pairing.
    """
    n, m = len(gt_sets), len(pred_sets)
    score = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        score[i][0] = score[i - 1][0] + gap_penalty
    for j in range(1, m + 1):
        score[0][j] = score[0][j - 1] + gap_penalty
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            score[i][j] = max(
                score[i - 1][j - 1] + _jaccard(gt_sets[i - 1], pred_sets[j - 1]),
                score[i - 1][j] + gap_penalty,
                score[i][j - 1] + gap_penalty,
            )

    pairs: list[tuple[int, int]] = []
    i, j = n, m
    while i > 0 and j > 0:
        diagonal = score[i - 1][j - 1] + _jaccard(gt_sets[i - 1], pred_sets[j - 1])
        if abs(score[i][j] - diagonal) < 1e-9:
            pairs.append((i - 1, j - 1))
            i -= 1
            j -= 1
        elif abs(score[i][j] - (score[i - 1][j] + gap_penalty)) < 1e-9:
            i -= 1
        else:
            j -= 1
    pairs.reverse()
    return pairs
