"""Benchmark metric formulas — every ratio carries its denominator.

No confidence values, no weighting magic: measured ratios with explicit
counts, so a "0.95" can always be read as "19 of 20".
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from typing import Any

from omr.benchmark.align import align_measures, lcs_pairs
from omr.models import Measure, NoteEvent, ParsedChord


@dataclass
class Ratio:
    num: int
    den: int

    @property
    def value(self) -> float | None:
        return self.num / self.den if self.den else None

    def to_dict(self) -> dict[str, Any]:
        return {"num": self.num, "den": self.den, "value": self.value}

    def __str__(self) -> str:
        return f"{self.num}/{self.den}"


@dataclass
class ChartMetrics:
    measure_count_error: int
    measure_alignment: Ratio
    pitch_strict: Ratio
    pitch_midi: Ratio
    accidental: Ratio
    rhythm_exact: Ratio
    onset_only: Ratio
    duration_only: Ratio
    chord_exact: Ratio
    chord_root: Ratio
    chord_quality: Ratio
    chord_alterations: Ratio
    chord_insertions: int
    key_signature_match: bool | None
    time_signature_match: bool | None
    repeat_f1: float | None
    rehearsal_f1: float | None

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {}
        for name, value in vars(self).items():
            data[name] = value.to_dict() if isinstance(value, Ratio) else value
        return data


def evaluate_chart(
    gt_measures: list[Measure],
    pred_measures: list[Measure],
    *,
    gt_key: str | None,
    pred_key: str | None,
    gt_ts: tuple[int, int] | None,
    pred_ts: tuple[int, int] | None,
) -> ChartMetrics:
    alignment = align_measures(
        [_pitch_set(m) for m in gt_measures], [_pitch_set(m) for m in pred_measures]
    )

    gt_notes = _melody(gt_measures)
    pred_notes = _melody(pred_measures)

    strict_matches = lcs_pairs(
        [n.spelled_pitch for n in gt_notes], [n.spelled_pitch for n in pred_notes]
    )
    midi_matches = lcs_pairs([n.midi for n in gt_notes], [n.midi for n in pred_notes])

    accidental_num = sum(
        1
        for gi, pj in midi_matches
        if gt_notes[gi].spelled_pitch == pred_notes[pj].spelled_pitch
    )
    onset_num = sum(
        1 for gi, pj in midi_matches if gt_notes[gi].onset == pred_notes[pj].onset
    )
    duration_num = sum(
        1 for gi, pj in midi_matches if gt_notes[gi].duration == pred_notes[pj].duration
    )
    rhythm_num = sum(
        1
        for gi, pj in midi_matches
        if gt_notes[gi].onset == pred_notes[pj].onset
        and gt_notes[gi].duration == pred_notes[pj].duration
    )

    chords = _chord_metrics(gt_measures, pred_measures, alignment)

    return ChartMetrics(
        measure_count_error=abs(len(pred_measures) - len(gt_measures)),
        measure_alignment=Ratio(len(alignment), len(gt_measures)),
        pitch_strict=Ratio(len(strict_matches), len(gt_notes)),
        pitch_midi=Ratio(len(midi_matches), len(gt_notes)),
        accidental=Ratio(accidental_num, len(midi_matches)),
        rhythm_exact=Ratio(rhythm_num, len(midi_matches)),
        onset_only=Ratio(onset_num, len(midi_matches)),
        duration_only=Ratio(duration_num, len(midi_matches)),
        chord_exact=chords["exact"],
        chord_root=chords["root"],
        chord_quality=chords["quality"],
        chord_alterations=chords["alterations"],
        chord_insertions=chords["insertions"],
        key_signature_match=_text_match(gt_key, pred_key),
        time_signature_match=(
            None if gt_ts is None or pred_ts is None else tuple(gt_ts) == tuple(pred_ts)
        ),
        repeat_f1=_event_f1(
            _repeat_events(gt_measures, None), _repeat_events(pred_measures, alignment)
        ),
        rehearsal_f1=_event_f1(
            _rehearsal_events(gt_measures, None), _rehearsal_events(pred_measures, alignment)
        ),
    )


# ---------------------------------------------------------------------------


def _melody(measures: list[Measure]) -> list[NoteEvent]:
    return [n for m in measures for n in m.notes if not n.is_rest]


def _pitch_set(measure: Measure) -> set:
    return {n.spelled_pitch for n in measure.notes if not n.is_rest}


def _text_match(a: str | None, b: str | None) -> bool | None:
    if a is None or b is None:
        return None
    return unicodedata.normalize("NFC", a.strip()) == unicodedata.normalize("NFC", b.strip())


def _root_of(parsed: ParsedChord | None) -> tuple[str, str] | None:
    return (parsed.root_letter, parsed.root_accidental) if parsed else None


def _chord_metrics(
    gt_measures: list[Measure],
    pred_measures: list[Measure],
    alignment: list[tuple[int, int]],
) -> dict[str, Any]:
    pred_for_gt = dict(alignment)
    exact = root = quality = alterations_num = 0
    rq_matched = 0
    matched_pred: set[tuple[int, int]] = set()
    gt_total = 0

    for gi, gm in enumerate(gt_measures):
        pi = pred_for_gt.get(gi)
        pm = pred_measures[pi] if pi is not None else None
        for gt_chord in gm.chords:
            gt_total += 1
            pred_chord = None
            if pm is not None:
                for ci, candidate in enumerate(pm.chords):
                    if candidate.onset == gt_chord.onset and (pi, ci) not in matched_pred:
                        pred_chord = candidate
                        matched_pred.add((pi, ci))
                        break
            if pred_chord is None:
                continue

            if _text_match(gt_chord.raw, pred_chord.raw):
                exact += 1
            g, p = gt_chord.parsed, pred_chord.parsed
            if g is not None and p is not None:
                root_ok = _root_of(g) == _root_of(p)
                quality_ok = g.quality == p.quality
                root += root_ok
                quality += quality_ok
                if root_ok and quality_ok:
                    rq_matched += 1
                    alterations_num += set(g.alterations) == set(p.alterations)

    total_pred = sum(len(m.chords) for m in pred_measures)
    return {
        "exact": Ratio(exact, gt_total),
        "root": Ratio(root, gt_total),
        "quality": Ratio(quality, gt_total),
        "alterations": Ratio(alterations_num, rq_matched),
        "insertions": total_pred - len(matched_pred),
    }


def _repeat_events(
    measures: list[Measure], alignment: list[tuple[int, int]] | None
) -> set[tuple[int, str]]:
    index_map = _to_gt_index(alignment, len(measures))
    events: set[tuple[int, str]] = set()
    for i, m in enumerate(measures):
        gi = index_map(i)
        if m.start_repeat:
            events.add((gi, "start_repeat"))
        if m.end_repeat:
            events.add((gi, "end_repeat"))
        if m.ending is not None:
            events.add((gi, f"ending_{m.ending}"))
    return events


def _rehearsal_events(
    measures: list[Measure], alignment: list[tuple[int, int]] | None
) -> set[tuple[int, str]]:
    index_map = _to_gt_index(alignment, len(measures))
    return {
        (index_map(i), f"mark_{m.rehearsal_mark}")
        for i, m in enumerate(measures)
        if m.rehearsal_mark is not None
    }


def _to_gt_index(alignment: list[tuple[int, int]] | None, count: int):
    """Map a measure index into ground-truth index space.

    Ground truth passes alignment=None (identity); predictions map through
    the alignment, with unaligned prediction measures assigned unique
    negative indices so they can only ever be false positives."""
    if alignment is None:
        return lambda i: i
    pred_to_gt = {p: g for g, p in alignment}
    return lambda i: pred_to_gt.get(i, -(i + 1))


def _event_f1(gt_events: set, pred_events: set) -> float | None:
    if not gt_events and not pred_events:
        return None
    if not gt_events or not pred_events:
        return 0.0
    overlap = len(gt_events & pred_events)
    return 2 * overlap / (len(gt_events) + len(pred_events))
