"""Data-model construction and JSON round-trip tests.

The serialization convention mirrors the app: Fractions become [numerator,
denominator] pairs; absent information is null, never a default value.
"""

from fractions import Fraction

from omr.models import (
    BackendInfo,
    ChordSymbol,
    Measure,
    NormalizedScore,
    NoteEvent,
    OMRResult,
    OMRWarning,
    ParsedChord,
    RawPage,
    normalized_score_from_dict,
    omr_result_from_dict,
)


def _sample_score() -> NormalizedScore:
    return NormalizedScore(
        title="Lady Bird",
        composer=None,
        key_signature="C",
        time_signature=(4, 4),
        tempo=None,
        measures=[
            Measure(
                number=1,
                chords=[
                    ChordSymbol(
                        raw="Db7",
                        onset=Fraction(1, 2),
                        parsed=ParsedChord(
                            root_letter="D",
                            root_accidental="b",
                            quality="7",
                            alterations=(),
                            bass=None,
                        ),
                    )
                ],
                notes=[
                    NoteEvent(
                        spelled_pitch="Db4",
                        midi=61,
                        onset=Fraction(0, 1),
                        duration=Fraction(1, 4),
                    ),
                    NoteEvent(
                        spelled_pitch=None,
                        midi=None,
                        onset=Fraction(1, 4),
                        duration=Fraction(1, 12),
                        is_rest=True,
                        tuplet=(3, 2),
                    ),
                ],
                start_repeat=True,
                ending=1,
                rehearsal_mark="A",
                raw_unparsed=["??garbage??"],
                warnings=[OMRWarning(code="UNPARSEABLE_REGION", message="m1", measure=1)],
            )
        ],
        text_annotations=["Medium swing"],
        warnings=[OMRWarning(code="TEXT_ELIDED_BY_MODEL", message="text elided", page=0)],
    )


def test_normalized_score_json_round_trip() -> None:
    score = _sample_score()
    data = score.to_dict()

    # Fractions serialize as [num, den]
    assert data["measures"][0]["notes"][0]["duration"] == [1, 4]
    assert data["measures"][0]["chords"][0]["onset"] == [1, 2]
    # Absent info is null, not a default
    assert data["composer"] is None
    assert data["tempo"] is None

    back = normalized_score_from_dict(data)
    assert back == score


def test_note_event_defaults_are_not_inferred() -> None:
    rest = NoteEvent(
        spelled_pitch=None, midi=None, onset=Fraction(0), duration=Fraction(1, 4), is_rest=True
    )
    assert rest.spelled_pitch is None
    assert rest.midi is None
    assert rest.tuplet is None
    assert rest.tied_to_next is False


def test_omr_result_round_trip() -> None:
    result = OMRResult(
        raw_transcription="X:1\nK:C\nCDEF|",
        format="abc",
        raw_pages=[RawPage(page_index=0, text="X:1\nK:C\nCDEF|", token_count=12)],
        backend=BackendInfo(
            name="fake",
            model_id="fake/model",
            revision="abc123",
            version="0.1.0",
            device="cpu",
            details={"beams": 5},
        ),
        warnings=[OMRWarning(code="EMPTY_PAGE", message="page 2 empty", page=2)],
        metadata={"source": "test.pdf"},
    )
    back = omr_result_from_dict(result.to_dict())
    assert back == result
    # raw transcription is preserved verbatim
    assert back.raw_transcription == "X:1\nK:C\nCDEF|"
