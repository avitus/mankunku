"""Resilient parser for the lead-sheet subset of ABC notation.

Built for hostile input: OMR models emit malformed ABC routinely, so the
contract here is *never abort the score*. An unlexable span costs exactly
one measure — the span is preserved verbatim on that measure's
``raw_unparsed`` and parsing resumes at the next barline. Warnings record
every degradation; nothing is silently dropped or rewritten.

Scope (deliberate): single melody voice, headers (X/T/C/M/L/Q/K), notes
with accidentals (including ABC's accidental-persists-through-measure
rule), octave marks, duration multipliers, broken rhythms, rests, ties,
tuplets, barlines/repeats/endings, quoted strings (kept verbatim for the
normalizer to classify), inline fields, LEGATO's ``<|text|>`` elision
token. Decorations, slurs, and grace notes are skipped — they carry no
pitch or rhythm. Multi-voice bodies keep the first voice and warn.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from fractions import Fraction

from omr.models import OMRWarning

# ---------------------------------------------------------------------------
# Intermediate structures (syntax layer — the normalizer assembles these)


@dataclass
class AbcHeader:
    title: str | None = None
    subtitles: list[str] = field(default_factory=list)
    composer: str | None = None
    meter: tuple[int, int] | None = None
    unit_length: Fraction | None = None
    tempo: str | None = None
    key_raw: str | None = None


@dataclass
class AbcEvent:
    kind: str  # "note" | "rest"
    spelled_pitch: str | None
    midi: int | None
    duration: Fraction
    tied_to_next: bool = False
    tuplet: tuple[int, int] | None = None
    strings: list[str] = field(default_factory=list)


@dataclass
class AbcBar:
    events: list[AbcEvent] = field(default_factory=list)
    start_repeat: bool = False
    end_repeat: bool = False
    ending: int | None = None
    meter: tuple[int, int] | None = None
    raw_unparsed: list[str] = field(default_factory=list)


@dataclass
class AbcScore:
    header: AbcHeader
    bars: list[AbcBar]


# ---------------------------------------------------------------------------
# Pitch helpers

_LETTER_SEMITONES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_ACCIDENTAL_OFFSETS = {"": 0, "#": 1, "##": 2, "b": -1, "bb": -2}
_SHARP_ORDER = "FCGDAEB"
_FLAT_ORDER = "BEADGCF"
_MAJOR_FIFTHS = {"F": -1, "C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5}
_MODE_SHIFTS = {
    "": 0,
    "maj": 0,
    "major": 0,
    "ion": 0,
    "ionian": 0,
    "m": -3,
    "min": -3,
    "minor": -3,
    "aeo": -3,
    "aeolian": -3,
    "dor": -2,
    "dorian": -2,
    "phr": -4,
    "phrygian": -4,
    "lyd": 1,
    "lydian": 1,
    "mix": -1,
    "mixolydian": -1,
    "loc": -5,
    "locrian": -5,
}


def key_accidentals(key_value: str) -> dict[str, str]:
    """Letter -> accidental map implied by a K: field value."""
    value = key_value.strip()
    if not value or value.lower().startswith("none"):
        return {}
    m = re.match(r"^([A-G])([#b♯♭]?)\s*([A-Za-z]*)", value)
    if not m:
        return {}
    letter, accidental, mode_word = m.groups()
    accidental = {"♯": "#", "♭": "b"}.get(accidental, accidental)
    fifths = _MAJOR_FIFTHS[letter] + {"#": 7, "b": -7, "": 0}[accidental]
    mode_key = mode_word.lower()[:3] if mode_word else ""
    if mode_word and mode_key not in _MODE_SHIFTS and mode_word.lower() not in _MODE_SHIFTS:
        mode_key = ""  # unknown mode word (e.g. clef spec) — treat as major
    fifths += _MODE_SHIFTS.get(mode_word.lower(), _MODE_SHIFTS.get(mode_key, 0))
    if fifths > 0:
        return {letter: "#" for letter in _SHARP_ORDER[: min(fifths, 7)]}
    if fifths < 0:
        return {letter: "b" for letter in _FLAT_ORDER[: min(-fifths, 7)]}
    return {}


def _spell(letter: str, accidental: str, octave: int) -> tuple[str, int]:
    midi = 12 * (octave + 1) + _LETTER_SEMITONES[letter] + _ACCIDENTAL_OFFSETS[accidental]
    return f"{letter}{accidental}{octave}", midi


# ---------------------------------------------------------------------------
# Tokens

_FIELD_LINE_RE = re.compile(r"^([A-Za-z]):(.*)$")
_TEXT_TOKEN_RE = re.compile(r"<\|text\|>")
_STRING_RE = re.compile(r'"([^"]*)"')
_INLINE_FIELD_RE = re.compile(r"\[([A-Za-z]):([^\]]*)\]")
_BARLINE_RE = re.compile(r"(:+)?(\|\]|\[\||\|\||\||::)(:+)?(\d)?")
_ENDING_RE = re.compile(r"\[(\d)")
_TUPLET_RE = re.compile(r"\((\d)(?::(\d))?(?::(\d))?")
_NOTE_RE = re.compile(r"(\^{1,2}|_{1,2}|=)?([A-Ga-g])([',]*)(\d+/\d+|\d+/|/\d+|/+|\d+)?")
_CLUSTER_INNER_RE = re.compile(
    r"(?:(?:\^{1,2}|_{1,2}|=)?[A-Ga-g][',]*(?:\d+/\d+|\d+/|/\d+|/+|\d+)?)+"
)
_REST_RE = re.compile(r"([zx])(\d+/\d+|\d+/|/\d+|/+|\d+)?")
_MEASURE_REST_RE = re.compile(r"Z(\d+)?")
_DECORATION_RE = re.compile(r"![^!\n]*!|[.~]")
_GRACE_RE = re.compile(r"\{[^}]*\}")
_SKIP_RE = re.compile(r"[\s`$\\)]+|\((?!\d)")

_TUPLET_DEFAULT_Q = {2: 3, 3: 2, 4: 3, 6: 2, 8: 3}


def _parse_duration_suffix(suffix: str | None) -> Fraction:
    if not suffix:
        return Fraction(1)
    if suffix.startswith("/") and set(suffix) == {"/"}:
        return Fraction(1, 2 ** len(suffix))
    if "/" in suffix:
        num_s, _, den_s = suffix.partition("/")
        num = int(num_s) if num_s else 1
        den = int(den_s) if den_s else 2
        return Fraction(num, den)
    return Fraction(int(suffix))


def _parse_meter(value: str) -> tuple[int, int] | None:
    value = value.strip()
    if value == "C":
        return (4, 4)
    if value == "C|":
        return (2, 2)
    m = re.match(r"^(\d+)\s*/\s*(\d+)", value)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    return None


def _default_unit_length(meter: tuple[int, int] | None) -> Fraction:
    if meter is None:
        return Fraction(1, 8)
    return Fraction(1, 8) if Fraction(*meter) >= Fraction(3, 4) else Fraction(1, 16)


def _clean_key_raw(value: str) -> str:
    tokens = []
    for token in value.strip().split():
        if "=" in token:
            break
        tokens.append(token)
    return " ".join(tokens)


# ---------------------------------------------------------------------------
# Parser


class _BodyParser:
    def __init__(self, header: AbcHeader, warnings: list[OMRWarning]) -> None:
        self.header = header
        self.warnings = warnings
        self.bars: list[AbcBar] = []
        self.current = AbcBar()
        self.meter = header.meter
        self.unit = header.unit_length or _default_unit_length(header.meter)
        self.key_acc = key_accidentals(header.key_raw or "")
        self.measure_acc: dict[tuple[str, int], str] = {}
        self.pending_strings: list[str] = []
        self.pending_broken: str | None = None
        self.tuplet_remaining = 0
        self.tuplet_factor = Fraction(1)
        self.tuplet_label: tuple[int, int] | None = None
        self.pending_start_repeat = False
        self.pending_ending: int | None = None
        self.text_elided = 0
        self.primary_voice: str | None = None
        self.in_secondary_voice = False

    # -- bar lifecycle ------------------------------------------------------

    def _open_flags(self) -> None:
        if self.pending_start_repeat:
            self.current.start_repeat = True
            self.pending_start_repeat = False
        if self.pending_ending is not None:
            self.current.ending = self.pending_ending
            self.pending_ending = None

    def close_bar(self, *, end_repeat: bool = False) -> None:
        bar = self.current
        if bar.events or bar.raw_unparsed:
            bar.end_repeat = end_repeat
            bar.meter = self.meter
            self.bars.append(bar)
        elif end_repeat and self.bars:
            self.bars[-1].end_repeat = True
        self.current = AbcBar()
        self.measure_acc = {}
        self._open_flags()

    # -- event helpers ------------------------------------------------------

    def _apply_broken(self, duration: Fraction) -> Fraction:
        if self.pending_broken == ">":
            duration *= Fraction(1, 2)
        elif self.pending_broken == "<":
            duration *= Fraction(3, 2)
        self.pending_broken = None
        return duration

    def _apply_tuplet(self, duration: Fraction) -> tuple[Fraction, tuple[int, int] | None]:
        if self.tuplet_remaining > 0:
            self.tuplet_remaining -= 1
            return duration * self.tuplet_factor, self.tuplet_label
        return duration, None

    def add_event(self, event: AbcEvent) -> None:
        self._open_flags()
        event.strings = self.pending_strings + event.strings
        self.pending_strings = []
        self.current.events.append(event)

    def _note_event(
        self, acc: str | None, letter: str, octave_marks: str, dur: str | None
    ) -> AbcEvent:
        octave = 4 if letter.isupper() else 5
        octave += octave_marks.count("'") - octave_marks.count(",")
        upper = letter.upper()

        if acc is not None:
            explicit = {"^": "#", "^^": "##", "_": "b", "__": "bb", "=": ""}[acc]
            self.measure_acc[(upper, octave)] = explicit
            accidental = explicit
        else:
            accidental = self.measure_acc.get((upper, octave), self.key_acc.get(upper, ""))

        spelled, midi = _spell(upper, accidental, octave)
        duration = self.unit * self._apply_broken(_parse_duration_suffix(dur))
        duration, tuplet = self._apply_tuplet(duration)
        return AbcEvent(
            kind="note", spelled_pitch=spelled, midi=midi, duration=duration, tuplet=tuplet
        )

    # -- field handling -----------------------------------------------------

    def apply_field(self, letter: str, value: str) -> None:
        value = value.strip()
        if letter == "M":
            meter = _parse_meter(value)
            if meter:
                self.meter = meter
                if self.header.unit_length is None:
                    self.unit = _default_unit_length(meter)
        elif letter == "L":
            m = re.match(r"^(\d+)\s*/\s*(\d+)", value)
            if m:
                self.unit = Fraction(int(m.group(1)), int(m.group(2)))
        elif letter == "K":
            self.key_acc = key_accidentals(value)
            if self.header.key_raw is None:
                self.header.key_raw = _clean_key_raw(value)
        elif letter == "Q":
            if self.header.tempo is None:
                self.header.tempo = value
        elif letter == "V":
            voice = value.split()[0] if value.split() else value
            if self.primary_voice is None:
                self.primary_voice = voice
                self.in_secondary_voice = False
            elif voice != self.primary_voice:
                if not self.in_secondary_voice:
                    self.warnings.append(
                        OMRWarning(
                            code="MULTI_VOICE_COLLAPSED",
                            message=(
                                f"multiple voices in ABC output; keeping voice "
                                f"'{self.primary_voice}', skipping voice '{voice}'"
                            ),
                        )
                    )
                self.in_secondary_voice = True
            else:
                self.in_secondary_voice = False

    # -- main scan ----------------------------------------------------------

    def parse_line(self, line: str) -> None:
        pos = 0
        while pos < len(line):
            if line[pos] == "%":
                return  # comment to end of line

            if self.in_secondary_voice:
                m = _INLINE_FIELD_RE.match(line, pos)
                if m and m.group(1) == "V":
                    self.apply_field("V", m.group(2))
                    pos = m.end()
                else:
                    pos += 1
                continue

            m = _SKIP_RE.match(line, pos)
            if m:
                pos = m.end()
                continue

            m = _TEXT_TOKEN_RE.match(line, pos)
            if m:
                self.text_elided += 1
                pos = m.end()
                continue

            m = _STRING_RE.match(line, pos)
            if m:
                self.pending_strings.append(m.group(1))
                pos = m.end()
                continue

            m = _GRACE_RE.match(line, pos)
            if m:
                pos = m.end()
                continue

            m = _DECORATION_RE.match(line, pos)
            if m:
                pos = m.end()
                continue

            m = _INLINE_FIELD_RE.match(line, pos)
            if m:
                self.apply_field(m.group(1), m.group(2))
                pos = m.end()
                continue

            m = _BARLINE_RE.match(line, pos)
            if m:
                pre, bar, post, endnum = m.groups()
                end_repeat = bool(pre) or bar == "::"
                self.close_bar(end_repeat=end_repeat)
                if bool(post) or bar == "::":
                    self.pending_start_repeat = True
                if endnum:
                    self.pending_ending = int(endnum)
                pos = m.end()
                continue

            m = _ENDING_RE.match(line, pos)
            if m:
                self._open_flags()
                self.current.ending = int(m.group(1))
                pos = m.end()
                continue

            m = _TUPLET_RE.match(line, pos)
            if m:
                p = int(m.group(1))
                q = int(m.group(2)) if m.group(2) else _TUPLET_DEFAULT_Q.get(p, 2)
                r = int(m.group(3)) if m.group(3) else p
                self.tuplet_remaining = r
                self.tuplet_factor = Fraction(q, p)
                self.tuplet_label = (p, q)
                pos = m.end()
                continue

            if line[pos] == "[":
                consumed = self._try_chord_cluster(line, pos)
                if consumed:
                    pos = consumed
                    continue

            m = _NOTE_RE.match(line, pos)
            if m:
                event = self._note_event(m.group(1), m.group(2), m.group(3) or "", m.group(4))
                pos = m.end()
                if pos < len(line) and line[pos] == "-":
                    event.tied_to_next = True
                    pos += 1
                self.add_event(event)
                pos = self._maybe_broken(line, pos)
                continue

            m = _REST_RE.match(line, pos)
            if m:
                duration = self.unit * self._apply_broken(_parse_duration_suffix(m.group(2)))
                duration, tuplet = self._apply_tuplet(duration)
                self.add_event(
                    AbcEvent(
                        kind="rest", spelled_pitch=None, midi=None, duration=duration, tuplet=tuplet
                    )
                )
                pos = self._maybe_broken(line, m.end())
                continue

            m = _MEASURE_REST_RE.match(line, pos)
            if m:
                count = int(m.group(1)) if m.group(1) else 1
                full = Fraction(*self.meter) if self.meter else Fraction(1)
                for i in range(count):
                    self.add_event(
                        AbcEvent(kind="rest", spelled_pitch=None, midi=None, duration=full)
                    )
                    if i < count - 1:
                        self.close_bar()
                pos = m.end()
                continue

            pos = self._recover(line, pos)

    def _maybe_broken(self, line: str, pos: int) -> int:
        if pos < len(line) and line[pos] in "<>":
            marker = line[pos]
            while pos < len(line) and line[pos] == marker:
                pos += 1  # >> and <<< collapse to a single-level broken rhythm
            if self.current.events:
                last = self.current.events[-1]
                last.duration *= Fraction(3, 2) if marker == ">" else Fraction(1, 2)
            self.pending_broken = marker
        return pos

    def _try_chord_cluster(self, line: str, pos: int) -> int | None:
        """Parse [CEG] — keep the top note (lead-sheet melody) and warn."""
        end = line.find("]", pos)
        if end == -1:
            return None
        inner = line[pos + 1 : end]
        if not _CLUSTER_INNER_RE.fullmatch(inner):
            return None
        events: list[AbcEvent] = []
        for note_match in _NOTE_RE.finditer(inner):
            events.append(
                self._note_event(
                    note_match.group(1),
                    note_match.group(2),
                    note_match.group(3) or "",
                    note_match.group(4),
                )
            )
        if not events:
            return None
        after = end + 1
        dur_match = re.compile(r"\d+/\d+|\d+/|/\d+|/+|\d+").match(line, after)
        outer_mult = _parse_duration_suffix(dur_match.group(0)) if dur_match else Fraction(1)
        after = dur_match.end() if dur_match else after

        top = max(events, key=lambda e: e.midi or 0)
        top.duration = max(e.duration for e in events) * outer_mult
        top.duration = self._apply_broken(top.duration)
        top.duration, top.tuplet = self._apply_tuplet(top.duration)
        tied = after < len(line) and line[after] == "-"
        if tied:
            top.tied_to_next = True
            after += 1
        self.add_event(top)
        self.warnings.append(
            OMRWarning(
                code="CHORD_CLUSTER_TOP_NOTE",
                message=f"chord cluster [{inner}] collapsed to top note {top.spelled_pitch}",
                measure=len(self.bars) + 1,
                raw=line[pos : end + 1],
            )
        )
        return after

    def _recover(self, line: str, pos: int) -> int:
        bar_match = _BARLINE_RE.search(line, pos)
        end = bar_match.start() if bar_match else len(line)
        span = line[pos:end].strip()
        if span:
            self.current.raw_unparsed.append(span)
            self.warnings.append(
                OMRWarning(
                    code="UNPARSEABLE_REGION",
                    message=f"unparseable ABC span in measure {len(self.bars) + 1}",
                    measure=len(self.bars) + 1,
                    raw=span,
                )
            )
        return end if end > pos else pos + 1

    def finish(self) -> list[AbcBar]:
        self.close_bar()
        if self.text_elided:
            self.warnings.append(
                OMRWarning(
                    code="TEXT_ELIDED_BY_MODEL",
                    message=(
                        f"{self.text_elided} <|text|> token(s): the model replaced printed text "
                        "(titles, annotations, chord symbols) with a placeholder"
                    ),
                )
            )
        return self.bars


def _strip_text_tokens(value: str) -> tuple[str | None, int]:
    """Remove ``<|text|>`` placeholders from a header value.

    The model *saw* text here but elided it — keeping the literal token as a
    title would present a model artifact as recognized content."""
    stripped, count = _TEXT_TOKEN_RE.subn("", value)
    stripped = stripped.strip()
    return (stripped or None), count


def parse_abc(text: str) -> tuple[AbcScore, list[OMRWarning]]:
    warnings: list[OMRWarning] = []
    header = AbcHeader()
    header_elided = 0

    if not text.strip():
        warnings.append(
            OMRWarning(code="UNPARSEABLE_OUTPUT", message="empty transcription output")
        )
        return AbcScore(header=header, bars=[]), warnings

    lines = text.splitlines()
    body_start = 0
    in_header = True
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith("%"):
            continue
        m = _FIELD_LINE_RE.match(stripped)
        if not m:
            body_start = i
            in_header = False
            break
        letter, raw_value = m.group(1), m.group(2).strip()
        value, elided = _strip_text_tokens(raw_value)
        header_elided += elided
        if value is None:
            continue  # the field held only elided text — nothing recognized
        if letter == "T":
            if header.title is None:
                header.title = value
            else:
                header.subtitles.append(value)
        elif letter == "C":
            header.composer = value
        elif letter == "M":
            header.meter = _parse_meter(value)
        elif letter == "L":
            lm = re.match(r"^(\d+)\s*/\s*(\d+)", value)
            if lm:
                header.unit_length = Fraction(int(lm.group(1)), int(lm.group(2)))
        elif letter == "Q":
            header.tempo = value
        elif letter == "K":
            header.key_raw = _clean_key_raw(value)
            body_start = i + 1
            in_header = False
            break
        # X:, and unknown fields: recognized, nothing to keep
    else:
        body_start = len(lines)
        in_header = False

    assert not in_header
    parser = _BodyParser(header, warnings)
    parser.text_elided = header_elided
    for line in lines[body_start:]:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("%"):
            continue
        field_match = _FIELD_LINE_RE.match(stripped)
        if field_match and len(field_match.group(1)) == 1:
            letter = field_match.group(1)
            if letter == "w":
                continue  # lyrics: out of scope
            if letter == "X":
                continue  # a new tune header mid-stream (page boundary): ignore
            if letter in "MLKQV":
                parser.apply_field(letter, field_match.group(2))
                continue
            if letter == "T":
                subtitle, elided = _strip_text_tokens(field_match.group(2).strip())
                parser.text_elided += elided
                if subtitle:
                    header.subtitles.append(subtitle)
                continue
        parser.parse_line(line)

    bars = parser.finish()
    return AbcScore(header=header, bars=bars), warnings
