"""Chord-symbol parser tests: the jazz vocabulary must parse, enharmonic
spelling must survive, and garbage must return None (never a guess)."""

import pytest

from omr.chords import parse_chord

# (raw, root_letter, root_accidental, quality, alterations, bass)
REQUIRED_SYMBOLS = [
    ("Cmaj7", "C", "", "maj7", (), None),
    ("CΔ7", "C", "", "maj7", (), None),
    ("Cm7", "C", "", "m7", (), None),
    ("C-7", "C", "", "m7", (), None),
    ("C7", "C", "", "7", (), None),
    ("Cm7b5", "C", "", "m7b5", (), None),
    ("Cø7", "C", "", "m7b5", (), None),
    ("Cdim7", "C", "", "dim7", (), None),
    ("C°", "C", "", "dim", (), None),
    ("C7b9", "C", "", "7", ("b9",), None),
    ("C7#9", "C", "", "7", ("#9",), None),
    ("C7#11", "C", "", "7", ("#11",), None),
    ("C13", "C", "", "7", ("13",), None),
    ("C7alt", "C", "", "7", ("alt",), None),
    ("C/E", "C", "", "maj", (), "E"),
    ("Bbmaj7", "B", "b", "maj7", (), None),
    ("F#7", "F", "#", "7", (), None),
    ("Db7", "D", "b", "7", (), None),
]


@pytest.mark.parametrize("raw,letter,acc,quality,alts,bass", REQUIRED_SYMBOLS)
def test_required_jazz_symbols(raw, letter, acc, quality, alts, bass) -> None:
    parsed = parse_chord(raw)
    assert parsed is not None, f"{raw} failed to parse"
    assert parsed.root_letter == letter
    assert parsed.root_accidental == acc
    assert parsed.quality == quality
    assert parsed.alterations == alts
    assert parsed.bass == bass


def test_enharmonic_spelling_preserved() -> None:
    db = parse_chord("Db7")
    cs = parse_chord("C#7")
    assert (db.root_letter, db.root_accidental) == ("D", "b")
    assert (cs.root_letter, cs.root_accidental) == ("C", "#")
    # Db and C# are NOT collapsed to one spelling
    assert (db.root_letter, db.root_accidental) != (cs.root_letter, cs.root_accidental)


def test_unicode_flat_sharp_roots() -> None:
    parsed = parse_chord("B♭maj7")
    assert (parsed.root_letter, parsed.root_accidental) == ("B", "b")
    parsed = parse_chord("F♯7")
    assert (parsed.root_letter, parsed.root_accidental) == ("F", "#")


def test_slash_bass_with_accidental() -> None:
    parsed = parse_chord("C7/Bb")
    assert parsed.bass == "Bb"


def test_minor_major_seventh() -> None:
    for raw in ("CmMaj7", "Cm(maj7)", "C-Δ7"):
        parsed = parse_chord(raw)
        assert parsed is not None, raw
        assert parsed.quality == "mMaj7", raw


def test_parenthesized_alterations() -> None:
    parsed = parse_chord("C7(b9,#11)")
    assert parsed.quality == "7"
    assert parsed.alterations == ("b9", "#11")


@pytest.mark.parametrize("raw", ["H7", "C#b", "", "7", "maj7", "X", "C##b"])
def test_malformed_returns_none(raw: str) -> None:
    assert parse_chord(raw) is None
