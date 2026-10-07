"""Load a recorded take (WAV + diagnostic JSON) and its expected notes.

Expected notes come from `scoring.savedScore.noteResults[].expected` in the
diagnostic export (concert MIDI, whole-note-fraction offset/duration, tied
chains already merged, `extra: true` rows skipped). Takes whose export lacks a
saved score take their phrase from `takes/expected-overrides.yaml`.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path

import numpy as np
import soundfile as sf
import yaml
from scipy.signal import butter, sosfiltfilt

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
CORPUS = REPO / "tests" / "fixtures" / "recordings"
TAKE_DIRS = [CORPUS, ROOT / "takes" / "downloads", ROOT / "takes" / "prod"]

# Instrument band for the comparison. Tenor's lowest concert note is Ab2
# (103.8 Hz); the digital metronome mixed into the blob is a C1 kick plus
# 6/8 kHz high-passed noise (src/lib/audio/metronome.ts). The segmenter's own
# instrument band is 250-5000 Hz (`bandRmsMin`).
BAND_LOW_HZ = 90.0
BAND_HIGH_HZ = 5000.0


@dataclass
class ExpectedNote:
    midi: int
    onset: float  # seconds from phrase offset 0 (swing applied)
    duration: float  # seconds (notated, no articulation)
    offset_frac: Fraction
    duration_frac: Fraction


@dataclass
class Take:
    id: str
    wav_path: Path
    json_path: Path | None
    audio: np.ndarray  # mono float32, native rate, UNFILTERED
    sr: int
    tempo: float
    swing: float
    source: str  # 'ear-training' | 'lick-practice' | 'unknown'
    octave_insensitive: bool
    concert_key: str | None
    phrase_id: str | None
    phrase_name: str | None
    expected: list[ExpectedNote]
    saved_overall: float | None
    saved_notes_hit: int | None
    saved_grade: str | None
    timing_assumed: bool = False  # phrase rhythm/tempo not recorded, assumed
    capture_trim: float = 0.0
    prearmed: bool = True  # capture armed before the user played (exports carry audio.captureTrimSeconds from 2026-08-11)
    transport_seconds: float | None = None
    metronome: bool | None = None
    raw: dict = field(default_factory=dict, repr=False)

    @property
    def band(self) -> np.ndarray:
        """Band-passed copy (90-5000 Hz), cached."""
        if "_band" not in self.raw:
            self.raw["_band"] = bandpass(self.audio, self.sr)
        return self.raw["_band"]

    @property
    def expected_length(self) -> float:
        return max(n.onset + n.duration for n in self.expected) if self.expected else 0.0

    @property
    def duration(self) -> float:
        return len(self.audio) / self.sr


def bandpass(x: np.ndarray, sr: int) -> np.ndarray:
    sos = butter(4, [BAND_LOW_HZ, BAND_HIGH_HZ], btype="band", fs=sr, output="sos")
    return sosfiltfilt(sos, x).astype(np.float32)


def swung_onset_beats(offset: Fraction, swing: float) -> float:
    """Beats from phrase start with swing applied.

    Copied from src/lib/music/swing.ts:25-32 (`applySwingToBeats`) as the
    scorer uses it (src/lib/scoring/scorer.ts:30-41): only an off-beat eighth
    (beat fraction == 0.5) moves, by (swing - 0.5) beats.
    """
    beats = float(offset * 4)
    frac = beats - np.floor(beats)
    if abs(frac - 0.5) < 1e-6:
        beats += swing - 0.5
    return beats


def expected_from_note_results(note_results: list[dict], tempo: float, swing: float) -> list[ExpectedNote]:
    out = []
    for nr in note_results:
        if nr.get("extra"):
            continue
        e = nr["expected"]
        off = Fraction(e["offset"][0], e["offset"][1])
        dur = Fraction(e["duration"][0], e["duration"][1])
        out.append(expected_note(int(e["pitch"]), off, dur, tempo, swing))
    out.sort(key=lambda n: n.onset)
    return out


def expected_note(midi: int, off: Fraction, dur: Fraction, tempo: float, swing: float) -> ExpectedNote:
    spb = 60.0 / tempo
    onset = swung_onset_beats(off, swing) * spb
    # Duration: notated fraction × 4 beats × seconds per beat. A swung
    # off-beat eighth is shorter by the swing shift in the app too (its end is
    # the next on-beat), so end at the un-swung end point.
    end = float((off + dur) * 4) * spb
    return ExpectedNote(midi=midi, onset=onset, duration=max(0.05, end - onset), offset_frac=off, duration_frac=dur)


def load_overrides() -> dict:
    p = ROOT / "takes" / "expected-overrides.yaml"
    return yaml.safe_load(p.read_text()) if p.exists() else {}


def load_truth() -> dict:
    p = ROOT / "takes" / "truth.yaml"
    return yaml.safe_load(p.read_text()) if p.exists() else {}


def discover() -> dict[str, tuple[Path, Path | None]]:
    """Every WAV across the take dirs, keyed by stem; JSON beside it if any.

    A stem present in more than one dir: the first dir wins for the WAV, but
    a JSON from any dir fills a missing one (the corpus has WAV-only and
    JSON-only halves whose other half sits in Downloads).
    """
    found: dict[str, tuple[Path, Path | None]] = {}
    for d in TAKE_DIRS:
        if not d.exists():
            continue
        for wav in sorted(d.glob("*.wav")):
            stem = wav.stem
            js = wav.with_suffix(".json")
            if stem not in found:
                found[stem] = (wav, js if js.exists() else None)
            elif found[stem][1] is None and js.exists():
                found[stem] = (found[stem][0], js)
    # JSON-only stems get a WAV from another dir if present
    for d in TAKE_DIRS:
        if not d.exists():
            continue
        for js in sorted(d.glob("*.json")):
            stem = js.stem
            if stem in found and found[stem][1] is None:
                found[stem] = (found[stem][0], js)
    return found


def load_take(stem: str, wav: Path, js: Path | None, overrides: dict | None = None) -> Take:
    overrides = overrides if overrides is not None else load_overrides()
    audio, sr = sf.read(wav, dtype="float32", always_2d=True)
    audio = audio[:, 0]
    d = json.loads(js.read_text()) if js else {}
    ctx = d.get("context", {}) or {}
    scoring = d.get("scoring", {}) or {}
    saved = scoring.get("savedScore") or None
    ov = overrides.get(stem)

    tempo = float(ctx.get("tempo") or (ov or {}).get("tempo") or 100)
    swing = float(ctx.get("swing") if ctx.get("swing") is not None else (ov or {}).get("swing", 0.6))
    source = ctx.get("source") or (ov or {}).get("source") or "unknown"
    timing_assumed = False
    if saved and saved.get("noteResults"):
        expected = expected_from_note_results(saved["noteResults"], tempo, swing)
    elif ov and ov.get("notes"):
        expected = [
            expected_note(int(n["pitch"]), Fraction(n["offset"][0], n["offset"][1]), Fraction(n["duration"][0], n["duration"][1]), tempo, swing)
            for n in ov["notes"]
        ]
        # merge tied chains (same pitch, contiguous, tied flag) as extractSoundingNotes does
        merged: list[ExpectedNote] = []
        for n, src_n in zip(expected, ov["notes"]):
            if merged and src_n.get("_tie_prev") and merged[-1].midi == n.midi:
                prev = merged[-1]
                prev.duration = (n.onset + n.duration) - prev.onset
                prev.duration_frac = prev.duration_frac + n.duration_frac
            else:
                merged.append(n)
        expected = merged
        timing_assumed = bool(ov.get("timing_assumed", False))
    else:
        expected = []
    octave_insensitive = source in ("lick-practice", "tune-practice")
    if ov and "octave_insensitive" in ov:
        octave_insensitive = bool(ov["octave_insensitive"])
    return Take(
        id=stem,
        wav_path=wav,
        json_path=js,
        audio=audio,
        sr=int(sr),
        tempo=tempo,
        swing=swing,
        source=source,
        octave_insensitive=octave_insensitive,
        concert_key=ctx.get("concertKey") or (ov or {}).get("key"),
        phrase_id=ctx.get("phraseId") or (ov or {}).get("phrase_id"),
        phrase_name=ctx.get("phraseName") or (ov or {}).get("phrase_name"),
        expected=expected,
        saved_overall=(saved or {}).get("overall"),
        saved_notes_hit=(saved or {}).get("notesHit"),
        saved_grade=(saved or {}).get("grade"),
        timing_assumed=timing_assumed,
        capture_trim=float((d.get("audio") or {}).get("captureTrimSeconds") or 0.0),
        prearmed="captureTrimSeconds" in (d.get("audio") or {}),
        transport_seconds=ctx.get("transportSeconds"),
        metronome=ctx.get("metronomeEnabled"),
        raw=d,
    )


def load_all(ids: list[str] | None = None) -> list[Take]:
    overrides = load_overrides()
    takes = []
    for stem, (wav, js) in discover().items():
        if ids and stem not in ids:
            continue
        t = load_take(stem, wav, js, overrides)
        if not t.expected:
            print(f"skip {stem}: no expected notes (no savedScore, no override)")
            continue
        takes.append(t)
    return takes


def phrase_signature(t: Take) -> tuple:
    """Identity of the expected line: (midi, offset, duration) tuples."""
    return tuple((n.midi, n.offset_frac, n.duration_frac) for n in t.expected)


if __name__ == "__main__":
    for t in load_all():
        print(f"{t.id:50s} {t.source:13s} sr={t.sr} dur={t.duration:5.2f} tempo={t.tempo:5.1f} sw={t.swing:.2f} "
              f"oct_ins={int(t.octave_insensitive)} n={len(t.expected):2d} len={t.expected_length:5.2f} "
              f"saved={t.saved_overall if t.saved_overall is None else round(t.saved_overall, 3)} "
              f"{'(timing assumed)' if t.timing_assumed else ''}")
