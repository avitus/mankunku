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


@pytest.mark.parametrize(
    "raw",
    [
        "H7",
        "C#b",
        "",
        "  ",
        "7",
        "maj7",
        "X",
        "C##b",
        "C7(b9",  # unclosed parenthesis
        "C(maj9)",  # only (maj) / (maj7) are quality groups
        "Cm5",  # no minor power chord
        "Cmdim",  # minor and diminished conflict
        "C7x",
    ],
)
def test_malformed_returns_none(raw: str) -> None:
    assert parse_chord(raw) is None


# Beyond the required core: spellings the corpus charts and iReal exports use.
# Every row is rooted on C so the columns are (raw, quality, alterations, bass).
EXTENDED_SYMBOLS = [
    ("C6", "maj6", (), None),
    ("C69", "maj6", ("9",), None),
    ("C6/9", "maj6", ("9",), None),  # /9 is an extension, never a bass
    ("Cm6", "m6", (), None),
    ("Cm6/9", "m6", ("9",), None),
    ("C6/E", "maj6", (), "E"),
    ("C5", "5", (), None),
    ("Csus4", "maj", ("sus4",), None),
    ("C7sus4", "7", ("sus4",), None),
    ("C9", "7", ("9",), None),
    ("C13b9", "7", ("13", "b9"), None),
    ("Cm9", "m7", ("9",), None),
    ("Cm11", "m7", ("11",), None),
    ("Cmaj9", "maj7", ("9",), None),
    ("Cmaj7#11", "maj7", ("#11",), None),
    ("CM7", "maj7", (), None),
    ("CMa7", "maj7", (), None),
    ("C^7", "maj7", (), None),
    ("CΔ", "maj7", (), None),
    ("Cmin7", "m7", (), None),
    ("C–7", "m7", (), None),  # en dash
    ("C−7", "m7", (), None),  # minus sign
    ("C+", "aug", (), None),
    ("C+7", "aug7", (), None),
    ("Caug7", "aug7", (), None),
    ("Cdim", "dim", (), None),
    ("C°7", "dim7", (), None),
    ("Co7", "dim7", (), None),
    ("Cø", "m7b5", (), None),
    ("Cm7(b5)", "m7b5", (), None),
    ("Cm7b5#11", "m7b5", ("#11",), None),
    ("C7b13", "7", ("b13",), None),
    ("C7#5", "7", ("#5",), None),
    ("C7(#9)", "7", ("#9",), None),
    ("Cadd9", "maj", ("add9",), None),
    ("Cno3", "maj", ("no3",), None),
    ("Cmaj7/B", "maj7", (), "B"),
    (" C7 ", "7", (), None),
]


@pytest.mark.parametrize("raw,quality,alts,bass", EXTENDED_SYMBOLS)
def test_extended_jazz_vocabulary(raw, quality, alts, bass) -> None:
    parsed = parse_chord(raw)
    assert parsed is not None, f"{raw} failed to parse"
    assert (parsed.root_letter, parsed.root_accidental) == ("C", "")
    assert parsed.quality == quality
    assert parsed.alterations == alts
    assert parsed.bass == bass
