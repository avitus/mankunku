"""Normalizer tests: structural mapping only — nothing inferred."""

from fractions import Fraction

from omr.abc_parser import parse_abc
from omr.normalize import normalize

LEAD_SHEET = """X:1
T:Half Nelson
C:Miles Davis
M:4/4
L:1/8
K:C
"^A""Cmaj7" C2 E2 G2 E2 | "Swing" "Fm7" F4 "Bb7" _B,4 | z8 |]
"""


def test_metadata_mapped_without_defaults() -> None:
    score, warnings = parse_abc(LEAD_SHEET)
    norm = normalize(score, warnings)

    assert norm.title == "Half Nelson"
    assert norm.composer == "Miles Davis"
    assert norm.key_signature == "C"
    assert norm.time_signature == (4, 4)
    assert norm.tempo is None  # no Q: field — stays None, never defaulted


def test_measures_numbered_and_onsets_accumulated() -> None:
    score, warnings = parse_abc(LEAD_SHEET)
    norm = normalize(score, warnings)

    assert [m.number for m in norm.measures] == [1, 2, 3]
    m1 = norm.measures[0]
    assert m1.notes[0].onset == Fraction(0)
    assert m1.notes[1].onset == Fraction(1, 4)
    m2 = norm.measures[1]
    assert m2.notes[1].onset == Fraction(1, 2)


def test_chords_positioned_at_their_notes_onset() -> None:
    score, warnings = parse_abc(LEAD_SHEET)
    norm = normalize(score, warnings)

    m2 = norm.measures[1]
    assert [c.raw for c in m2.chords] == ["Fm7", "Bb7"]
    assert m2.chords[0].onset == Fraction(0)
    assert m2.chords[1].onset == Fraction(1, 2)
    assert m2.chords[1].parsed.root_accidental == "b"


def test_non_chord_annotation_goes_to_text_annotations() -> None:
    score, warnings = parse_abc(LEAD_SHEET)
    norm = normalize(score, warnings)

    assert "Swing" in norm.text_annotations
    assert all(c.raw != "Swing" for m in norm.measures for c in m.chords)


def test_positioned_letter_annotation_becomes_rehearsal_mark() -> None:
    score, warnings = parse_abc(LEAD_SHEET)
    norm = normalize(score, warnings)

    assert norm.measures[0].rehearsal_mark == "A"


def test_chordlike_unparseable_string_kept_raw_with_warning() -> None:
    abc = 'X:1\nL:1/4\nK:C\n"C##9wat" C D E F |]\n'
    score, warnings = parse_abc(abc)
    norm = normalize(score, warnings)

    m1 = norm.measures[0]
    assert m1.chords[0].raw == "C##9wat"
    assert m1.chords[0].parsed is None
    assert any(w.code == "MALFORMED_CHORD_SYMBOL" for w in norm.warnings)


def test_rests_preserved_as_rests() -> None:
    score, warnings = parse_abc(LEAD_SHEET)
    norm = normalize(score, warnings)

    m3 = norm.measures[2]
    assert len(m3.notes) == 1
    assert m3.notes[0].is_rest is True
    assert m3.notes[0].duration == Fraction(1, 1)


def test_spelled_pitch_and_midi_carried_through() -> None:
    score, warnings = parse_abc(LEAD_SHEET)
    norm = normalize(score, warnings)

    bb = norm.measures[1].notes[1]
    assert bb.spelled_pitch == "Bb3"
    assert bb.midi == 58
