"""Core data model for the OMR subsystem.

Two layers, deliberately separate:

- Raw layer (`OMRResult`): whatever the backend emitted, byte-for-byte. Never
  edited, never "fixed". Debugging a recognition error starts here.
- Normalized layer (`NormalizedScore`): a structural reading of the raw output.
  It records only what was recognized on the page. Absent information is
  ``None`` — a missing tempo is not defaulted, an unreadable chord is kept as
  its raw text with ``parsed=None``. Anything beyond what is printed (harmonic
  function, implied extensions, corrected rhythms) belongs to downstream
  musical reasoning, not to this model.

Serialization: Fractions become ``[numerator, denominator]`` pairs, matching
the app-wide rhythm convention. Onsets and durations are in whole-note units
(``[1, 4]`` = quarter note), measured from the start of the measure.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path
from typing import Any

from PIL import Image

# ---------------------------------------------------------------------------
# Input layer


@dataclass(frozen=True)
class PageImage:
    """One rendered page. ``dpi`` is the *effective* resolution after any cap."""

    index: int
    image: Image.Image
    dpi: float
    source_page: int


@dataclass(frozen=True)
class ScoreInput:
    """A loaded score: the original path plus its rendered pages, in order."""

    path: Path
    kind: str  # "pdf" | "image"
    pages: tuple[PageImage, ...]


# ---------------------------------------------------------------------------
# Raw layer


@dataclass
class BackendInfo:
    name: str
    model_id: str | None
    revision: str | None
    version: str
    device: str | None
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "model_id": self.model_id,
            "revision": self.revision,
            "version": self.version,
            "device": self.device,
            "details": self.details,
        }


@dataclass
class RawPage:
    """Verbatim backend output for one page."""

    page_index: int
    text: str
    token_count: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"page_index": self.page_index, "text": self.text, "token_count": self.token_count}


@dataclass
class OMRWarning:
    """A deterministic observation about the transcription — never a rewrite."""

    code: str
    message: str
    page: int | None = None
    measure: int | None = None
    raw: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "page": self.page,
            "measure": self.measure,
            "raw": self.raw,
        }


@dataclass
class OMRResult:
    """The backend's output, preserved verbatim, plus provenance."""

    raw_transcription: str
    format: str  # e.g. "abc"
    raw_pages: list[RawPage]
    backend: BackendInfo
    warnings: list[OMRWarning]
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "raw_transcription": self.raw_transcription,
            "format": self.format,
            "raw_pages": [p.to_dict() for p in self.raw_pages],
            "backend": self.backend.to_dict(),
            "warnings": [w.to_dict() for w in self.warnings],
            "metadata": self.metadata,
        }


# ---------------------------------------------------------------------------
# Normalized layer


def _frac_to_json(value: Fraction) -> list[int]:
    return [value.numerator, value.denominator]


def _frac_from_json(value: list[int] | tuple[int, int]) -> Fraction:
    return Fraction(value[0], value[1])


@dataclass(frozen=True)
class ParsedChord:
    """Structural reading of a chord symbol. The raw text stays authoritative.

    ``root_accidental`` is the accidental *as written* — Db7 keeps ``b``;
    it is never respelled to C#. ``quality`` is a canonical class used only
    for comparison (Δ7 and maj7 both map to "maj7"); display always uses the
    raw symbol.
    """

    root_letter: str
    root_accidental: str  # "", "#", "b"
    quality: str
    alterations: tuple[str, ...] = ()
    bass: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "root_letter": self.root_letter,
            "root_accidental": self.root_accidental,
            "quality": self.quality,
            "alterations": list(self.alterations),
            "bass": self.bass,
        }


@dataclass
class ChordSymbol:
    """A chord symbol as recognized: verbatim text, position, optional parse."""

    raw: str
    onset: Fraction  # from measure start, whole-note units
    parsed: ParsedChord | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "raw": self.raw,
            "onset": _frac_to_json(self.onset),
            "parsed": self.parsed.to_dict() if self.parsed else None,
        }


@dataclass
class NoteEvent:
    """One melody note or rest. ``spelled_pitch`` is written pitch as printed
    (e.g. "Db4" — never respelled); ``midi`` is derived from it for
    convenience. Rests have both as ``None`` and ``is_rest=True``."""

    spelled_pitch: str | None
    midi: int | None
    onset: Fraction
    duration: Fraction
    tied_to_next: bool = False
    tuplet: tuple[int, int] | None = None  # e.g. (3, 2) for a triplet
    is_rest: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "spelled_pitch": self.spelled_pitch,
            "midi": self.midi,
            "onset": _frac_to_json(self.onset),
            "duration": _frac_to_json(self.duration),
            "tied_to_next": self.tied_to_next,
            "tuplet": list(self.tuplet) if self.tuplet else None,
            "is_rest": self.is_rest,
        }


