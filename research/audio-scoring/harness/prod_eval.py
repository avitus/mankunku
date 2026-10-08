"""E5 — spread over an imported folder (prod, firefox): every take scored
against its OWN lick only (no candidate sweep), compared with the saved score.

Writes results/<folder>_own.csv and results/<folder>_summary.md.
Run: uv run python -m harness.prod_eval [folder=prod]
"""
from __future__ import annotations

import time

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from .takes import ROOT, load_all, load_truth
from .evaluate import reference, row_from
from .features import extract
from .metrics import compare, METRIC_NAMES

RESULTS = ROOT / "results"
GRADE_ORDER = ["try-again", "fair", "good", "great", "perfect"]


def main(folder: str = "prod"):
    """Score every take in takes/<folder> against its own lick (sampled
    renderer), write results/<folder>_own.csv and results/<folder>_summary.md
    (Spearman vs the saved score and vs notes-hit fraction, medians by saved
    grade, disagreement tables), and print the summary's first 40 lines."""
    takes = load_all(folders=[folder])
    print(f"{len(takes)} {folder} takes")
    rows = []
    t0 = time.time()
    for i, t in enumerate(takes):
        tf = extract(t.band, t.sr)
        ry, rf = reference(t, t.expected, "sampled")
        res = compare(t, tf, t.expected, ry, rf)
        rows.append(row_from(res, take=t.id, renderer="sampled", candidate="own", kind="own", n_notes=len(t.expected),
                             saved=t.saved_overall, grade=t.saved_grade, notes_hit=t.saved_notes_hit,
                             tempo=t.tempo, phrase=t.phrase_name, date=t.id[:10], source=t.source,
                             backing=bool((t.raw.get("context") or {}).get("backingBleedOnsets")),
                             octave_insensitive=t.octave_insensitive))
        if (i + 1) % 25 == 0:
            print(f"  {i+1}/{len(takes)} ({time.time()-t0:.0f}s)", flush=True)
    df = pd.DataFrame(rows)
    df.to_csv(RESULTS / f"{folder}_own.csv", index=False)

    lines = [f"# E5 — {folder} spread (own lick only, sampled renderer)\n", f"{len(df)} takes: " + ", ".join(f"{k} {v}" for k, v in df.source.value_counts().items()) + ".\n"]
    lines.append("## Rank agreement with the saved score\n")
    lines.append("| metric | Spearman vs saved | vs notes_hit/total |\n|---|---|---|")
    df["hit_frac"] = df.notes_hit / df.n_notes
    for m in METRIC_NAMES:
        r1 = spearmanr(df[m], df.saved)[0]; r2 = spearmanr(df[m], df.hit_frac)[0]
        lines.append(f"| {m} | {r1:.3f} | {r2:.3f} |")
    lines.append("\n## Metric by saved grade (median, p10–p90)\n")
    lines.append("| grade | n | m3 | m3 hold | m5 | m5 hold | precision | recall | recall hold |\n|---|---|---|---|---|---|---|---|---|")
    for g in GRADE_ORDER:
        d = df[df.grade == g]
        if not len(d):
            continue
        cells = [f"{d[c].median():.2f} ({d[c].quantile(.1):.2f}–{d[c].quantile(.9):.2f})" for c in ["m3_chroma", "m3_chroma_hold", "m5_cover", "m5_cover_hold", "m5_precision", "m5_recall", "m5_recall_hold"]]
        lines.append(f"| {g} | {len(d)} | " + " | ".join(cells) + " |")
    lines.append("\n## Disagreements\n")
    hi_score_lo_audio = df[(df.saved >= 0.85) & (df.m3_chroma_hold < 0.80)].sort_values("m3_chroma_hold")
    lo_score_hi_audio = df[(df.saved < 0.70) & (df.m3_chroma >= 0.90)].sort_values("saved")
    lines.append(f"Saved ≥ 0.85 (great/perfect) but hold-tolerant chroma < 0.80: **{len(hi_score_lo_audio)}** of {int((df.saved >= 0.85).sum())}\n")
    lines.append("| take | saved | grade | hit | m3 | m3 hold | m3 dtw | m5 hold | precision | recall | recall hold |\n|---|---|---|---|---|---|---|---|---|---|---|")
    for _, r in hi_score_lo_audio.head(25).iterrows():
        lines.append(f"| {r['take']} | {r.saved:.2f} | {r.grade} | {int(r.notes_hit)}/{int(r.n_notes)} | {r.m3_chroma:.2f} | {r.m3_chroma_hold:.2f} | {r.m3_chroma_dtw:.2f} | {r.m5_cover_hold:.2f} | {r.m5_precision:.2f} | {r.m5_recall:.2f} | {r.m5_recall_hold:.2f} |")
    lines.append("\n## Every production take\n")
    lines.append("| take | saved | grade | hit | m3 | m3 hold | m3 dtw | m5 | m5 hold | precision | recall hold |\n|---|---|---|---|---|---|---|---|---|---|---|")
    for _, r in df.sort_values("saved").iterrows():
        lines.append(f"| {r['take']} | {r.saved:.2f} | {r.grade} | {int(r.notes_hit)}/{int(r.n_notes)} | {r.m3_chroma:.2f} | {r.m3_chroma_hold:.2f} | {r.m3_chroma_dtw:.2f} | {r.m5_cover:.2f} | {r.m5_cover_hold:.2f} | {r.m5_precision:.2f} | {r.m5_recall_hold:.2f} |")
    lines.append(f"\nSaved < 0.70 (fair/try-again) but chroma ≥ 0.90: **{len(lo_score_hi_audio)}** of {int((df.saved < 0.70).sum())}\n")
    lines.append("| take | saved | grade | hit | m3 | m3 dtw | m5 | precision | recall |\n|---|---|---|---|---|---|---|---|---|")
    for _, r in lo_score_hi_audio.head(25).iterrows():
        lines.append(f"| {r['take']} | {r.saved:.2f} | {r.grade} | {int(r.notes_hit)}/{int(r.n_notes)} | {r.m3_chroma:.2f} | {r.m3_chroma_dtw:.2f} | {r.m5_cover:.2f} | {r.m5_precision:.2f} | {r.m5_recall:.2f} |")
    (RESULTS / f"{folder}_summary.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines[:40]))


if __name__ == "__main__":
    import sys
    main(sys.argv[1] if len(sys.argv) > 1 else "prod")
