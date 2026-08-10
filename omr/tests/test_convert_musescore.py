"""Concert->written converter tests (ground-truth bootstrap tooling).

The corpus fixtures store CONCERT pitch; the printed tenor charts are a
major ninth (14 semitones) up. The converter must transpose melody MIDI,
respell in the written key, and transpose chord-symbol roots while
preserving the rest of the symbol text.
"""

from omr.benchmark.convert_musescore import convert_fixture

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