@dataclass
class Measure:
    number: int  # 1-based
    chords: list[ChordSymbol] = field(default_factory=list)
    notes: list[NoteEvent] = field(default_factory=list)
    start_repeat: bool = False
    end_repeat: bool = False
    ending: int | None = None
    rehearsal_mark: str | None = None
    meter: tuple[int, int] | None = None  # meter in effect (inline changes)
    raw_unparsed: list[str] = field(default_factory=list)
    warnings: list[OMRWarning] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "number": self.number,
            "chords": [c.to_dict() for c in self.chords],
            "notes": [n.to_dict() for n in self.notes],
            "start_repeat": self.start_repeat,
            "end_repeat": self.end_repeat,
            "ending": self.ending,
            "rehearsal_mark": self.rehearsal_mark,
            "meter": list(self.meter) if self.meter else None,
            "raw_unparsed": self.raw_unparsed,
            "warnings": [w.to_dict() for w in self.warnings],
        }


@dataclass
class NormalizedScore:
    title: str | None
    composer: str | None
    key_signature: str | None  # as recognized (e.g. "Bb", "F#m"); never guessed
    time_signature: tuple[int, int] | None
    tempo: str | None  # raw tempo text, uninterpreted
    measures: list[Measure] = field(default_factory=list)
    text_annotations: list[str] = field(default_factory=list)
    warnings: list[OMRWarning] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "composer": self.composer,
            "key_signature": self.key_signature,
            "time_signature": list(self.time_signature) if self.time_signature else None,
            "tempo": self.tempo,
            "measures": [m.to_dict() for m in self.measures],
            "text_annotations": self.text_annotations,
            "warnings": [w.to_dict() for w in self.warnings],
        }


# ---------------------------------------------------------------------------
# Deserialization


def _warning_from_dict(data: dict[str, Any]) -> OMRWarning:
    return OMRWarning(
        code=data["code"],
        message=data["message"],
        page=data.get("page"),
        measure=data.get("measure"),
        raw=data.get("raw"),
    )


def _parsed_chord_from_dict(data: dict[str, Any] | None) -> ParsedChord | None:
    if data is None:
        return None
    return ParsedChord(
        root_letter=data["root_letter"],
        root_accidental=data["root_accidental"],
        quality=data["quality"],
        alterations=tuple(data.get("alterations", [])),
        bass=data.get("bass"),
    )


def _measure_from_dict(data: dict[str, Any]) -> Measure:
    meter = data.get("meter")
    return Measure(
        number=data["number"],
        meter=(meter[0], meter[1]) if meter else None,
        chords=[
            ChordSymbol(
                raw=c["raw"],
                onset=_frac_from_json(c["onset"]),
                parsed=_parsed_chord_from_dict(c.get("parsed")),
            )
            for c in data.get("chords", [])
        ],
        notes=[
            NoteEvent(
                spelled_pitch=n["spelled_pitch"],
                midi=n["midi"],
                onset=_frac_from_json(n["onset"]),
                duration=_frac_from_json(n["duration"]),
                tied_to_next=n.get("tied_to_next", False),
                tuplet=tuple(n["tuplet"]) if n.get("tuplet") else None,
                is_rest=n.get("is_rest", False),
            )
            for n in data.get("notes", [])
        ],
        start_repeat=data.get("start_repeat", False),
        end_repeat=data.get("end_repeat", False),
        ending=data.get("ending"),
        rehearsal_mark=data.get("rehearsal_mark"),
        raw_unparsed=data.get("raw_unparsed", []),
        warnings=[_warning_from_dict(w) for w in data.get("warnings", [])],
    )


def normalized_score_from_dict(data: dict[str, Any]) -> NormalizedScore:
    ts = data.get("time_signature")
    return NormalizedScore(
        title=data.get("title"),
        composer=data.get("composer"),
        key_signature=data.get("key_signature"),
        time_signature=(ts[0], ts[1]) if ts else None,
        tempo=data.get("tempo"),
        measures=[_measure_from_dict(m) for m in data.get("measures", [])],
        text_annotations=data.get("text_annotations", []),
        warnings=[_warning_from_dict(w) for w in data.get("warnings", [])],
    )


def omr_result_from_dict(data: dict[str, Any]) -> OMRResult:
    backend = data["backend"]
    return OMRResult(
        raw_transcription=data["raw_transcription"],
        format=data["format"],
        raw_pages=[
            RawPage(
                page_index=p["page_index"], text=p["text"], token_count=p.get("token_count")
            )
            for p in data.get("raw_pages", [])
        ],
        backend=BackendInfo(
            name=backend["name"],
            model_id=backend.get("model_id"),
            revision=backend.get("revision"),
            version=backend["version"],
            device=backend.get("device"),
            details=backend.get("details", {}),
        ),
        warnings=[_warning_from_dict(w) for w in data.get("warnings", [])],
        metadata=data.get("metadata", {}),
    )
