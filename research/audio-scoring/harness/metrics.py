"""Similarity metrics between a take and a reference rendering.

Every metric returns a Result with `similarity` in [0, 1] and the `lag`
(seconds into the take where the reference's phrase offset 0 sits).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import librosa
from scipy.signal import correlate

from .features import FEATURE_SR, FRAME_SECONDS, Features, extract, extract_reference, f0_track
from .takes import ExpectedNote, Take


@dataclass
class Result:
    similarity: float
    lag: float
    extra: dict = field(default_factory=dict)


# ----------------------------------------------------------------------------
# Frame similarity with silence agreement: both silent → 1, one silent → 0,
# both sounding → cosine of the (unit) feature columns.
# ----------------------------------------------------------------------------
def frame_similarity(ref: np.ndarray, ref_on: np.ndarray, take: np.ndarray, take_on: np.ndarray) -> np.ndarray:
    cos = np.einsum("ij,ij->j", ref, take)
    both_silent = (~ref_on) & (~take_on)
    one_silent = ref_on ^ take_on
    return np.where(both_silent, 1.0, np.where(one_silent, 0.0, cos))


def _spans(ref_f: Features) -> tuple[int, int]:
    """(required frames, scored frames) of a reference."""
    R = int(ref_f.required.sum()) if ref_f.required is not None else ref_f.frames
    S = int(ref_f.scored.sum()) if ref_f.scored is not None else ref_f.frames
    return R, S


def sliding_similarity(ref_feat: np.ndarray, ref_on: np.ndarray, take_feat: np.ndarray, take_on: np.ndarray,
                       lag_frames: range, spans: tuple[int, int] | None = None) -> tuple[np.ndarray, list[int]]:
    """Mean frame similarity of the reference's scored span at each lag (no
    warping). The reference may overhang the take's end: notated frames the
    take does not hold count as missed (0); extension frames past the end are
    dropped from the denominator."""
    R, S = (ref_feat.shape[1], ref_feat.shape[1]) if spans is None else spans
    T = take_feat.shape[1]
    lags = [k for k in lag_frames if -S < k < T]
    sims = np.zeros(len(lags))
    for i, k in enumerate(lags):
        rs, ts, n = _overlap(k, S, T)
        if n == 0:
            continue
        s = frame_similarity(ref_feat[:, rs:rs + n], ref_on[rs:rs + n], take_feat[:, ts:ts + n], take_on[ts:ts + n])
        # denominator: required frames from rs on (those before the recording are unknown), at least the overlap
        denom = max(R - rs, n)
        sims[i] = s.sum() / denom
    return sims, lags


def lag_range(take: Take, ref_seconds: float) -> range:
    """Where phrase offset 0 may sit in the take (frames; negative = before
    the recording started).

    Lick practice: the window opens on a bar line that lands ~0.1 s into the
    blob (stampLead - blobStartOffset, src/lib/audio/capture-timing.ts), so
    search ±0.6 s around it. Ear training: the user enters when they like —
    search the whole take — and, ONLY for takes recorded before the capture
    was pre-armed (exports without `audio.captureTrimSeconds`, before
    2026-08-11), up to one beat before it: those recordings start on the first
    confident reading, i.e. inside the first note, and reference frames before
    the recording are unknown rather than missed. A pre-armed take that lost
    its first note (2026-08-10 pent run) is charged for it.
    """
    T = int(take.duration / FRAME_SECONDS)
    if take.source == "lick-practice":
        c = int(0.1 / FRAME_SECONDS)
        w = int(0.6 / FRAME_SECONDS)
        return range(max(0, c - w), c + w + 1)
    if take.prearmed:
        return range(0, T)  # the recording began before the player did; nothing can precede it
    return range(-int(60.0 / take.tempo / FRAME_SECONDS), T)


def _overlap(k: int, S: int, T: int) -> tuple[int, int, int]:
    """(ref_start, take_start, n) for lag k: the reference frames the take holds."""
    rs, ts = max(0, -k), max(0, k)
    n = max(0, min(S - rs, T - ts))
    return rs, ts, n


# ----------------------------------------------------------------------------
# M1: raw waveform normalised cross-correlation
# ----------------------------------------------------------------------------
def _valid_lags(lags: range, required: int, T: int) -> list[int]:
    """Lags (frames) at which at least half the notated span lies inside the take."""
    half = required // 2
    return [k for k in lags if k + required - half >= 0 and k + half <= T] or list(lags)


def m1_raw_xcorr(take_y: np.ndarray, ref_y: np.ndarray, sr: int, lags: range, required_seconds: float) -> Result:
    hop = int(FRAME_SECONDS * sr)
    T = len(take_y) // hop
    ks = _valid_lags(lags, int(required_seconds / FRAME_SECONDS), T)
    lags = range(ks[0], ks[-1] + 1)
    front = max(0, -lags.start) * hop
    lo, hi = lags.start * hop + front, (lags.stop - 1) * hop + front
    x = np.concatenate([np.zeros(front), take_y.astype(np.float64)])
    r = ref_y.astype(np.float64)
    R = len(r)
    x = np.concatenate([x, np.zeros(R)])
    c = correlate(x, r, mode="valid", method="fft")  # c[k] = sum x[k+j] r[j]
    # running energy of x over windows of length R
    cs = np.concatenate([[0.0], np.cumsum(x * x)])
    ex = cs[R:] - cs[:-R]
    ncc = c / (np.sqrt(ex * (r @ r)) + 1e-12)
    ncc[ex < 0.05 * ex.max()] = 0.0  # a window holding almost none of the take is noise, not a match
    k0, k1 = max(0, lo), min(len(ncc) - 1, hi)
    if k1 < k0:
        k0, k1 = 0, len(ncc) - 1
    seg = np.abs(ncc[k0:k1 + 1])
    k = int(np.argmax(seg)) + k0 - front
    return Result(float(np.clip(seg.max(), 0, 1)), k / sr)


# ----------------------------------------------------------------------------
# M2: onset-strength envelope cross-correlation (+ peak counts)
# ----------------------------------------------------------------------------
def m2_envelope_xcorr(take_f: Features, ref_f: Features, lags: range, at_lag: int | None = None) -> Result:
    """Normalised cross-correlation of onset-strength envelopes. With `at_lag`
    the value at that lag is returned instead of the best lag — the best lag
    is aliased by the metronome grid the blob carries (clicks every beat
    correlate with note onsets on every beat), so the pitch-aware lag is the
    honest anchor."""
    required = int(ref_f.required.sum()) if ref_f.required is not None else ref_f.frames
    ks = _valid_lags(lags, required, take_f.frames)
    lags = range(ks[0], ks[-1] + 1)
    # a 3-frame triangular smoothing takes the sub-frame alignment of sharp
    # attacks out of the correlation (a half-frame shift otherwise costs ~0.2)
    kern = np.array([0.25, 0.5, 0.25])
    a = np.convolve(take_f.onset_env, kern, mode="same"); a = a - a.mean()
    b = np.convolve(ref_f.onset_env, kern, mode="same"); b = b - b.mean()
    R = len(b)
    front = max(0, -lags.start)
    a = np.concatenate([np.zeros(front), a, np.zeros(R)])  # reach negative lags; let the reference overhang
    c = correlate(a, b, mode="valid")
    cs = np.concatenate([[0.0], np.cumsum(a * a)])
    ea = cs[R:] - cs[:-R]
    ncc = c / (np.sqrt(ea * (b @ b)) + 1e-12)
    ncc[ea < 0.05 * ea.max()] = 0.0
    if at_lag is not None:
        j = at_lag + front
        v = float(ncc[j]) if 0 <= j < len(ncc) else 0.0
        return Result(float(np.clip(v, 0, 1)), at_lag * FRAME_SECONDS, {"take_peaks": 0, "ref_peaks": 0})
    ks = [k + front for k in lags if 0 <= k + front < len(ncc)] or list(range(len(ncc)))
    seg = ncc[ks]
    i = int(np.argmax(seg))
    k = ks[i] - front
    take_peaks = len(librosa.onset.onset_detect(onset_envelope=take_f.onset_env, sr=FEATURE_SR, hop_length=512))
    ref_peaks = len(librosa.onset.onset_detect(onset_envelope=ref_f.onset_env, sr=FEATURE_SR, hop_length=512))
    return Result(float(np.clip(seg[i], 0, 1)), k * FRAME_SECONDS,
                  {"take_peaks": take_peaks, "ref_peaks": ref_peaks})


# ----------------------------------------------------------------------------
# M3 / M4: feature similarity at the best lag, no warping; and banded DTW
# ----------------------------------------------------------------------------
def best_lag(take_f: Features, ref_f: Features, feat: str, lags: range) -> tuple[int, float]:
    rf, tf = getattr(ref_f, feat), getattr(take_f, feat)
    sims, ks = sliding_similarity(rf, ref_f.sounding, tf, take_f.sounding, lags, spans=_spans(ref_f))
    i = int(np.argmax(sims))
    return ks[i], float(sims[i])


def sim_at_lag(take_f: Features, ref_f: Features, feat: str, k: int) -> float:
    rf, tf = getattr(ref_f, feat), getattr(take_f, feat)
    (R, S), T = _spans(ref_f), tf.shape[1]
    rs, ts, n = _overlap(k, S, T)
    if n == 0:
        return 0.0
    s = frame_similarity(rf[:, rs:rs + n], ref_f.sounding[rs:rs + n], tf[:, ts:ts + n], take_f.sounding[ts:ts + n])
    return float(s.sum() / max(R - rs, n))


def dtw_similarity(take_f: Features, ref_f: Features, feat: str, k: int, band_seconds: float = 0.25) -> float:
    """Subsequence DTW of the reference against the take segment at lag k
    (plus one band of margin each side), Sakoe-Chiba band ±band_seconds,
    cost = 1 - frame similarity. Similarity = 1 - (path cost / reference
    frames): normalising by the reference length rather than the path length
    keeps a path from buying cheap steps by stacking take frames on one
    reference frame."""
    rf, tf = getattr(ref_f, feat), getattr(take_f, feat)
    (_, S), T = _spans(ref_f), tf.shape[1]
    rs, ts0, R = _overlap(k, S, T)  # DTW over the scored span the take holds
    if R < 2:
        return 0.0
    rf = rf[:, rs:rs + R]
    b = int(band_seconds / FRAME_SECONDS)
    lo, hi = max(0, ts0 - b), min(T, ts0 + R + b)
    ts = tf[:, lo:hi]
    ton = take_f.sounding[lo:hi]
    if ts.shape[1] < 2:
        return 0.0
    # cost matrix (R x N)
    cos = rf.T @ ts  # (R, N)
    ron = ref_f.sounding[rs:rs + R, None]
    tonm = ton[None, :]
    both_silent = (~ron) & (~tonm)
    one_silent = ron ^ tonm
    S = np.where(both_silent, 1.0, np.where(one_silent, 0.0, cos))
    C = 1.0 - S
    D, wp = librosa.sequence.dtw(C=C, subseq=True, global_constraints=True,
                                 band_rad=max(0.05, (2 * b) / max(R, ts.shape[1])))
    path = wp[::-1]
    cost = C[path[:, 0], path[:, 1]].sum() / R
    return float(np.clip(1.0 - cost, 0, 1))


# ----------------------------------------------------------------------------
# M5: frame-level pitch coverage (segmentation-free, no synthesis)
# ----------------------------------------------------------------------------
RELEASE_TOLERANCE = 0.12  # s after a note's end where its own pitch still sounding is not an extra


def piano_roll(expected: list[ExpectedNote], frames: int, lag_frames: int, tail: float = 0.0) -> np.ndarray:
    """Expected MIDI per frame (nan = rest). With `tail`, each note is
    extended by that many seconds where the next note does not already sound."""
    roll = np.full(frames, np.nan)
    for n in sorted(expected, key=lambda n: n.onset, reverse=True):
        a = lag_frames + int(round(n.onset / FRAME_SECONDS))
        b = lag_frames + int(round((n.onset + n.duration + tail) / FRAME_SECONDS))
        a, b = max(0, a), min(frames, b)
        if b > a:
            roll[a:b] = n.midi
    return roll


def m5_frame_coverage(take_f: Features, expected: list[ExpectedNote], lag_frames: int,
                      octave_insensitive: bool, tolerance_st: float = 0.5) -> Result:
    f0 = f0_track(take_f)
    T = take_f.frames
    roll = piano_roll(expected, T, lag_frames)
    roll_tail = piano_roll(expected, T, lag_frames, tail=RELEASE_TOLERANCE)
    sounded = ~np.isnan(f0) & take_f.sounding
    exp_on = ~np.isnan(roll)

    def matches(r):
        d = f0 - r
        if octave_insensitive:
            d = (d + 6) % 12 - 6
        return sounded & ~np.isnan(r) & (np.abs(d) <= tolerance_st)

    match = matches(roll)
    match_or_release = matches(roll_tail)
    precision = match_or_release.sum() / max(1, sounded.sum())
    recall = match.sum() / max(1, exp_on.sum())
    f1 = 2 * precision * recall / max(1e-9, precision + recall)
    return Result(float(f1), lag_frames * FRAME_SECONDS,
                  {"precision": float(precision), "recall": float(recall),
                   "sounded_frames": int(sounded.sum()), "expected_frames": int(exp_on.sum())})


# ----------------------------------------------------------------------------
# All metrics for one (take, rendering)
# ----------------------------------------------------------------------------
def compare(take: Take, take_f: Features, expected: list[ExpectedNote], ref_y: np.ndarray, ref_f: Features,
            octave_insensitive: bool | None = None) -> dict[str, Result]:
    oi = take.octave_insensitive if octave_insensitive is None else octave_insensitive
    ref_seconds = len(ref_y) / take.sr
    lags = lag_range(take, ref_seconds)
    out: dict[str, Result] = {}
    notated = max(n.onset + n.duration for n in expected)
    out["m1_raw"] = m1_raw_xcorr(take.band, ref_y, take.sr, lags, notated)
    out["m2_env"] = m2_envelope_xcorr(take_f, ref_f, lags)
    band = max(0.25, 0.5 * 60.0 / take.tempo)
    k3, s3 = best_lag(take_f, ref_f, "chroma", lags)
    out["m3_chroma"] = Result(s3, k3 * FRAME_SECONDS)
    out["m3_chroma_dtw"] = Result(dtw_similarity(take_f, ref_f, "chroma", k3, band), k3 * FRAME_SECONDS)
    k4, s4 = best_lag(take_f, ref_f, "cqt", lags)
    out["m4_cqt"] = Result(s4, k4 * FRAME_SECONDS)
    out["m4_cqt_dtw"] = Result(dtw_similarity(take_f, ref_f, "cqt", k4, band), k4 * FRAME_SECONDS)
    out["m2_env_at"] = m2_envelope_xcorr(take_f, ref_f, lags, at_lag=k3)
    out["m5_cover"] = m5_frame_coverage(take_f, expected, k3, oi)
    out["m5_cover_strict"] = m5_frame_coverage(take_f, expected, k3, False)
    return out


METRIC_NAMES = ["m1_raw", "m2_env", "m2_env_at", "m3_chroma", "m3_chroma_dtw", "m4_cqt", "m4_cqt_dtw", "m5_cover", "m5_cover_strict"]
