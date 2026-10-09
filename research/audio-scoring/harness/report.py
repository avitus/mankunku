"""Markdown tables from results/*.csv for REPORT.md.  uv run python -m harness.report"""
import pandas as pd
import numpy as np
from .takes import ROOT
from .metrics import METRIC_NAMES

R = ROOT / "results"
pd.set_option("display.width", 200)


def md(df: pd.DataFrame, floatfmt="{:.3f}") -> str:
    """Markdown table of `df`: floats through `floatfmt`, NaN as an empty cell,
    everything else via str()."""
    cols = list(df.columns)
    out = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for _, r in df.iterrows():
        cells = []
        for c in cols:
            v = r[c]
            if isinstance(v, (float, np.floating)):
                cells.append("" if np.isnan(v) else floatfmt.format(v))
            else:
                cells.append(str(v))
        out.append("| " + " | ".join(cells) + " |")
    return "\n".join(out)


def main():
    """Build results/tables.md from the E1-E3 CSVs in results/ plus E4's when
    e4_summary.csv exists (the only one allowed to be missing), with "2026-"
    dropped from take ids, and print it."""
    parts = []
    e1 = pd.read_csv(R / "e1_summary.csv")
    parts.append("## E1 — discrimination (own lick vs transpositions ±1…±5 st, vs other licks at the take's tempo)\n")
    parts.append(md(e1[["renderer", "metric", "top1_transposed", "mrr_transposed", "margin_transposed", "top1_other", "top1_same_len", "margin_other"]]))
    e2 = pd.read_csv(R / "e2_summary.csv")
    parts.append("\n## E2 — rank agreement with the per-take truth (Spearman; verified takes, timing-known)\n")
    parts.append(md(e2[["renderer", "metric", "spearman_truth", "p_truth", "spearman_saved", "n"]]))
    own = pd.read_csv(R / "e2_own_scores.csv")
    parts.append("\n## Own-lick scores per take (sampled renderer)\n")
    o = own[own.renderer == "sampled"].sort_values("take")
    cols = ["take", "source", "case", "truth", "saved"] + [m for m in METRIC_NAMES if m != "m2_env"] + ["m5_precision", "m5_recall"]
    o2 = o[cols].copy()
    o2["take"] = o2["take"].str.replace("2026-", "", regex=False)
    parts.append(md(o2, "{:.2f}"))
    e3 = pd.read_csv(R / "e3_cases.csv")
    parts.append("\n## E3 — named cases (sampled renderer): value and percentile among clean verified takes\n")
    e3s = e3[e3.renderer == "sampled"].pivot_table(index=["take", "case"], columns="metric", values="percentile_among_clean").reset_index()
    e3s["take"] = e3s["take"].str.replace("2026-", "", regex=False)
    parts.append(md(e3s[["take", "case"] + [m for m in METRIC_NAMES if m in e3s.columns and m != "m2_env"]], "{:.2f}"))
    try:
        e4 = pd.read_csv(R / "e4_summary.csv")
        parts.append("\n## E4 — perturbations of the ten cleanest takes: mean drop (min drop) per metric\n")
        piv = e4.pivot_table(index="metric", columns="perturbation", values="mean").reset_index()
        parts.append(md(piv, "{:.3f}"))
        piv2 = e4.pivot_table(index="metric", columns="perturbation", values="min").reset_index()
        parts.append("\nMinimum drop (worst take):\n")
        parts.append(md(piv2, "{:.3f}"))
    except FileNotFoundError:
        parts.append("\n(E4 not run)")
    (R / "tables.md").write_text("\n".join(parts))
    print("\n".join(parts))


if __name__ == "__main__":
    main()
