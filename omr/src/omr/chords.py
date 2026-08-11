"""Chord-symbol parsing — structural, enharmonic-preserving, never guessing.

``parse_chord`` reads a printed chord symbol into a ``ParsedChord`` used for
*comparison* (benchmark metrics, downstream mapping). The raw text is always
kept verbatim by the caller; a symbol this parser cannot read returns ``None``
and stays raw — it is never "corrected" into a plausible chord.

Quality classes are canonical comparison buckets, not respellings: CΔ7 and
Cmaj7 both read as quality "maj7", but their raw spellings stay distinct.
Roots keep their printed accidental — Db is never rewritten to C#.
"""

from __future__ import annotations

import re

from omr.models import ParsedChord

_UNICODE_ACCIDENTALS = {"♭": "b", "♯": "#", "−": "-", "–": "-", "—": "-"}

_ROOT_RE = re.compile(r"^([A-G])(##|bb|[#b])?")
_BASS_RE = re.compile(r"^([A-G])(##|bb|[#b])?$")
_ALTERATION_RE = re.compile(
    r"^(?:[#b](?:4|5|6|9|11|13)|add\d{1,2}|omit\d{1,2}|no\d{1,2}|alt|sus[24])"
)
_MAJ_MARKER_RE = re.compile(r"^(?:maj|Maj|MAJ|Ma|Δ|\^|M(?=7|9|13))")
_EXTENSION_RE = re.compile(r"^(?:7|9|11|13|6/9|69|6|5)")


def parse_chord(raw: str) -> ParsedChord | None:
    if not raw:
        return None
    s = raw.strip()
    for uni, ascii_ in _UNICODE_ACCIDENTALS.items():
        s = s.replace(uni, ascii_)
    if not s:
        return None

    s, bass = _split_bass(s)

    root_match = _ROOT_RE.match(s)
    if not root_match:
        return None
    letter, accidental = root_match.group(1), root_match.group(2) or ""
    rest = s[root_match.end() :]

    parsed_rest = _parse_quality(rest)
    if parsed_rest is None:
        return None
    quality, alterations = parsed_rest

    return ParsedChord(
        root_letter=letter,
        root_accidental=accidental,
        quality=quality,
        alterations=tuple(alterations),
        bass=bass,
    )


def _split_bass(s: str) -> tuple[str, str | None]:
    """Split a slash bass, but only when the tail really is a note name —
    C6/9 keeps its /9 (it is an extension, not a bass)."""
    if "/" not in s:
        return s, None
    head, _, tail = s.rpartition("/")
    if _BASS_RE.match(tail):
        return head, tail
    return s, None


def _parse_quality(rest: str) -> tuple[str, list[str]] | None:  # noqa: PLR0911
    rest = rest.strip()
    alterations: list[str] = []
    minor = False
    has_maj_marker = False
    extension: str | None = None
    base: str | None = None  # dim / dim7 / aug / m7b5

    # Parenthesized groups: quality modifiers or alteration lists.
    def consume_parens(text: str) -> str | None:
        nonlocal has_maj_marker
        while "(" in text:
            start = text.index("(")
            end = text.find(")", start)
            if end == -1:
                return None
            group = text[start + 1 : end]
            maj_match = _MAJ_MARKER_RE.match(group)
            if maj_match:
                has_maj_marker = True
                tail = group[maj_match.end() :]
                if tail not in ("", "7"):
                    return None
            else:
                for token in group.split(","):
                    token = token.strip()
                    m = _ALTERATION_RE.match(token)
                    if not m or m.end() != len(token):
                        return None
                    alterations.append(token)
            text = text[:start] + text[end + 1 :]
        return text

    consumed = consume_parens(rest)
    if consumed is None:
        return None
    rest = consumed.strip()

    # Minor marker ("m" not starting "maj", "-", "min").
    m = re.match(r"^(?:min(?!or)|m(?!aj|A)|-)", rest)
    if m:
        minor = True
        rest = rest[m.end() :]

    # Core quality token.
    if rest.startswith(("ø", "Ø")):
        base = "m7b5"
        rest = rest[1:]
        if rest.startswith("7"):
            rest = rest[1:]
    elif rest.startswith("°") or re.match(r"^(?:dim|o(?![a-z]))", rest):
        marker = re.match(r"^(?:°|dim|o)", rest)
        rest = rest[marker.end() :]
        if rest.startswith("7"):
            base = "dim7"
            rest = rest[1:]
        else:
            base = "dim"
    elif re.match(r"^(?:aug|\+)", rest):
        marker = re.match(r"^(?:aug|\+)", rest)
        rest = rest[marker.end() :]
        if rest.startswith("7"):
            base = "aug7"
            rest = rest[1:]
        else:
            base = "aug"
    else:
        maj = _MAJ_MARKER_RE.match(rest)
        if maj:
            has_maj_marker = True
            rest = rest[maj.end() :]
        ext = _EXTENSION_RE.match(rest)
        if ext:
            extension = ext.group(0)
            rest = rest[ext.end() :]

    # Suffix alterations (b9, #11, sus4, alt, ...), repeated.
    while rest:
        m = _ALTERATION_RE.match(rest)
        if not m:
            return None
        alterations.append(m.group(0))
        rest = rest[m.end() :]

    return _resolve_quality(minor, has_maj_marker, extension, base, alterations)


def _resolve_quality(
    minor: bool,
    has_maj_marker: bool,
    extension: str | None,
    base: str | None,
    alterations: list[str],
) -> tuple[str, list[str]] | None:
    if base is not None:
        if minor and base not in ("m7b5",):
            return None
        return base, alterations

    if has_maj_marker:
        quality = "mMaj7" if minor else "maj7"
        if extension in ("9", "11", "13"):
            alterations.insert(0, extension)
        elif extension not in (None, "7"):
            return None
        return quality, alterations

    if extension is None:
        return ("m" if minor else "maj"), alterations

    if extension in ("6", "69", "6/9"):
        quality = "m6" if minor else "maj6"
        if extension != "6":
            alterations.insert(0, "9")
        return quality, alterations

    if extension == "5":
        if minor:
            return None
        return "5", alterations

    # 7 / 9 / 11 / 13 → seventh-chord family
    if minor:
        quality = "m7"
    else:
        quality = "7"
    if extension != "7":
        alterations.insert(0, extension)
    # m7b5 is a quality of its own, not an altered m7
    if quality == "m7" and alterations and alterations[0] == "b5":
        return "m7b5", alterations[1:]
    return quality, alterations
