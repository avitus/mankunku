"""Step 1 of the path forward (2026-10-07): rescore every saved production
session under the scorer-side fixes BEFORE any of them ships.

Inputs: the 1943 `session_results` rows pulled from production
(takes/prod/raw/session_results.json) and the 393 Firefox takes
(takes/firefox/*.json, with audio metrics in results/firefox_own.csv).
A saved score is a pure function of its noteResults, so each fix can be
re-applied to the saved pairs without audio:

  F1 gated   — an extra counts as a zero in both accuracies when it is a note
               the player plausibly made: duration >= 150 ms, clarity >= 0.8,
               not a ghost, no same-pitch-class neighbour among the detected
               notes, onset before the written line's end (the gate the
               adjacent thread found keeps every detector artefact free).
  F1 naive   — every extra counts (what the docs promised).
  F3         — rhythm penalty 1.0 at every tempo (zero at one beat off),
               instead of min(1, 0.5 + tempo/300). The saved per-pair
               rhythmScore gives the timing error back exactly:
               err = (1 - rhythmScore) / penalty_old, so the new score is
               max(0, 1 - err) without needing swing or onsets.
  (F2 and F4 are off by decision: a sharp note keeps its rhythm credit, an
  early release never lowers the score.)

Writes results/fix_impact.md and results/fix_impact_firefox.csv.
Run: uv run python -m harness.fix_impact
"""
from __future__ import annotations

import glob
import json
from fractions import Fraction

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from .takes import ROOT

GRADES = [("perfect", 0.95), ("great", 0.85), ("good", 0.70), ("fair", 0.55)]
ORDER = ["try-again", "fair", "good", "great", "perfect"]
GATE_MIN_DURATION = 0.15
GATE_MIN_CLARITY = 0.8


def grade(x: float) -> str:
    for g, m in GRADES:
        if x >= m:
            return g
    return "try-again"


def line_end_seconds(note_results, tempo, swing=0.6):
    end = 0.0
    for r in note_results:
        if r.get("extra"):
            continue
        e = r["expected"]
        off = Fraction(e["offset"][0], e["offset"][1]); dur = Fraction(e["duration"][0], e["duration"][1])
        end = max(end, float((off + dur) * 4) * 60.0 / tempo)
    return end


def gated_extras(note_results, tempo):
    """Indices (into note_results) of the extras that count under the gate."""
    dets = [(i, r["detected"]) for i, r in enumerate(note_results) if r.get("detected")]
    dets.sort(key=lambda x: x[1]["onsetTime"])
    order = [i for i, _ in dets]
    pos = {i: k for k, i in enumerate(order)}
    end = line_end_seconds(note_results, tempo)
    out = []
    for i, r in enumerate(note_results):
        if not r.get("extra"):
            continue
        d = r["detected"]
        if d.get("ghost") or d["duration"] < GATE_MIN_DURATION or d["clarity"] < GATE_MIN_CLARITY:
            continue
        if d["onsetTime"] >= end:
            continue
        k = pos[i]
        pc = d["midi"] % 12
        neighbours = [note_results[order[j]]["detected"] for j in (k - 1, k + 1) if 0 <= j < len(order)]
        if any(n["midi"] % 12 == pc for n in neighbours):
            continue
        out.append(i)
    return out


def rescore(note_results, tempo, f1="none", f3=False):
    pairs = [r for r in note_results if not r.get("extra")]
    n_exp = len(pairs)
    if n_exp == 0:
        return None
    pen_old = min(1.0, 0.5 + tempo / 300.0)
    pitch_sum = sum(r["pitchScore"] for r in pairs)
    rhythm_sum = 0.0
    for r in pairs:
        rs = r["rhythmScore"]
        if f3 and r.get("detected") and rs > 0:
            err = (1.0 - rs) / pen_old
            rs = max(0.0, 1.0 - err)
        elif f3 and r.get("detected") and rs == 0:
            rs = 0.0
        rhythm_sum += rs
    extras = [r for r in note_results if r.get("extra")]
    if f1 == "naive":
        charged = len(extras)
    elif f1 == "gated":
        charged = len(gated_extras(note_results, tempo))
    else:
        charged = 0
    denom = n_exp + charged
    pitch = pitch_sum / denom
    rhythm = rhythm_sum / denom
    return {"pitch": pitch, "rhythm": rhythm, "overall": 0.6 * pitch + 0.4 * rhythm, "charged": charged, "extras": len(extras), "n": n_exp}


