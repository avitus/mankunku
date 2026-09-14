"""Metric formula tests on tiny synthetic charts."""

from fractions import Fraction

import pytest

from omr.benchmark.metrics import evaluate_chart
from omr.models import ChordSymbol, Measure, NoteEvent


def _note(pitch: str | None, midi: int | None, onset, duration, **kw) -> NoteEvent:
    return NoteEvent(
        spelled_pitch=pitch,
        midi=midi,
        onset=Fraction(onset) if not isinstance(onset, Fraction) else onset,
        duration=Fraction(duration) if not isinstance(duration, Fraction) else duration,
        is_rest=pitch is None,
        **kw,
    )


def _measure(number: int, notes=None, chords=None, **flags) -> Measure:
    return Measure(number=number, notes=notes or [], chords=chords or [], **flags)


def _chord(raw: str, onset) -> ChordSymbol:
    from omr.chords import parse_chord

    return ChordSymbol(raw=raw, onset=Fraction(onset), parsed=parse_chord(raw))


GT = [
    _measure(
        1,
        notes=[
            _note("C4", 60, 0, Fraction(1, 4)),
            _note("Db4", 61, Fraction(1, 4), Fraction(1, 4)),
        ],
        chords=[_chord("Cmaj7", 0)],
        start_repeat=True,
        rehearsal_mark="A",
    ),
    _measure(
        2,
        notes=[_note("E4", 64, 0, Fraction(1, 2))],
        chords=[_chord("Db7", 0), _chord("G7", Fraction(1, 2))],
        end_repeat=True,
    ),
]


def test_perfect_prediction_scores_one() -> None:
    m = evaluate_chart(GT, GT, gt_key="C", pred_key="C", gt_ts=(4, 4), pred_ts=(4, 4))

    assert m.measure_count_error == 0
    assert m.measure_alignment.value == 1.0
    assert m.pitch_strict.value == 1.0
    assert m.pitch_midi.value == 1.0
    assert m.accidental.value == 1.0
    assert m.rhythm_exact.value == 1.0
    assert m.chord_exact.value == 1.0
    assert m.chord_root.value == 1.0
    assert m.chord_quality.value == 1.0
    assert m.chord_insertions == 0
    assert m.key_signature_match is True
    assert m.time_signature_match is True
    assert m.repeat_f1 == 1.0
    assert m.rehearsal_f1 == 1.0


def test_enharmonic_error_caught_by_strict_and_accidental_not_midi() -> None:
    pred = [
        _measure(
            1,
            notes=[
                _note("C4", 60, 0, Fraction(1, 4)),
                _note("C#4", 61, Fraction(1, 4), Fraction(1, 4)),  # printed Db4
            ],
            chords=[_chord("Cmaj7", 0)],
            start_repeat=True,
            rehearsal_mark="A",
        ),
        GT[1],
    ]
    m = evaluate_chart(GT, pred, gt_key="C", pred_key="C", gt_ts=(4, 4), pred_ts=(4, 4))

    assert m.pitch_midi.value == 1.0
    assert m.pitch_strict.value < 1.0
    assert m.accidental.num == 2 and m.accidental.den == 3


def test_rhythm_mismatch_detected() -> None:
    pred = [
        _measure(
            1,
            notes=[
                _note("C4", 60, 0, Fraction(1, 8)),  # wrong duration
                _note("Db4", 61, Fraction(1, 4), Fraction(1, 4)),
            ],
            chords=[_chord("Cmaj7", 0)],
            start_repeat=True,
            rehearsal_mark="A",
        ),
        GT[1],
    ]
    m = evaluate_chart(GT, pred, gt_key="C", pred_key="C", gt_ts=(4, 4), pred_ts=(4, 4))

    assert m.rhythm_exact.num == 2 and m.rhythm_exact.den == 3
    assert m.onset_only.value == 1.0
    assert m.duration_only.num == 2


