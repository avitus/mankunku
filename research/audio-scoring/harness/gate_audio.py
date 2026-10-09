"""Audio-corroborated extras gate, evaluated on the Firefox takes.

For each extra the v2 gate would charge, look at the take's pitch track
inside the extra's span (phrase time + the chroma lag): if at least half of
its voiced frames sit within ±0.5 st (pitch class when octave-insensitive)
of the EXPECTED pitch sounding at that moment, the "extra" is a split or a
crack of a correct note and stays free; otherwise it is charged.

Writes results/gate_audio.csv and prints the comparison.
Run: uv run python -m harness.gate_audio
"""
from __future__ import annotations

import glob
import json
from fractions import Fraction

import numpy as np
import pandas as pd

from .takes import ROOT, load_take, load_overrides, swung_onset_beats
from .features import extract, f0_track, FRAME_SECONDS
from .fix_impact import grade, line_end_seconds

GATE_MIN_DURATION, GATE_MIN_CLARITY = 0.15, 0.8
PRE_ENTRY, TRANSITION_MAX, TRANSITION_ST = 0.1, 0.25, 2
AUDIO_MATCH_FRACTION = 0.5


def expected_roll_fn(note_results, tempo, swing):
    """Return a lookup from phrase time (s) to the expected MIDI pitch, built
    from the non-extra rows: onsets swung, each note ending at its un-swung end
    point and widened, into time no note occupies, 50 ms before its onset and
    120 ms past its end."""
    spans = []
    for r in note_results:
        if r.get("extra"):
            continue
        e = r["expected"]
        off = Fraction(e["offset"][0], e["offset"][1]); dur = Fraction(e["duration"][0], e["duration"][1])
        on = swung_onset_beats(off, swing) * 60.0 / tempo
        end = float((off + dur) * 4) * 60.0 / tempo
        spans.append((on, end, e["pitch"]))
    spans.sort(key=lambda s: s[0])
    def at(t):
        """Expected MIDI pitch sounding at phrase time `t` (s), None in a rest.
        A note owns its own span from its onset; the widening reaches only
        time no note occupies, where the later-starting note wins. (Until
        2026-10-08 the first widened row won, so the 120 ms after each note
        hid the start of the next, as in metrics.piano_roll.)"""
        body = [p for on, end, p in spans if on <= t < end]
        if body:
            return body[-1]
        near = [p for on, end, p in spans if on - 0.05 <= t < end + 0.12]
        return near[-1] if near else None
    return at


def charged_extras(note_results, tempo, swing, oi, roll_at=None, f0=None, lag=0.0):
    """Extras each gate charges, as indices into `note_results` under "thread",
    "v2" and "audio", each a subset of the one before. "v2" adds the pre-entry
    (0.1 s) and short-transition rules to the thread's gate; "audio", empty
    unless `f0` (the take's per-frame MIDI) is given, frees a v2 charge when at
    least half its voiced frames, shifted by `lag` s, match `roll_at` within
    0.5 st (pitch class when `oi`). A voiced frame in a rest counts against the
    match; a span with no voiced frame stays charged."""
    dets = sorted([(i, r["detected"]) for i, r in enumerate(note_results) if r.get("detected")], key=lambda x: x[1]["onsetTime"])
    order = [i for i, _ in dets]; pos = {i: k for k, i in enumerate(order)}
    paired = {i for i, r in enumerate(note_results) if r.get("detected") and not r.get("extra")}
    end = line_end_seconds(note_results, tempo, swing)
    start = min(swung_onset_beats(Fraction(r["expected"]["offset"][0], r["expected"]["offset"][1]), swing) * 60.0 / tempo for r in note_results if not r.get("extra"))
    out = {"thread": [], "v2": [], "audio": []}
    for i, r in enumerate(note_results):
        if not r.get("extra"):
            continue
        d = r["detected"]
        if d.get("ghost") or d["duration"] < GATE_MIN_DURATION or d["clarity"] < GATE_MIN_CLARITY or d["onsetTime"] >= end:
            continue
        k = pos[i]; pc = d["midi"] % 12
        nb = [(order[j], note_results[order[j]]["detected"]) for j in (k - 1, k + 1) if 0 <= j < len(order)]
        if any(n["midi"] % 12 == pc for _, n in nb):
            continue
        out["thread"].append(i)
        if d["onsetTime"] < start - PRE_ENTRY:
            continue
        if d["duration"] < TRANSITION_MAX and any(j in paired and abs(n["midi"] - d["midi"]) <= TRANSITION_ST for j, n in nb):
            continue
        out["v2"].append(i)
        if f0 is None:
            continue
        a = int(round((d["onsetTime"] + lag) / FRAME_SECONDS)); b = int(round((d["onsetTime"] + d["duration"] + lag) / FRAME_SECONDS))
        a, b = max(0, a), min(len(f0), b)
        seg = f0[a:b]; seg = seg[~np.isnan(seg)]
        if len(seg) == 0:
            out["audio"].append(i); continue
        match = 0
        for fi, t in zip(seg, np.arange(a, b)[~np.isnan(f0[a:b])] * FRAME_SECONDS - lag):
            p = roll_at(t)
            if p is None:
                continue
            diff = fi - p
            if oi:
                diff = (diff + 6) % 12 - 6
            if abs(diff) <= 0.5:
                match += 1
        if match / len(seg) >= AUDIO_MATCH_FRACTION:
            continue  # the frames say the line was sounding: a split, not an extra
        out["audio"].append(i)
    return out


