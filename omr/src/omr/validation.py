"""Deterministic transcription validation — flags, never rewrites.

Every rule here is a mechanical check with an explicit trigger. No rule
modifies the transcription, and no rule produces a numeric confidence —
only named observations a human (or benchmark) can act on.
"""

from __future__ import annotations

from fractions import Fraction

from omr.models import Measure, NormalizedScore, OMRResult, OMRWarning


def validate(
    normalized: NormalizedScore,
    result: OMRResult,
    *,
    generation_limit: int = 2048,
) -> list[OMRWarning]:
    warnings: list[OMRWarning] = []
    warnings.extend(_check_measure_durations(normalized))
    warnings.extend(_check_pages(result, generation_limit))
    warnings.extend(_check_any_content(normalized, result))
    return warnings


def _measure_total(measure: Measure) -> Fraction:
    return sum((note.duration for note in measure.notes), Fraction(0))


def _check_measure_durations(normalized: NormalizedScore) -> list[OMRWarning]:
    warnings: list[OMRWarning] = []
    measures = normalized.measures
    if not measures:
        return warnings

    def expected_for(measure: Measure) -> Fraction | None:
        meter = measure.meter or normalized.time_signature
        return Fraction(*meter) if meter else None

    first_expected = expected_for(measures[0])
    first_is_short = (
        first_expected is not None and _measure_total(measures[0]) < first_expected
    )

    for measure in measures:
        if measure.raw_unparsed:
            continue  # already flagged as unparseable; a duration check would double-count
        expected = expected_for(measure)
        if expected is None:
            continue
        total = _measure_total(measure)
        if total == expected:
            continue
        if measure.number == 1 and total < expected:
            continue  # plausible pickup measure — recognized, not an error
        if measure.number == len(measures) and total < expected and first_is_short:
            continue  # final measure complementing the pickup
        warnings.append(
            OMRWarning(
                code="MEASURE_DURATION_MISMATCH",
                message=(
                    f"measure {measure.number} sums to {total} of an expected "
                    f"{expected} whole notes"
                ),
                measure=measure.number,
            )
        )
    return warnings


def _check_pages(result: OMRResult, generation_limit: int) -> list[OMRWarning]:
    warnings: list[OMRWarning] = []
    truncation_floor = int(generation_limit * 0.98)
    for page in result.raw_pages:
        if not page.text.strip():
            warnings.append(
                OMRWarning(
                    code="EMPTY_PAGE",
                    message=f"page {page.page_index + 1} produced no transcription output",
                    page=page.page_index,
                )
            )
        if page.token_count is not None and page.token_count >= truncation_floor:
            warnings.append(
                OMRWarning(
                    code="POSSIBLE_TRUNCATION",
                    message=(
                        f"page {page.page_index + 1} output used {page.token_count} of "
                        f"{generation_limit} tokens — the tail of the page may be missing"
                    ),
                    page=page.page_index,
                )
            )
    return warnings


def _check_any_content(normalized: NormalizedScore, result: OMRResult) -> list[OMRWarning]:
    has_content = any(m.notes or m.chords for m in normalized.measures)
    if has_content or not result.raw_transcription.strip():
        return []
    return [
        OMRWarning(
            code="UNPARSEABLE_OUTPUT",
            message="transcription output contained no readable measures",
        )
    ]
