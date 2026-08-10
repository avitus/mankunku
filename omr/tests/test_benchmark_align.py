"""Alignment primitives: LCS with traceback, Needleman-Wunsch over measures."""

from omr.benchmark.align import align_measures, lcs_pairs


def test_lcs_pairs_identical() -> None:
    a = ["C4", "D4", "E4"]
    assert lcs_pairs(a, a) == [(0, 0), (1, 1), (2, 2)]


def test_lcs_pairs_with_insertion_and_miss() -> None:
    gt = ["C4", "D4", "E4", "F4"]
    pred = ["C4", "X4", "D4", "F4"]

    pairs = lcs_pairs(gt, pred)

    assert (0, 0) in pairs
    assert (1, 2) in pairs
    assert (3, 3) in pairs
    assert len(pairs) == 3  # E4 unmatched


def test_lcs_pairs_empty() -> None:
    assert lcs_pairs([], ["C4"]) == []
    assert lcs_pairs(["C4"], []) == []


def test_align_measures_one_to_one_when_equal() -> None:
    gt = [{"C4", "E4"}, {"G4"}, {"A4", "B4"}]
    pred = [{"C4", "E4"}, {"G4"}, {"A4", "B4"}]

    pairs = align_measures(gt, pred)

    assert pairs == [(0, 0), (1, 1), (2, 2)]


def test_align_measures_with_dropped_measure() -> None:
    gt = [{"C4"}, {"D4"}, {"E4"}, {"F4"}]
    pred = [{"C4"}, {"E4"}, {"F4"}]  # model dropped measure 2

    pairs = align_measures(gt, pred)

    assert (0, 0) in pairs
    assert (2, 1) in pairs
    assert (3, 2) in pairs
    assert all(g != 1 for g, _ in pairs)


def test_align_measures_prefers_content_over_position() -> None:
    gt = [{"C4", "D4"}, {"G5", "A5"}]
    pred = [{"G5", "A5"}]  # only the second measure survived

    pairs = align_measures(gt, pred)

    assert pairs == [(1, 0)]