VARIANTS = {"saved": dict(f1="none", f3=False), "F1 gated": dict(f1="gated", f3=False), "F1 naive": dict(f1="naive", f3=False),
            "F3": dict(f1="none", f3=True), "F1 gated + F3": dict(f1="gated", f3=True)}


def table(df, label):
    lines = [f"### {label} ({len(df)} sessions)\n", "| variant | perfect | great | good | fair | try-again | mean overall | sessions moved down a grade | moved up |", "|---|---|---|---|---|---|---|---|---|"]
    base = df["saved_grade"]
    for v in VARIANTS:
        g = df[f"{v}_grade"]; o = df[f"{v}_overall"]
        counts = g.value_counts()
        down = int((g.map(ORDER.index) < base.map(ORDER.index)).sum()); up = int((g.map(ORDER.index) > base.map(ORDER.index)).sum())
        lines.append(f"| {v} | " + " | ".join(str(int(counts.get(k, 0))) for k in ["perfect", "great", "good", "fair", "try-again"]) + f" | {o.mean():.3f} | {down} | {up} |")
    return "\n".join(lines)


def main():
    rows = json.load(open(ROOT / "takes" / "prod" / "raw" / "session_results.json"))["rows"]
    recs = []
    for r in rows:
        nr = r["note_results"]
        base = rescore(nr, r["tempo"])
        if base is None:
            continue
        rec = {"id": r["id"], "tempo": r["tempo"], "source": r.get("source") or "ear-training", "saved_overall_row": r["overall"] if r["overall"] <= 1 else r["overall"] / 100}
        for v, kw in VARIANTS.items():
            s = rescore(nr, r["tempo"], **kw)
            rec[f"{v}_overall"] = s["overall"]; rec[f"{v}_grade"] = grade(s["overall"]); rec[f"{v}_charged"] = s["charged"]
        rec["extras"] = base["extras"]
        recs.append(rec)
    prod = pd.DataFrame(recs)
    repro = np.abs(prod["saved_overall"] - prod["saved_overall_row"]).max()

    # Firefox takes: same rescoring + the audio metrics
    audio = pd.read_csv(ROOT / "results" / "firefox_own.csv").set_index("take")
    frecs = []
    for p in sorted(glob.glob(str(ROOT / "takes" / "firefox" / "*.json"))):
        d = json.load(open(p)); stem = p.split("/")[-1][:-5]
        nr = d["scoring"]["savedScore"]["noteResults"]; tempo = d["context"]["tempo"]
        base = rescore(nr, tempo)
        if base is None or stem not in audio.index:
            continue
        a = audio.loc[stem]
        rec = {"take": stem, "source": d["context"]["source"], "tempo": tempo, "dtw_precision": a.m3_dtw_precision, "dtw_f1": a.m3_dtw_f1, "m5_precision": a.m5_precision, "m3_hold": a.m3_chroma_hold}
        for v, kw in VARIANTS.items():
            s = rescore(nr, tempo, **kw); rec[f"{v}_overall"] = s["overall"]; rec[f"{v}_grade"] = grade(s["overall"]); rec[f"{v}_charged"] = s["charged"]
        rec["extras"] = base["extras"]
        frecs.append(rec)
    ff = pd.DataFrame(frecs)
    ff.to_csv(ROOT / "results" / "fix_impact_firefox.csv", index=False)

    out = ["# Step 1 — what the scorer fixes do to every saved session\n",
           f"Production `session_results`: {len(prod)} sessions (all ear training, {int(prod.tempo.min())}–{int(prod.tempo.max())} BPM). "
           f"Rescoring the saved pairs reproduces the saved overall to within {repro:.1e}.\n",
           f"Firefox takes: {len(ff)} ({', '.join(f'{k} {v}' for k, v in ff.source.value_counts().items())}), with the audio metrics beside them.\n",
           "F2 (no rhythm credit for a wrong pitch) and F4 (note length) are off by Andy's decision (2026-10-07).\n",
           table(prod, "Production, ear training"),
           "", table(ff[ff.source == "lick-practice"], "Firefox, lick practice"),
           "", table(ff[ff.source == "ear-training"], "Firefox, ear training"), ""]
    # extras statistics
    out.append("### Extras in production\n")
    out.append(f"Sessions with at least one extra: {int((prod.extras > 0).sum())} of {len(prod)}; with a GATED extra: {int((prod['F1 gated_charged'] > 0).sum())}; "
               f"mean extras per session {prod.extras.mean():.2f}, mean gated {prod['F1 gated_charged'].mean():.2f}. "
               f"Perfect sessions losing the grade under F1 gated: {int(((prod.saved_grade == 'perfect') & (prod['F1 gated_grade'] != 'perfect')).sum())} of {int((prod.saved_grade == 'perfect').sum())}; under F1 naive: {int(((prod.saved_grade == 'perfect') & (prod['F1 naive_grade'] != 'perfect')).sum())}.\n")
    # audio cross-check on lick practice
    lp = ff[ff.source == "lick-practice"].copy()
    lp["delta_f1"] = lp["F1 gated_overall"] - lp["saved_overall"]
    charged = lp[lp["F1 gated_charged"] > 0]; clean = lp[lp["F1 gated_charged"] == 0]
    out.append("### Audio cross-check (Firefox lick practice)\n")
    out.append(f"Takes F1 gated charges: {len(charged)} of {len(lp)} (mean drop {-charged.delta_f1.mean():.3f}). Their DTW precision median {charged.dtw_precision.median():.2f} vs {clean.dtw_precision.median():.2f} for uncharged takes; "
               f"frame precision {charged.m5_precision.median():.2f} vs {clean.m5_precision.median():.2f}.\n")
    out.append(f"Spearman(drop under F1 gated, DTW precision) over charged takes: {spearmanr(-charged.delta_f1, charged.dtw_precision)[0]:.2f} (negative = bigger drops where the audio also reads lower).\n")
    sus = charged[(charged.dtw_precision >= 0.9) & (charged.saved_grade == "perfect")]
    out.append(f"Possible false charges — saved perfect, DTW precision ≥ 0.90, yet charged: **{len(sus)}** of {int((charged.saved_grade == 'perfect').sum())} charged perfect takes.\n")
    if len(sus):
        out.append("| take | saved | F1 gated | charged | extras | DTW precision |\n|---|---|---|---|---|---|")
        for _, r in sus.sort_values("delta_f1").head(15).iterrows():
            out.append(f"| {r['take']} | {r.saved_overall:.3f} | {r['F1 gated_overall']:.3f} | {int(r['F1 gated_charged'])} | {int(r.extras)} | {r.dtw_precision:.2f} |")
    # Agreement: does the fix move the score towards the audio?
    for v in ["saved", "F1 gated", "F3", "F1 gated + F3"]:
        out.append(f"\nSpearman({v} overall, DTW F1) on lick practice: {spearmanr(lp[f'{v}_overall'], lp.dtw_f1)[0]:.3f}; with frame coverage hold: {spearmanr(lp[f'{v}_overall'], lp.m3_hold)[0]:.3f}")
    w = lp[lp["take"].str.contains("wail")]
    out.append(f"\n### The Wail session ({len(w)} windows)\n")
    out.append("| variant | mean overall | windows ≥ 0.90 (a pass) | windows ≥ 0.95 |\n|---|---|---|---|")
    for v in VARIANTS:
        out.append(f"| {v} | {w[f'{v}_overall'].mean():.3f} | {int((w[f'{v}_overall'] >= 0.9).sum())} | {int((w[f'{v}_overall'] >= 0.95).sum())} |")
    for sid, label in [("6193df", "Wail (a), analysed 2026-10-06"), ("a3d8e3", "Wail (b)")]:
        r = w[w["take"].str.contains(sid)]
        if len(r):
            r = r.iloc[0]; out.append(f"\n{label}: " + ", ".join(f"{v} {r[f'{v}_overall']:.3f} ({r[f'{v}_grade']})" for v in VARIANTS) + f"; DTW precision {r.dtw_precision:.2f}")
    text = "\n".join(out) + "\n"
    (ROOT / "results" / "fix_impact.md").write_text(text)
    print(text)


if __name__ == "__main__":
    main()