def rescore_with(note_results, charged):
    """Overall score with `charged` extras added as zero-score notes: pitch and
    rhythm averaged over every non-extra row (paired or missed) plus `charged`,
    then weighted 0.6 / 0.4."""
    pairs = [r for r in note_results if not r.get("extra")]
    denom = len(pairs) + charged
    pitch = sum(r["pitchScore"] for r in pairs) / denom; rhythm = sum(r["rhythmScore"] for r in pairs) / denom
    return 0.6 * pitch + 0.4 * rhythm


def main():
    """Re-run the three gates on every Firefox lick-practice take listed in
    results/firefox_own.csv (octave-insensitive, at that CSV's chroma lag),
    write results/gate_audio.csv and print grade movement per gate and the
    disagreements. Expects both Wail takes (ids containing 6193df, a3d8e3)."""
    audio = pd.read_csv(ROOT / "results" / "firefox_own.csv").set_index("take")
    rows = []
    for p in sorted(glob.glob(str(ROOT / "takes" / "firefox" / "*.json"))):
        stem = p.split("/")[-1][:-5]
        if stem not in audio.index:
            continue
        d = json.load(open(p)); c = d["context"]; s = d["scoring"]["savedScore"]
        if c["source"] != "lick-practice":
            continue
        nr = s["noteResults"]; tempo = c["tempo"]; swing = c.get("swing") or 0.6
        t = load_take(stem, ROOT / "takes" / "firefox" / f"{stem}.wav", ROOT / "takes" / "firefox" / f"{stem}.json", load_overrides())
        tf = extract(t.band, t.sr); f0 = f0_track(tf)
        lag = float(audio.loc[stem, "m3_chroma_lag"])
        ch = charged_extras(nr, tempo, swing, True, expected_roll_fn(nr, tempo, swing), f0, lag)
        row = {"take": stem, "saved": s["overall"], "dtw_precision": audio.loc[stem, "m3_dtw_precision"], "extras": sum(1 for r in nr if r.get("extra"))}
        for name in ("thread", "v2", "audio"):
            row[f"{name}_charged"] = len(ch[name]); row[f"{name}_overall"] = rescore_with(nr, len(ch[name]))
        rows.append(row)
    df = pd.DataFrame(rows); df.to_csv(ROOT / "results" / "gate_audio.csv", index=False)
    base = df.saved.map(grade)
    print(f"Firefox lick practice, n={len(df)}")
    print("gate     perfect great good fair try | moved down | perfect lost | charged takes | false charges (perfect & dtwP>=.9) | Wail a | Wail b")
    wa = df[df["take"].str.contains("6193df")].iloc[0]; wb = df[df["take"].str.contains("a3d8e3")].iloc[0]
    for name in ("thread", "v2", "audio"):
        g = df[f"{name}_overall"].map(grade); cnt = g.value_counts()
        down = int((g.map(["try-again","fair","good","great","perfect"].index) < base.map(["try-again","fair","good","great","perfect"].index)).sum())
        chp = df[(df[f"{name}_charged"] > 0) & (base == "perfect")]
        print(f"{name:8s} " + " ".join(f"{int(cnt.get(k,0)):5d}" for k in ["perfect","great","good","fair","try-again"]) + f" | {down:4d} | {int(((base=='perfect')&(g!='perfect')).sum()):3d}/{int((base=='perfect').sum())} | {int((df[f'{name}_charged']>0).sum()):3d} | {int((chp.dtw_precision>=0.9).sum()):3d} of {len(chp):3d} | {wa[f'{name}_overall']:.3f} | {wb[f'{name}_overall']:.3f}")
    w = df[df["take"].str.contains("wail")]
    print("\nWail session passes (>=0.90): saved", int((w.saved>=.9).sum()), "thread", int((w.thread_overall>=.9).sum()), "v2", int((w.v2_overall>=.9).sum()), "audio", int((w.audio_overall>=.9).sum()), f"of {len(w)}")
    print("\nTakes the audio gate still charges while saved perfect and dtw precision >= 0.9:")
    print(df[(df.audio_charged>0)&(df.saved>=.95)&(df.dtw_precision>=.9)][["take","saved","audio_overall","audio_charged","extras","dtw_precision"]].to_string(index=False))
    print("\nTakes v2 charges but audio frees (and their dtw precision):")
    fr = df[(df.v2_charged>0)&(df.audio_charged<df.v2_charged)]
    print(f"  {len(fr)} takes; dtw precision median {fr.dtw_precision.median():.2f}; among them saved>=0.95: {int((fr.saved>=.95).sum())}, saved<0.85: {int((fr.saved<.85).sum())}")
    low = fr[fr.dtw_precision < 0.8][["take","saved","v2_charged","audio_charged","dtw_precision"]]
    print("  freed though the audio reads < 0.8 (possible misses of real extras):"); print(low.to_string(index=False) if len(low) else "   none")


if __name__ == "__main__":
    main()
