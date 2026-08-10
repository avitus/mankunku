"""Ground-truth format loading tests."""

import json
from fractions import Fraction
from pathlib import Path

from omr.benchmark.ground_truth import load_ground_truth

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