def test_chord_metrics_distinguish_root_quality_exact() -> None:
    pred = [
        _measure(
            1,
            notes=list(GT[0].notes),
            chords=[_chord("CΔ7", 0)],  # same quality class, different spelling
            start_repeat=True,
            rehearsal_mark="A",
        ),
        _measure(
            2,
            notes=list(GT[1].notes),
            chords=[_chord("C#7", 0), _chord("Gm7", Fraction(1, 2))],
            end_repeat=True,
        ),
    ]
    m = evaluate_chart(GT, pred, gt_key="C", pred_key="C", gt_ts=(4, 4), pred_ts=(4, 4))

    # exact: nothing matches exactly (CΔ7 != Cmaj7 as text, C#7 != Db7, Gm7 != G7)
    assert m.chord_exact.num == 0 and m.chord_exact.den == 3
    # root: Cmaj7/CΔ7 match, G7/Gm7 match; Db7 vs C#7 is an enharmonic MISS
    assert m.chord_root.num == 2 and m.chord_root.den == 3
    # quality: maj7 matches (Δ7 == maj7 class); 7 vs 7 for Db/C# ... root failed but
    # quality compares independently; G7 vs Gm7 differ
    assert m.chord_quality.num == 2 and m.chord_quality.den == 3


def test_missing_chords_give_zero_and_empty_prediction_counts_no_insertions() -> None:
    pred = [
        _measure(1, notes=list(GT[0].notes), start_repeat=True, rehearsal_mark="A"),
        _measure(2, notes=list(GT[1].notes), end_repeat=True),
    ]
    m = evaluate_chart(GT, pred, gt_key="C", pred_key="C", gt_ts=(4, 4), pred_ts=(4, 4))

    assert m.chord_exact.num == 0 and m.chord_exact.den == 3
    assert m.chord_insertions == 0


def test_measure_count_error_and_alignment() -> None:
    pred = [GT[0]]  # second measure never transcribed
    m = evaluate_chart(GT, pred, gt_key="C", pred_key="C", gt_ts=(4, 4), pred_ts=(4, 4))

    assert m.measure_count_error == 1
    assert m.measure_alignment.num == 1 and m.measure_alignment.den == 2


def test_structure_mismatches() -> None:
    pred = [
        _measure(1, notes=list(GT[0].notes), chords=[_chord("Cmaj7", 0)]),
        _measure(2, notes=list(GT[1].notes), chords=list(GT[1].chords)),
    ]
    m = evaluate_chart(GT, pred, gt_key="Bb", pred_key="C", gt_ts=(3, 4), pred_ts=(4, 4))

    assert m.key_signature_match is False
    assert m.time_signature_match is False
    assert m.repeat_f1 == 0.0  # both repeat events missed
    assert m.rehearsal_f1 == 0.0


def test_chord_metrics_do_not_alias_repeated_chord_instances() -> None:
    # The same ChordSymbol INSTANCE reused across predicted measures must be
    # matched positionally — identity-keyed de-duplication would silently
    # skip the second occurrence and report a phantom insertion.
    shared = _chord("Cmaj7", 0)
    pred = [
        _measure(
            1, notes=list(GT[0].notes), chords=[shared], start_repeat=True, rehearsal_mark="A"
        ),
        _measure(2, notes=list(GT[1].notes), chords=[shared], end_repeat=True),
    ]
    gt = [
        _measure(
            1,
            notes=list(GT[0].notes),
            chords=[_chord("Cmaj7", 0)],
            start_repeat=True,
            rehearsal_mark="A",
        ),
        _measure(2, notes=list(GT[1].notes), chords=[_chord("Cmaj7", 0)], end_repeat=True),
    ]
    m = evaluate_chart(gt, pred, gt_key="C", pred_key="C", gt_ts=(4, 4), pred_ts=(4, 4))
    assert m.chord_exact.num == 2 and m.chord_exact.den == 2
    assert m.chord_insertions == 0


def test_unknown_key_or_time_signature_yields_none_not_a_miss() -> None:
    # Absent = None all the way through: an engine that did not read the key
    # gets n/a on that row, not a failure.
    m = evaluate_chart(GT, GT, gt_key="C", pred_key=None, gt_ts=(4, 4), pred_ts=None)
    assert m.key_signature_match is None
    assert m.time_signature_match is None
    # ...and surrounding whitespace is not a mismatch.
    m = evaluate_chart(GT, GT, gt_key="C", pred_key=" C ", gt_ts=(4, 4), pred_ts=(4, 4))
    assert m.key_signature_match is True


def test_extra_predicted_chord_counts_as_an_insertion() -> None:
    pred = [
        _measure(
            1,
            notes=list(GT[0].notes),
            chords=[_chord("Cmaj7", 0), _chord("G7", Fraction(1, 4))],
            start_repeat=True,
            rehearsal_mark="A",
        ),
        GT[1],
    ]
    m = evaluate_chart(GT, pred, gt_key="C", pred_key="C", gt_ts=(4, 4), pred_ts=(4, 4))

    assert m.chord_exact.num == 3 and m.chord_exact.den == 3
    assert m.chord_insertions == 1


