"""Frame features shared by the metrics. Everything at FEATURE_SR / HOP."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import librosa
from scipy.signal import butter, sosfiltfilt

FEATURE_SR = 22050
HOP = 512  # 23.2 ms
FRAME_SECONDS = HOP / FEATURE_SR
CQT_MIN_MIDI = 40  # E2
CQT_BINS = 45  # E2..C6, one bin per semitone
# Harmonic salience: each semitone bin sums the CQT magnitude at its first
# HARMONICS partials (weights 1/h), which folds a note's spectrum down onto
# its fundamental so neighbouring semitones stop looking alike.
HARMONICS = 5
HARMONIC_OFFSETS = [int(round(12 * np.log2(h))) for h in range(1, HARMONICS + 1)]
EXTRA_BINS = HARMONIC_OFFSETS[-1]
SILENCE_DB = -30.0  # frame energy gate, relative to the signal's loudest frame (the app's PERFORMANCE_FLOOR_DB)
# "Sounding" is judged on 250-5000 Hz: the band the segmenter uses for
# `bandRmsMin` because no metronome voice reaches it (the kick is a sweep
# that crosses it in a few ms, the ride/hat sit above 6 kHz).
GATE_LOW_HZ = 250.0
GATE_HIGH_HZ = 5000.0


@dataclass
class Features:
    sr: int
    y: np.ndarray  # at FEATURE_SR
    chroma: np.ndarray  # (12, T) unit-norm columns (zeros where silent)
    cqt: np.ndarray  # (CQT_BINS, T) unit-norm columns
    energy_db: np.ndarray  # (T,) relative to max
    sounding: np.ndarray  # (T,) bool
    onset_env: np.ndarray  # (T,)
    scored: np.ndarray | None = None  # (T,) reference-only: frames compared (notated span + extension)
    required: np.ndarray | None = None  # (T,) reference-only: notated span; missing from the take = missed
    optional: np.ndarray | None = None  # (T,) reference-only: the back of a held note (hold-tolerant variants)
    f0_midi: np.ndarray | None = None  # (T,) nan where unvoiced (pyin), lazily computed

    @property
    def frames(self) -> int:
        """Number of frames (HOP samples at FEATURE_SR each)."""
        return self.chroma.shape[1]


def _unit(m: np.ndarray) -> np.ndarray:
    """Columns scaled to unit L2 norm; a column with norm <= 1e-9 becomes zeros."""
    n = np.linalg.norm(m, axis=0, keepdims=True)
    return np.where(n > 1e-9, m / np.maximum(n, 1e-9), 0.0)


def extract(y: np.ndarray, sr: int) -> Features:
    """Features of `y` at FEATURE_SR (resampled if needed). `y` is used as given
    (every caller passes the 90-5000 Hz band); only the energy gate filters
    again, to GATE_LOW_HZ-GATE_HIGH_HZ, in dB relative to its loudest frame.
    Chroma and the semitone map are zeroed on frames not above SILENCE_DB;
    `scored` starts all True for the caller to narrow."""
    if sr != FEATURE_SR:
        y = librosa.resample(y.astype(np.float32), orig_sr=sr, target_sr=FEATURE_SR)
    y = y.astype(np.float32)
    C = np.abs(librosa.cqt(y, sr=FEATURE_SR, hop_length=HOP, fmin=librosa.midi_to_hz(CQT_MIN_MIDI),
                           n_bins=CQT_BINS + EXTRA_BINS, bins_per_octave=12))
    cqt = np.zeros((CQT_BINS, C.shape[1]), dtype=np.float32)
    for h, off in enumerate(HARMONIC_OFFSETS, start=1):
        cqt += (1.0 / h) * C[off:off + CQT_BINS]
    cqt = cqt ** 2  # power: sharpens the peak against leakage
    chroma = librosa.feature.chroma_cqt(y=y, sr=FEATURE_SR, hop_length=HOP)
    T = min(cqt.shape[1], chroma.shape[1])
    cqt, chroma = cqt[:, :T], chroma[:, :T]
    sos = butter(4, [GATE_LOW_HZ, GATE_HIGH_HZ], btype="band", fs=FEATURE_SR, output="sos")
    yg = sosfiltfilt(sos, y).astype(np.float32)
    rms = librosa.feature.rms(y=yg, frame_length=2048, hop_length=HOP)[0][:T]
    energy_db = 20 * np.log10(np.maximum(rms, 1e-9) / max(float(rms.max()), 1e-9))
    sounding = energy_db > SILENCE_DB
    scored = np.ones(T, dtype=bool)  # frames a reference is scored on (set by the caller)
    onset_env = librosa.onset.onset_strength(y=y, sr=FEATURE_SR, hop_length=HOP)[:T]
    chroma = _unit(chroma) * sounding[None, :]
    cqt = _unit(cqt) * sounding[None, :]
    return Features(sr=FEATURE_SR, y=y, chroma=chroma, cqt=cqt, energy_db=energy_db,
                    sounding=sounding, onset_env=onset_env, scored=scored)


HOLD_REQUIRED_FRACTION = 0.5  # hold-tolerant variants: a note counts once this much of it (or one beat) is held


def extract_reference(y: np.ndarray, sr: int, notated_seconds: float, extension_seconds: float = 0.0,
                      expected=None, tempo: float | None = None) -> Features:
    """A rendering's features with two masks: `required` = the notated span
    (+1 frame; a take that does not reach these frames missed them) and
    `scored` = required plus `extension_seconds` after the line, where the
    reference is silent and anything the take sounds is an extra. The
    rendering is padded with silence to cover the extension."""
    from .takes import bandpass  # the same 90-5000 Hz band the take goes through
    ext = int(np.ceil(extension_seconds * sr))
    if ext > 0:
        y = np.concatenate([y, np.zeros(ext, dtype=np.float32)])
    f = extract(bandpass(y, sr), sr)
    n = min(f.frames, int(np.ceil(notated_seconds / FRAME_SECONDS)) + 1)
    m = min(f.frames, n + int(np.ceil(extension_seconds / FRAME_SECONDS)))
    f.required = np.zeros(f.frames, dtype=bool); f.required[:n] = True
    f.scored = np.zeros(f.frames, dtype=bool); f.scored[:m] = True
    # the padded tail is silent by construction; make sure the gate agrees
    f.sounding[n:] &= f.energy_db[n:] > SILENCE_DB
    f.optional = np.zeros(f.frames, dtype=bool)
    if expected is not None and tempo:
        beat = 60.0 / tempo
        for note in expected:
            held = max(HOLD_REQUIRED_FRACTION * note.duration, min(note.duration, beat))
            a = int(round((note.onset + held) / FRAME_SECONDS))
            b = int(round((note.onset + note.duration) / FRAME_SECONDS))
            if b > a:
                f.optional[a:min(b, f.frames)] = True
    return f


def f0_track(f: Features) -> np.ndarray:
    """pyin f0 of `f.y` as fractional MIDI per frame (80-1200 Hz search), nan
    where unvoiced, nan-padded or truncated to `f.frames`. Computed on first
    call and cached in `f.f0_midi`."""
    if f.f0_midi is None:
        f0, voiced, prob = librosa.pyin(f.y, sr=FEATURE_SR, hop_length=HOP, fmin=80.0, fmax=1200.0,
                                        frame_length=2048)
        midi = librosa.hz_to_midi(np.where(np.isnan(f0), 1.0, f0))
        midi = np.where(np.isnan(f0) | ~voiced, np.nan, midi)
        T = f.frames
        out = np.full(T, np.nan)
        m = min(T, len(midi))
        out[:m] = midi[:m]
        f.f0_midi = out
    return f.f0_midi
