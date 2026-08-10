"""Bootstrap ground truth from the app's MuseScore-import fixtures.

The corpus fixtures (tests/fixtures/leadsheets/pdf-vs-musescore/
<slug>.musescore-import.json) store CONCERT pitch; the printed charts under
Leadsheets/PDF are tenor-sax parts, a major ninth (14 semitones) ABOVE
concert. OMR reads what is printed, so ground truth must be written pitch:
this converter transposes melody, key, and chord-symbol roots up and
respells them in the written key.

Output is marked ``"reviewed": false``. A human MUST check the result
against the printed PDF (spelling choices especially) and flip the flag
before trusting benchmark numbers.

Usage:
    uv run python -m omr.benchmark.convert_musescore \
        ../tests/fixtures/leadsheets/pdf-vs-musescore/lady-bird.musescore-import.json \
        tests/benchmark/ground_truth/lady-bird.json \
        --semitones 14 --source-pdf "Leadsheets/PDF/Lady Bird.pdf"
"""

from __future__ import annotations

import argparse
import json
import re
from fractions import Fraction
from pathlib import Path
from typing import Any

# Conventional key-name spellings by pitch class (matches the app's PITCH_CLASSES).
_KEY_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
_KEY_FIFTHS = {
    "C": 0, "Db": -5, "D": 2, "Eb": -3, "E": 4, "F": -1,
    "F#": 6, "Gb": -6, "G": 1, "Ab": -4, "A": 3, "Bb": -2, "B": 5,
}
_SHARP_PCS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_FLAT_PCS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
_NOTE_SEMITONES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_ROOT_RE = re.compile(r"^([A-G])([#b♯♭]?)")


def _pc_of(name: str) -> int:
    m = _ROOT_RE.match(name.strip())
    if not m:
        raise ValueError(f"cannot read pitch class {name!r}")
    accidental = {"♯": 1, "#": 1, "♭": -1, "b": -1, "": 0}[m.group(2)]
    return (_NOTE_SEMITONES[m.group(1)] + accidental) % 12


def _pc_table(fifths: int) -> list[str]:
    return _SHARP_PCS if fifths > 0 else _FLAT_PCS


def _spell_midi(midi: int, fifths: int) -> str:
    name = _pc_table(fifths)[midi % 12]
    return f"{name}{midi // 12 - 1}"


def _transpose_symbol(symbol: str, pc_shift: int, fifths: int) -> str:
    def shift_name(match: re.Match) -> str:
        pc = (_pc_of(match.group(0)) + pc_shift) % 12
        return _pc_table(fifths)[pc]

    head, _, bass = symbol.partition("/")
    head = _ROOT_RE.sub(shift_name, head, count=1)
    if bass and _ROOT_RE.match(bass.strip()):
        bass = _ROOT_RE.sub(shift_name, bass.strip(), count=1)
        return f"{head}/{bass}"
    return symbol if not head else (f"{head}/{bass}" if bass else head)


def _beat_json(value: Fraction) -> int | str:
    if value.denominator == 1:
        return value.numerator
    return f"{value.numerator}/{value.denominator}"


def convert_fixture(
    fixture: dict[str, Any], *, semitones: int, slug: str, source_pdf: str
) -> dict[str, Any]:
    pc_shift = semitones % 12
    concert_key = fixture["key"]
    written_pc = (_pc_of(concert_key) + pc_shift) % 12
    written_key = _KEY_NAMES[written_pc]
    fifths = _KEY_FIFTHS[written_key]

    numerator, denominator = fixture["timeSignature"]
    measure_len = Fraction(numerator, denominator)
    beat_unit = Fraction(1, denominator)

    measures: list[dict[str, Any]] = []
    number = 0
    for section in fixture["sections"]:
        section_start_number = number
        for bar in range(section["bars"]):
            number += 1
            measures.append(
                {
                    "number": number,
                    "chords": [],
                    "melody": [],
                    "start_repeat": bool(section.get("repeatStart")) and bar == 0,
                    "end_repeat": bool(section.get("repeatEnd")) and bar == section["bars"] - 1,
                    "ending": section.get("ending") if bar == 0 else None,
                    # Section labels are an app-model concept, not necessarily
                    # printed on the page. Printed rehearsal marks must be
                    # added by the human reviewer.
                    "rehearsal_mark": None,
                }
            )

        def place(
            offset: Fraction, start: int = section_start_number, bars: int = section["bars"]
        ) -> tuple[dict[str, Any], Fraction] | None:
            bar_index = int(offset / measure_len)
            if bar_index >= bars:
                return None
            beat = (offset - bar_index * measure_len) / beat_unit
            return measures[start + bar_index], beat

        for note in section.get("notes", []):
            offset = Fraction(*note["offset"])
            slot = place(offset)
            if slot is None:
                continue
            measure, beat = slot
            midi = note.get("pitch")
            measure["melody"].append(
                {
                    "beat": _beat_json(beat),
                    "duration_beats": _beat_json(Fraction(*note["duration"]) / beat_unit),
                    "pitch": None if midi is None else _spell_midi(midi + semitones, fifths),
                    **({"tied": True} if note.get("tied") else {}),
                }
            )

        for chord in section.get("harmony", []):
            offset = Fraction(*chord["startOffset"])
            slot = place(offset)
            if slot is None:
                continue
            measure, beat = slot
            measure["chords"].append(
                {
                    "beat": _beat_json(beat),
                    "symbol": _transpose_symbol(chord["symbol"], pc_shift, fifths),
                }
            )

    return {
        "slug": slug,
        "source_pdf": source_pdf,
        "reviewed": False,
        "provenance": {
            "method": "convert_musescore",
            "semitones": semitones,
            "concert_key": concert_key,
        },
        "key_signature": written_key,
        "time_signature": [numerator, denominator],
        "measures": measures,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixture", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--semitones", type=int, required=True,
                        help="written = concert + this many semitones (tenor sax: 14)")
    parser.add_argument("--source-pdf", required=True,
                        help="repo-relative path of the printed PDF this chart benchmarks")
    parser.add_argument("--slug", default=None)
    args = parser.parse_args()

    fixture = json.loads(args.fixture.read_text())
    slug = args.slug or args.output.stem
    result = convert_fixture(
        fixture, semitones=args.semitones, slug=slug, source_pdf=args.source_pdf
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(
        f"wrote {args.output} — reviewed: false. Check it against the printed "
        f"PDF and set \"reviewed\": true before trusting benchmark numbers."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
