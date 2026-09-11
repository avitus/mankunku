"""Ground-truth format loading tests."""

import json
from fractions import Fraction
from pathlib import Path

import pytest

from omr.benchmark.ground_truth import load_ground_truth, spelled_to_midi, to_fraction

SAMPLE = {
    "slug": "test-chart",
    "source_pdf": "Leadsheets/PDF/Test.pdf",
    "reviewed": False,
    "key_signature": "D",
    "time_signature": [4, 4],
    "measures": [
        {
            "number": 1,
            "chords": [{"beat": 0, "symbol": "DΔ7"}],
            "melody": [
                {"beat": 0, "duration_beats": 1, "pitch": "A4"},
                {"beat": 1, "duration_beats": "1/3", "pitch": "B4"},
                {"beat": 2.5, "duration_beats": 1.5, "pitch": None},
            ],
            "start_repeat": True,
        },
        {"number": 2, "chords": [], "melody": [], "ending": 2},
    ],
}


def _write(tmp_path: Path) -> Path:
    p = tmp_path / "test-chart.json"
    p.write_text(json.dumps(SAMPLE))
    return p


def test_beats_convert_to_whole_note_fractions(tmp_path: Path) -> None:
    gt = load_ground_truth(_write(tmp_path))

    m1 = gt.measures[0]
    assert m1.notes[0].onset == Fraction(0)
    assert m1.notes[0].duration == Fraction(1, 4)  # 1 beat in 4/4
    assert m1.notes[1].duration == Fraction(1, 12)  # triplet beat via "1/3" string
    assert m1.notes[2].onset == Fraction(5, 8)  # beat 2.5
    assert m1.chords[0].onset == Fraction(0)


def test_pitch_spelling_and_midi(tmp_path: Path) -> None:
    gt = load_ground_truth(_write(tmp_path))

    a4 = gt.measures[0].notes[0]
    assert a4.spelled_pitch == "A4"
    assert a4.midi == 69
    rest = gt.measures[0].notes[2]
    assert rest.is_rest and rest.midi is None


def test_chords_parsed_but_raw_preserved(tmp_path: Path) -> None:
    gt = load_ground_truth(_write(tmp_path))

    chord = gt.measures[0].chords[0]
    assert chord.raw == "DΔ7"
    assert chord.parsed.quality == "maj7"


def test_flags_and_metadata(tmp_path: Path) -> None:
    gt = load_ground_truth(_write(tmp_path))

    assert gt.slug == "test-chart"
    assert gt.reviewed is False
    assert gt.key_signature == "D"
    assert gt.measures[0].start_repeat is True
    assert gt.measures[1].ending == 2


def test_unreadable_pitch_rejected() -> None:
    with pytest.raises(ValueError, match="H9"):
        spelled_to_midi("H9")


def test_unreadable_beat_value_rejected() -> None:
    with pytest.raises(ValueError):
        to_fraction(None)


def test_to_fraction_accepts_fraction_and_rejects_bool() -> None:
    assert to_fraction(Fraction(1, 3)) == Fraction(1, 3)
    with pytest.raises(ValueError):
        to_fraction(True)


def test_missing_time_signature_defaults_beats_to_quarters(tmp_path: Path) -> None:
    data = {k: v for k, v in SAMPLE.items() if k != "time_signature"}
    p = tmp_path / "no-ts.json"
    p.write_text(json.dumps(data))

    gt = load_ground_truth(p)

    assert gt.time_signature is None
    assert gt.measures[0].meter is None
    assert gt.measures[0].notes[0].duration == Fraction(1, 4)


def test_reviewed_defaults_to_false_when_absent(tmp_path: Path) -> None:
    # A chart that never says it was checked is provisional, not trusted.
    data = {k: v for k, v in SAMPLE.items() if k != "reviewed"}
    p = tmp_path / "unreviewed.json"
    p.write_text(json.dumps(data))

    assert load_ground_truth(p).reviewed is False


@pytest.mark.parametrize(
    "value,expected",
    [(2, Fraction(2)), ("3/2", Fraction(3, 2)), (2.5, Fraction(5, 2)), (0.3333, Fraction(1, 3))],
)
def test_to_fraction_value_forms(value, expected: Fraction) -> None:
    # Floats snap to the nearest small denominator so a typed 0.3333 is a triplet.
    assert to_fraction(value) == expected


@pytest.mark.parametrize(
    "spelled,midi",
    [("C##4", 62), ("Dbb4", 60), ("B#3", 60), ("Cb4", 59), ("C-1", 0)],
)
def test_spelled_to_midi_double_accidentals_and_edge_octaves(spelled: str, midi: int) -> None:
    assert spelled_to_midi(spelled) == midi
