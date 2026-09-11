"""Deterministic validation tests: flag, never rewrite."""

import pytest

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


def _mismatches(abc: str) -> list[tuple[str, int | None]]:
    warnings = validate(_normalized(abc), _result([RawPage(0, "x")]))
    return [(w.code, w.measure) for w in warnings]


def test_short_final_measure_is_exempt_only_when_the_first_is_a_pickup() -> None:
    # The pickup's complement: a chart that opens on a partial bar closes on
    # one, and together they make a full bar. Without the pickup a short last
    # bar is a real mismatch, and an OVERFULL last bar always is.
    assert _mismatches("X:1\nM:4/4\nL:1/4\nK:C\nEF | GABc | CDEF | GA |]\n") == []
    assert _mismatches("X:1\nM:4/4\nL:1/4\nK:C\nCDEF | GABc | GA |]\n") == [
        ("MEASURE_DURATION_MISMATCH", 3)
    ]
    assert _mismatches("X:1\nM:4/4\nL:1/4\nK:C\nEF | GABc | GABcd |]\n") == [
        ("MEASURE_DURATION_MISMATCH", 3)
    ]


def test_short_final_measure_must_complement_the_pickup_to_exactly_one_bar() -> None:
    # Same rule as the app's importer (omr-transcription.ts, 2026-09-10): a
    # 1-beat pickup and a 2-beat final bar do not make a bar — a beat is
    # missing somewhere, and being short at both ends must not hide it.
    assert _mismatches("X:1\nM:4/4\nL:1/4\nK:C\nE | GABc | CDEF | GA |]\n") == [
        ("MEASURE_DURATION_MISMATCH", 4)
    ]
    assert _mismatches("X:1\nM:4/4\nL:1/4\nK:C\nE | GABc | CDEF | GAB |]\n") == []


def test_a_lone_short_measure_is_not_a_pickup() -> None:
    # A pickup leads into a form. A transcription that is ONE partial bar has
    # nothing after it to pick up into, and is its own final measure too — so
    # neither exemption applies and the shortfall is flagged.
    assert _mismatches("X:1\nM:4/4\nL:1/4\nK:C\nGA |]\n") == [("MEASURE_DURATION_MISMATCH", 1)]


def test_pickup_does_not_excuse_a_short_measure_mid_score() -> None:
    assert _mismatches("X:1\nM:4/4\nL:1/4\nK:C\nEF | GA | CDEF |]\n") == [
        ("MEASURE_DURATION_MISMATCH", 2)
    ]


def test_no_meter_means_no_duration_expectation() -> None:
    # Absent = None: without a printed meter there is nothing to measure
    # against, and no 4/4 is assumed.
    assert _mismatches("X:1\nL:1/4\nK:C\nCDEF | GAB |]\n") == []


def test_inline_meter_change_sets_the_expectation_per_measure() -> None:
    assert _mismatches("X:1\nM:4/4\nL:1/4\nK:C\nCDEF | [M:3/4] CDE | CDEF |]\n") == [
        ("MEASURE_DURATION_MISMATCH", 3)
    ]


@pytest.mark.parametrize("token_count,flagged", [(2006, False), (2007, True)])
def test_truncation_floor_is_98_percent_of_the_generation_limit(token_count, flagged) -> None:
    norm = _normalized("X:1\nM:4/4\nL:1/4\nK:C\nCDEF |]\n")
    warnings = validate(
        norm, _result([RawPage(0, "x", token_count=token_count)]), generation_limit=2048
    )
    assert any(w.code == "POSSIBLE_TRUNCATION" for w in warnings) is flagged


def test_blank_output_is_not_reported_twice() -> None:
    # The parser already warns UNPARSEABLE_OUTPUT on empty text; validation
    # must not stack a second one on top of the EMPTY_PAGE observation.
    score, parse_warnings = parse_abc("   \n")
    norm = normalize(score, parse_warnings)
    codes = [w.code for w in validate(norm, _result([RawPage(0, "   ")], raw="   \n"))]
    assert codes == ["EMPTY_PAGE"]
    assert [w.code for w in parse_warnings] == ["UNPARSEABLE_OUTPUT"]
