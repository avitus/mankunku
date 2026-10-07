"""Render an expected line to audio: the app's own tenor samples, or a
timbre-free harmonic tone. Both return mono float32 at the requested rate,
phrase offset 0 at sample 0, with `tail` seconds after the last note's end.
"""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

import numpy as np
import librosa

from .takes import ExpectedNote, REPO, ROOT, expected_note

SAMPLE_SR = 48000
SAMPLE_CACHE = ROOT / "cache" / "tenor"
TENOR_RANGE = (44, 76)
TAIL_SECONDS = 0.3
# smplr: `voice.stop(start + duration)` ramps linearly to 0 over `ampRelease`
# (node_modules/smplr/dist/index.mjs:781-785); the app's expression pass gives
# 0.06-0.35 s. A fixed 0.1 s stands in for it; note length × 0.9 stands in for
# `durationScale` (src/lib/music/expression.ts:333-377, 0.5-1.0).
RELEASE_SECONDS = 0.10
DURATION_SCALE = 0.9


@lru_cache(maxsize=1)
def tune_corrections() -> dict[int, float]:
    """Per-sample tuning in cents, parsed from the forte layer of
    TENOR_SAX_SAMPLES in src/lib/audio/sample-maps.ts."""
    src = (REPO / "src" / "lib" / "audio" / "sample-maps.ts").read_text()
    start = src.index("TENOR_SAX_SAMPLES")
    forte = src.index("forte:", start)
    end = src.index("};", forte)
    out = {}
    for m in re.finditer(r"(\d+):\s*\{\s*url:\s*'/samples/tenor-sax/f_\d+\.ogg',\s*tune:\s*(-?\d+)", src[forte:end]):
        out[int(m.group(1))] = float(m.group(2))
    assert len(out) == 33, f"expected 33 forte entries, parsed {len(out)}"
    return out


@lru_cache(maxsize=None)
def sample(midi: int, layer: str = "f") -> np.ndarray:
    p = SAMPLE_CACHE / f"{layer}_{midi}.f32"
    return np.fromfile(p, dtype=np.float32)


def _pitch_shift_rate(x: np.ndarray, rate: float) -> np.ndarray:
    """Play `x` at `rate` (2^(cents/1200)) by linear interpolation — what a
    sampler's playbackRate does, pitch and length together."""
    n_out = int(len(x) / rate)
    pos = np.arange(n_out) * rate
    return np.interp(pos, np.arange(len(x)), x).astype(np.float32)


def _envelope(n: int, sr: int, attack: float, release: float) -> np.ndarray:
    env = np.ones(n, dtype=np.float32)
    a = min(n, int(attack * sr))
    if a > 0:
        env[:a] = np.linspace(0, 1, a, dtype=np.float32)
    r = min(n, int(release * sr))
    if r > 0:
        env[n - r:] = np.linspace(1, 0, r, dtype=np.float32)
    return env


def render_sampled(expected: list[ExpectedNote], sr: int, octave_fold: bool = True) -> np.ndarray:
    """The app's tenor samples (forte layer) with their tuning corrections."""
    tunes = tune_corrections()
    length = max(n.onset + n.duration for n in expected) + TAIL_SECONDS
    buf = np.zeros(int(length * SAMPLE_SR) + 1, dtype=np.float32)
    for n in expected:
        midi = n.midi
        shift = 0
        while midi < TENOR_RANGE[0]:
            midi += 12; shift -= 12
        while midi > TENOR_RANGE[1]:
            midi -= 12; shift += 12
        if shift and not octave_fold:
            raise ValueError(f"MIDI {n.midi} outside the tenor sample range")
        cents = tunes.get(midi, 0.0) + 100.0 * shift
        x = sample(midi, "f")
        if abs(cents) > 1e-9:
            x = _pitch_shift_rate(x, 2 ** (cents / 1200.0))
        dur = n.duration * DURATION_SCALE + RELEASE_SECONDS
        m = min(len(x), int(dur * SAMPLE_SR))
        seg = x[:m] * _envelope(m, SAMPLE_SR, 0.0, RELEASE_SECONDS)
        start = int(n.onset * SAMPLE_SR)
        end = min(len(buf), start + m)
        buf[start:end] += seg[: end - start]
    if sr != SAMPLE_SR:
        buf = librosa.resample(buf, orig_sr=SAMPLE_SR, target_sr=sr).astype(np.float32)
    peak = float(np.abs(buf).max()) or 1.0
    return buf / peak * 0.5


def render_synthetic(expected: list[ExpectedNote], sr: int, partials: int = 6) -> np.ndarray:
    """Harmonic tone, 1/n partial amplitudes, 10 ms attack, 80 ms release."""
    length = max(n.onset + n.duration for n in expected) + TAIL_SECONDS
    buf = np.zeros(int(length * sr) + 1, dtype=np.float32)
    for n in expected:
        f0 = librosa.midi_to_hz(n.midi)
        dur = n.duration * DURATION_SCALE + 0.08
        m = int(dur * sr)
        t = np.arange(m) / sr
        tone = np.zeros(m, dtype=np.float32)
        for k in range(1, partials + 1):
            if f0 * k > sr / 2:
                break
            tone += (1.0 / k) * np.sin(2 * np.pi * f0 * k * t).astype(np.float32)
        tone *= _envelope(m, sr, 0.010, 0.08)
        start = int(n.onset * sr)
        end = min(len(buf), start + m)
        buf[start:end] += tone[: end - start]
    peak = float(np.abs(buf).max()) or 1.0
    return buf / peak * 0.5


def retime(expected: list[ExpectedNote], tempo: float, swing: float) -> list[ExpectedNote]:
    """The same line at another tempo/swing (onsets recomputed from fractions)."""
    return [expected_note(n.midi, n.offset_frac, n.duration_frac, tempo, swing) for n in expected]


def transpose(expected: list[ExpectedNote], semitones: int) -> list[ExpectedNote]:
    return [ExpectedNote(n.midi + semitones, n.onset, n.duration, n.offset_frac, n.duration_frac) for n in expected]


RENDERERS = {"sampled": render_sampled, "synthetic": render_synthetic}
