"""AbcScore -> NormalizedScore: structural assembly, zero inference.

Everything here is a mechanical mapping of what the parser recognized:
measure numbering, onset accumulation, chord-string classification. Absent
information stays absent — no default tempo, no guessed key, no filled-in
chords. A quoted string that looks like a chord but does not parse is kept
verbatim with ``parsed=None`` and flagged, never repaired.

String classification rule (deterministic, documented):
- leading ``^ _ < > @`` (ABC positioned annotation): a short uppercase body
  on a measure's first note is a rehearsal mark; anything else is a text
  annotation.
- first character A-G: chord candidate — parsed if possible, kept raw with a
  ``MALFORMED_CHORD_SYMBOL`` warning if not.
- anything else: text annotation.
"""

from __future__ import annotations

import re
from fractions import Fraction

from omr.abc_parser import AbcScore
from omr.chords import parse_chord
from omr.models import ChordSymbol, Measure, NormalizedScore, NoteEvent, OMRWarning

_POSITION_MARKERS = "^_<>@"
_REHEARSAL_RE = re.compile(r"^[A-Z][0-9]?$")


def normalize(score: AbcScore, parse_warnings: list[OMRWarning]) -> NormalizedScore:
    warnings = list(parse_warnings)
    annotations: list[str] = list(score.header.subtitles)
    measures: list[Measure] = []

    for number, bar in enumerate(score.bars, start=1):
        measure = Measure(
            number=number,
            start_repeat=bar.start_repeat,
            end_repeat=bar.end_repeat,
            ending=bar.ending,
            meter=bar.meter,
            raw_unparsed=list(bar.raw_unparsed),
        )
        onset = Fraction(0)
        for position, event in enumerate(bar.events):
            for text in event.strings:
                _classify_string(text, measure, onset, position == 0, annotations, warnings)
            measure.notes.append(
                NoteEvent(
                    spelled_pitch=event.spelled_pitch,
                    midi=event.midi,
                    onset=onset,
                    duration=event.duration,
                    tied_to_next=event.tied_to_next,
                    tuplet=event.tuplet,
                    is_rest=event.kind == "rest",
                )
            )
            onset += event.duration
        measures.append(measure)

    return NormalizedScore(
        title=score.header.title,
        composer=score.header.composer,
        key_signature=score.header.key_raw,
        time_signature=score.header.meter,
        tempo=score.header.tempo,
        measures=measures,
        text_annotations=annotations,
        warnings=warnings,
    )


def _classify_string(
    text: str,
    measure: Measure,
    onset: Fraction,
    on_first_event: bool,
    annotations: list[str],
    warnings: list[OMRWarning],
) -> None:
    if not text.strip():
        return

    if text[0] in _POSITION_MARKERS:
        body = text[1:].strip()
        if on_first_event and measure.rehearsal_mark is None and _REHEARSAL_RE.match(body):
            measure.rehearsal_mark = body
        elif body:
            annotations.append(body)
        return

    if text[0] in "ABCDEFG":
        parsed = parse_chord(text)
        measure.chords.append(ChordSymbol(raw=text, onset=onset, parsed=parsed))
        if parsed is None:
            warning = OMRWarning(
                code="MALFORMED_CHORD_SYMBOL",
                message=f"chord-like symbol '{text}' could not be parsed; kept verbatim",
                measure=measure.number,
                raw=text,
            )
            measure.warnings.append(warning)
            warnings.append(warning)
        return

    annotations.append(text)
