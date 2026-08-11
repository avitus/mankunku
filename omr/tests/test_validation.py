"""Deterministic validation tests: flag, never rewrite."""

from omr.abc_parser import parse_abc
from omr.models import BackendInfo, OMRResult, RawPage
from omr.normalize import normalize
from omr.validation import validate


def _result(pages: list[RawPage], raw: str = "X:1\nK:C\nC4 |]\n") -> OMRResult:
    return OMRResult(
        raw_transcription=raw,
        format="abc",
        raw_pages=pages,
        backend=BackendInfo(name="fake", model_id=None, revision=None, version="0", device=None),
        warnings=[],
    )


def _normalized(abc: str):
    score, warnings = parse_abc(abc)
    return normalize(score, warnings)


def test_clean_score_produces_no_warnings() -> None:
    norm = _normalized("X:1\nM:4/4\nL:1/4\nK:C\nCDEF | GABc |]\n")
    assert validate(norm, _result([RawPage(0, "x")])) == []


def test_measure_duration_mismatch_flagged() -> None:
    norm = _normalized("X:1\nM:4/4\nL:1/4\nK:C\nCDEF | GAB | CDEF |]\n")
    warnings = validate(norm, _result([RawPage(0, "x")]))

    codes = [(w.code, w.measure) for w in warnings]
    assert ("MEASURE_DURATION_MISMATCH", 2) in codes
    assert all(m != 1 and m != 3 for c, m in codes if c == "MEASURE_DURATION_MISMATCH")


def test_pickup_measure_not_flagged() -> None:
    # A short measure 1 is a plausible pickup — recognized, not an error.
    norm = _normalized("X:1\nM:4/4\nL:1/4\nK:C\nEF | GABc |]\n")
    warnings = validate(norm, _result([RawPage(0, "x")]))
    assert not any(w.code == "MEASURE_DURATION_MISMATCH" for w in warnings)


def test_overfull_first_measure_still_flagged() -> None:
    norm = _normalized("X:1\nM:4/4\nL:1/4\nK:C\nCDEFG | GABc |]\n")
    warnings = validate(norm, _result([RawPage(0, "x")]))
    assert any(w.code == "MEASURE_DURATION_MISMATCH" and w.measure == 1 for w in warnings)


def test_unparsed_measure_skips_duration_check() -> None:
    norm = _normalized("X:1\nM:4/4\nL:1/4\nK:C\nCDEF | ??garbage?? | GABc |]\n")
    warnings = validate(norm, _result([RawPage(0, "x")]))
    assert not any(w.code == "MEASURE_DURATION_MISMATCH" for w in warnings)


def test_empty_page_flagged() -> None:
    norm = _normalized("X:1\nM:4/4\nL:1/4\nK:C\nCDEF |]\n")
    warnings = validate(norm, _result([RawPage(0, "x"), RawPage(1, "   \n")]))
    assert any(w.code == "EMPTY_PAGE" and w.page == 1 for w in warnings)


def test_possible_truncation_flagged_from_token_count() -> None:
    norm = _normalized("X:1\nM:4/4\nL:1/4\nK:C\nCDEF |]\n")
    warnings = validate(
        norm,
        _result([RawPage(0, "x", token_count=2048)]),
        generation_limit=2048,
    )
    assert any(w.code == "POSSIBLE_TRUNCATION" and w.page == 0 for w in warnings)


def test_no_truncation_warning_without_token_count() -> None:
    norm = _normalized("X:1\nM:4/4\nL:1/4\nK:C\nCDEF |]\n")
    warnings = validate(norm, _result([RawPage(0, "x", token_count=None)]))
    assert not any(w.code == "POSSIBLE_TRUNCATION" for w in warnings)


def test_no_measures_from_nonempty_output_flagged() -> None:
    score, parse_warnings = parse_abc("total garbage, no abc here at all")
    norm = normalize(score, parse_warnings)
    warnings = validate(norm, _result([RawPage(0, "total garbage")]))
    assert any(w.code == "UNPARSEABLE_OUTPUT" for w in warnings)