def test_alterations_are_scored_only_where_root_and_quality_match() -> None:
    gt = [_measure(1, chords=[_chord("C7b9", 0)])]
    for pred_symbol, expected in (("C7b9", (1, 1)), ("C7", (0, 1)), ("Cm7", (0, 0))):
        pred = [_measure(1, chords=[_chord(pred_symbol, 0)])]
        m = evaluate_chart(gt, pred, gt_key=None, pred_key=None, gt_ts=None, pred_ts=None)
        assert (m.chord_alterations.num, m.chord_alterations.den) == expected, pred_symbol
    # den 0 is "nothing to score", surfaced as None rather than 0.0
    assert m.chord_alterations.value is None


def test_partial_repeat_recovery_scores_a_fractional_f1() -> None:
    end_repeat_missed = _measure(2, notes=list(GT[1].notes), chords=list(GT[1].chords))
    m = evaluate_chart(
        GT, [GT[0], end_repeat_missed], gt_key="C", pred_key="C", gt_ts=(4, 4), pred_ts=(4, 4)
    )
    assert m.repeat_f1 == pytest.approx(2 / 3)


def test_marks_on_unaligned_predicted_measures_are_false_positives() -> None:
    # An extra measure the model invented pairs with no ground-truth measure;
    # a rehearsal mark on it must count against precision, never vanish with
    # the measure.
    invented = _measure(3, notes=[_note("G5", 79, 0, Fraction(1, 4))], rehearsal_mark="B")
    m = evaluate_chart(
        GT, [*GT, invented], gt_key="C", pred_key="C", gt_ts=(4, 4), pred_ts=(4, 4)
    )

    assert m.measure_count_error == 1
    assert m.measure_alignment.value == 1.0
    assert m.rehearsal_f1 == pytest.approx(2 / 3)


def test_rests_are_excluded_from_melody_denominators() -> None:
    gt = [
        _measure(
            1,
            notes=[
                _note("C4", 60, 0, Fraction(1, 4)),
                _note(None, None, Fraction(1, 4), Fraction(1, 4)),
            ],
        )
    ]
    m = evaluate_chart(gt, gt, gt_key=None, pred_key=None, gt_ts=None, pred_ts=None)
    assert m.pitch_strict.den == 1 and m.pitch_midi.den == 1


def test_endings_count_as_repeat_events() -> None:
    # Volta brackets are part of the printed repeat structure (A-Train's
    # |1 ... :|2 is scored exactly): a missed ending costs repeat F1.
    gt = [
        _measure(1, notes=[_note("C4", 60, 0, 1)], start_repeat=True),
        _measure(2, notes=[_note("D4", 62, 0, 1)], ending=1, end_repeat=True),
        _measure(3, notes=[_note("E4", 64, 0, 1)], ending=2),
    ]
    m = evaluate_chart(gt, gt, gt_key=None, pred_key=None, gt_ts=None, pred_ts=None)
    assert m.repeat_f1 == 1.0

    no_endings = [
        gt[0],
        _measure(2, notes=list(gt[1].notes), end_repeat=True),
        _measure(3, notes=list(gt[2].notes)),
    ]
    m = evaluate_chart(gt, no_endings, gt_key=None, pred_key=None, gt_ts=None, pred_ts=None)
    assert m.repeat_f1 == pytest.approx(2 * 2 / (4 + 2))


def test_unparseable_chords_score_on_their_raw_text_only() -> None:
    # A symbol parse_chord cannot read is kept raw with parsed=None. It can
    # still match exactly as printed, but it never earns root/quality credit
    # it was never read into — and a malformed prediction earns nothing.
    gt = [_measure(1, chords=[_chord("N.C.", 0), _chord("C7", Fraction(1, 2))])]
    pred = [_measure(1, chords=[_chord("N.C.", 0), _chord("C7x", Fraction(1, 2))])]

    m = evaluate_chart(gt, pred, gt_key=None, pred_key=None, gt_ts=None, pred_ts=None)

    assert (m.chord_exact.num, m.chord_exact.den) == (1, 2)
    assert (m.chord_root.num, m.chord_quality.num) == (0, 0)
    assert m.chord_alterations.den == 0
    assert m.chord_insertions == 0
