"""Concert->written converter tests (ground-truth bootstrap tooling).

The corpus fixtures store CONCERT pitch; the printed tenor charts are a
major ninth (14 semitones) up. The converter must transpose melody MIDI,
respell in the written key, and transpose chord-symbol roots while
preserving the rest of the symbol text.
"""

import json
import sys

import pytest

from omr.benchmark.convert_musescore import convert_fixture, main

FIXTURE = {
    "title": "Test",
    "key": "C",
    "timeSignature": [4, 4],
    "sections": [
        {
            "label": "A",
            "bars": 2,
            "notes": [
                {"pitch": 55, "duration": [1, 4], "offset": [0, 1]},  # concert G3
                {"pitch": 58, "duration": [1, 4], "offset": [1, 4]},  # concert Bb3
                {"pitch": None, "duration": [1, 2], "offset": [1, 2]},
                {"pitch": 60, "duration": [1, 1], "offset": [1, 1], "tied": True},
            ],
            "harmony": [
                {"symbol": "CΔ7", "startOffset": [0, 1], "duration": [1, 1]},
                {"symbol": "Bb7/D", "startOffset": [1, 1], "duration": [1, 1]},
            ],
        }
    ],
}


def test_key_transposes_up_a_major_second() -> None:
    gt = convert_fixture(FIXTURE, semitones=14, slug="test", source_pdf="x.pdf")
    assert gt["key_signature"] == "D"


def test_melody_transposed_and_spelled_in_written_key() -> None:
    gt = convert_fixture(FIXTURE, semitones=14, slug="test", source_pdf="x.pdf")

    melody = gt["measures"][0]["melody"]
    # concert G3 (55) + 14 = A4 (69)
    assert melody[0]["pitch"] == "A4"
    # concert Bb3 (58) + 14 = 72 = C5 (natural in D major)
    assert melody[1]["pitch"] == "C5"
    assert melody[2]["pitch"] is None  # rest stays a rest


def test_beats_are_measure_relative() -> None:
    gt = convert_fixture(FIXTURE, semitones=14, slug="test", source_pdf="x.pdf")

    m1, m2 = gt["measures"]
    assert m1["melody"][0]["beat"] == 0
    assert m1["melody"][1]["beat"] == 1
    assert m2["melody"][0]["beat"] == 0  # offset [1,1] = start of measure 2
    assert m2["melody"][0]["tied"] is True


def test_chord_symbols_transposed_preserving_suffix() -> None:
    gt = convert_fixture(FIXTURE, semitones=14, slug="test", source_pdf="x.pdf")

    m1, m2 = gt["measures"]
    assert m1["chords"][0]["symbol"] == "DΔ7"
    # Bb + 2 semitones = C; bass D + 2 = E
    assert m2["chords"][0]["symbol"] == "C7/E"


def test_output_marked_unreviewed_with_provenance() -> None:
    gt = convert_fixture(FIXTURE, semitones=14, slug="test", source_pdf="x.pdf")

    assert gt["reviewed"] is False
    assert gt["provenance"]["semitones"] == 14


def test_out_of_range_events_are_reported_not_silently_dropped() -> None:
    fixture = {
        **FIXTURE,
        "sections": [
            {
                "label": "A",
                "bars": 1,
                "notes": [
                    {"pitch": 60, "duration": [1, 4], "offset": [0, 1]},
                    {"pitch": 62, "duration": [1, 4], "offset": [3, 2]},  # beyond bar 1
                ],
                "harmony": [{"symbol": "C7", "startOffset": [2, 1], "duration": [1, 1]}],
            }
        ],
    }
    gt = convert_fixture(fixture, semitones=14, slug="t", source_pdf="x.pdf")
    skipped = gt["provenance"]["skipped_events"]
    assert len(skipped) == 2
    assert any("3/2" in s for s in skipped)
    # In-range content still converts.
    assert len(gt["measures"][0]["melody"]) == 1


def _one_section(**section) -> dict:
    return {**FIXTURE, "sections": [{"label": "A", "notes": [], "harmony": [], **section}]}


@pytest.mark.parametrize(
    "concert_key,expected_key,expected_pitch",
    [("C", "D", "D#5"), ("Eb", "F", "Eb5")],
)
def test_black_keys_are_spelled_in_the_written_key(
    concert_key: str, expected_key: str, expected_pitch: str
) -> None:
    # concert 61 + 14 = 75: D# in a sharp key (D major), Eb in a flat one (F major).
    fixture = _one_section(bars=1, notes=[{"pitch": 61, "duration": [1, 4], "offset": [0, 1]}])
    fixture["key"] = concert_key

    gt = convert_fixture(fixture, semitones=14, slug="t", source_pdf="x.pdf")

    assert gt["key_signature"] == expected_key
    assert gt["measures"][0]["melody"][0]["pitch"] == expected_pitch


def test_repeat_and_ending_flags_land_on_section_boundaries() -> None:
    fixture = _one_section(bars=2, repeatStart=True, repeatEnd=True, ending=1)

    m1, m2 = convert_fixture(fixture, semitones=14, slug="t", source_pdf="x.pdf")["measures"]

    assert (m1["start_repeat"], m1["end_repeat"], m1["ending"]) == (True, False, 1)
    assert (m2["start_repeat"], m2["end_repeat"], m2["ending"]) == (False, True, None)


def test_chord_symbols_without_a_note_bass_or_root_survive_transposition() -> None:
    fixture = _one_section(
        bars=1,
        harmony=[
            {"symbol": "C6/9", "startOffset": [0, 1], "duration": [1, 2]},  # /9 is not a bass
            {"symbol": "N.C.", "startOffset": [1, 2], "duration": [1, 2]},  # no root at all
        ],
    )

    chords = convert_fixture(fixture, semitones=14, slug="t", source_pdf="x.pdf")["measures"][0][
        "chords"
    ]

    assert [c["symbol"] for c in chords] == ["D6/9", "N.C."]
    assert [c["beat"] for c in chords] == [0, 2]


def test_main_writes_the_file_and_reports_skipped_events(tmp_path, monkeypatch, capsys) -> None:
    fixture = _one_section(bars=1, notes=[{"pitch": 62, "duration": [1, 4], "offset": [3, 2]}])
    src = tmp_path / "tune.musescore-import.json"
    src.write_text(json.dumps(fixture), encoding="utf-8")
    out = tmp_path / "gt" / "tune.json"
    argv = ["convert_musescore", str(src), str(out), "--semitones", "14"]
    monkeypatch.setattr(sys, "argv", [*argv, "--source-pdf", "Leadsheets/PDF/Tune.pdf"])

    assert main() == 0

    written = json.loads(out.read_text(encoding="utf-8"))
    assert written["slug"] == "tune"  # defaults to the output stem
    assert written["reviewed"] is False
    assert written["source_pdf"] == "Leadsheets/PDF/Tune.pdf"
    stdout = capsys.readouterr().out
    assert "WARNING: 1 event(s)" in stdout
    assert "reviewed: false" in stdout


def test_unreadable_concert_key_fails_loudly_instead_of_defaulting() -> None:
    # Ground truth in a guessed key would silently mis-spell every note.
    with pytest.raises(ValueError, match="cannot read pitch class 'H'"):
        convert_fixture({**FIXTURE, "key": "H"}, semitones=14, slug="t", source_pdf="x.pdf")
