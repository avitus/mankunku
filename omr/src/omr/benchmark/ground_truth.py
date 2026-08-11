"""Ground-truth files: hand-authorable, written-pitch-as-printed JSON.

Format (per chart):

    {
      "slug": "lady-bird",
      "source_pdf": "Leadsheets/PDF/Lady Bird.pdf",
      "reviewed": true,                  // human checked against the print
      "key_signature": "D",              // WRITTEN key, as printed
      "time_signature": [4, 4],
      "measures": [
        { "number": 1,
          "chords": [ {"beat": 0, "symbol": "DΔ7"} ],
          "melody": [ {"beat": 0, "duration_beats": 2, "pitch": "A4",
                       "tied": false} ],
          "start_repeat": false, "end_repeat": false,
          "ending": null, "rehearsal_mark": null }
      ]
    }

Beats are 0-based in units of the meter denominator; values may be ints,
floats, or "n/d" strings (use strings for triplets: "1/3"). Pitch is
written pitch with spelling as printed ("Db4", never respelled); null
pitch = rest. Melody entries omitted entirely = measure left unscored on
melody but still scored for chords/structure.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Any

from omr.abc_parser import _ACCIDENTAL_OFFSETS, _LETTER_SEMITONES
from omr.chords import parse_chord
from omr.models import ChordSymbol, Measure, NoteEvent

_PITCH_RE = re.compile(r"^([A-G])(#{1,2}|b{1,2})?(-?\d)$")


@dataclass
class GroundTruth:
    slug: str
    source_pdf: str
    reviewed: bool
    key_signature: str | None
    time_signature: tuple[int, int] | None
    measures: list[Measure]
    provenance: dict[str, Any] | None = None


def to_fraction(value: Any) -> Fraction:
    if isinstance(value, Fraction):
        return value
    if isinstance(value, bool):  # bool subclasses int — True is not a beat value
        raise ValueError(f"cannot read beat value {value!r}")
    if isinstance(value, int):
        return Fraction(value)
    if isinstance(value, str):
        return Fraction(value)
    if isinstance(value, float):
        return Fraction(value).limit_denominator(96)
    raise ValueError(f"cannot read beat value {value!r}")


def spelled_to_midi(spelled: str) -> int:
    m = _PITCH_RE.match(spelled)
    if not m:
        raise ValueError(f"cannot read pitch {spelled!r} (expected e.g. 'Db4')")
    letter, accidental, octave = m.group(1), m.group(2) or "", int(m.group(3))
    return 12 * (octave + 1) + _LETTER_SEMITONES[letter] + _ACCIDENTAL_OFFSETS[accidental]


def load_ground_truth(path: Path) -> GroundTruth:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    ts = data.get("time_signature")
    time_signature = (ts[0], ts[1]) if ts else None
    beat_unit = Fraction(1, time_signature[1]) if time_signature else Fraction(1, 4)

    measures: list[Measure] = []
    for entry in data.get("measures", []):
        measure = Measure(
            number=entry["number"],
            start_repeat=entry.get("start_repeat", False),
            end_repeat=entry.get("end_repeat", False),
            ending=entry.get("ending"),
            rehearsal_mark=entry.get("rehearsal_mark"),
            meter=time_signature,
        )
        for chord in entry.get("chords", []):
            symbol = chord["symbol"]
            measure.chords.append(
                ChordSymbol(
                    raw=symbol,
                    onset=to_fraction(chord["beat"]) * beat_unit,
                    parsed=parse_chord(symbol),
                )
            )
        for note in entry.get("melody", []):
            pitch = note.get("pitch")
            measure.notes.append(
                NoteEvent(
                    spelled_pitch=pitch,
                    midi=spelled_to_midi(pitch) if pitch else None,
                    onset=to_fraction(note["beat"]) * beat_unit,
                    duration=to_fraction(note["duration_beats"]) * beat_unit,
                    tied_to_next=note.get("tied", False),
                    is_rest=pitch is None,
                )
            )
        measures.append(measure)

    return GroundTruth(
        slug=data["slug"],
        source_pdf=data["source_pdf"],
        reviewed=data.get("reviewed", False),
        key_signature=data.get("key_signature"),
        time_signature=time_signature,
        measures=measures,
        provenance=data.get("provenance"),
    )
