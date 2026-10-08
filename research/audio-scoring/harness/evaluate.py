"""E1-E4 over every take. Writes results/*.csv and results/*.md.

Run:  uv run python -m harness.evaluate [--renderer sampled|synthetic|both] [--skip-e4]
"""
from __future__ import annotations

import argparse
import sys
import time
from collections import defaultdict

import numpy as np
import pandas as pd
import librosa
from scipy.stats import spearmanr

from .takes import Take, load_all, load_truth, phrase_signature, ROOT
from .render import RENDERERS, retime, transpose, render_sampled
from .features import extract, extract_reference, FRAME_SECONDS
from .metrics import compare, METRIC_NAMES, Result

RESULTS = ROOT / "results"
EXTENSION_BEATS = 1.0  # silent beat after the line in which anything sounded is an extra
TRANSPOSITIONS = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]
PITCH_METRICS = ["m3_chroma", "m3_chroma_dtw", "m4_cqt", "m4_cqt_dtw", "m5_cover", "m5_cover_strict"]


def truth_score(tr: dict) -> float:
    """hits / (total + real_extras) for one truth.yaml entry: extras count as
    zeros, pitch only; a missing `real_extras` counts as 0."""
    return tr["hits"] / (tr["total"] + tr.get("real_extras", 0))


def reference(take: Take, expected, renderer: str):
    """(audio, features) of `expected` rendered by `renderer` at the take's
    sample rate. The features score the notated span plus EXTENSION_BEATS of
    silence at the take's tempo, so anything the take sounds there is an extra."""
    ry = RENDERERS[renderer](expected, take.sr)
    notated = max(n.onset + n.duration for n in expected)
    rf = extract_reference(ry, take.sr, notated, extension_seconds=EXTENSION_BEATS * 60.0 / take.tempo,
                           expected=expected, tempo=take.tempo)
    return ry, rf


def row_from(res: dict[str, Result], **meta) -> dict:
    """One metrics.csv row: `meta`, then each metric's similarity and lag
    (seconds), plus M5 precision/recall/recall_hold and M2's peak counts."""
    row = dict(meta)
    for m in METRIC_NAMES:
        row[m] = res[m].similarity
        row[m + "_lag"] = res[m].lag
    row["m5_precision"] = res["m5_cover"].extra["precision"]
    row["m5_recall"] = res["m5_cover"].extra["recall"]
    row["m5_recall_hold"] = res["m5_cover"].extra["recall_hold"]
    row["m2_take_peaks"] = res["m2_env"].extra["take_peaks"]
    row["m2_ref_peaks"] = res["m2_env"].extra["ref_peaks"]
    return row


def run(renderers: list[str], skip_e4: bool, only: list[str] | None, from_csv: bool = False):
    """Score every corpus/downloads/prod take (or the `only` ids), per renderer,
    against its own line, the line transposed by each of TRANSPOSITIONS, and
    every other distinct phrase retimed to the take's tempo and swing; write
    results/metrics.csv, then post-process. `from_csv` reuses that CSV instead."""
    truth = load_truth()
    takes = load_all(only, folders=["corpus", "downloads", "prod"])
    if from_csv:
        df = pd.read_csv(RESULTS / "metrics.csv")
        return postprocess(df, takes, truth, skip_e4)
    # distinct phrases across the set, named by the first take carrying them
    phrases: dict[tuple, tuple[str, list]] = {}
    for t in takes:
        sig = phrase_signature(t)
        phrases.setdefault(sig, (t.id, t.expected))
    print(f"{len(takes)} takes, {len(phrases)} distinct phrases, renderers={renderers}")

    rows = []
    feats = {}
    t_start = time.time()
    for i, t in enumerate(takes):
        tf = extract(t.band, t.sr)
        feats[t.id] = tf
        for renderer in renderers:
            # own
            ry, rf = reference(t, t.expected, renderer)
            res = compare(t, tf, t.expected, ry, rf)
            rows.append(row_from(res, take=t.id, renderer=renderer, candidate="own", kind="own", n_notes=len(t.expected)))
            # transpositions of own
            for st in TRANSPOSITIONS:
                exp = transpose(t.expected, st)
                ry, rf = reference(t, exp, renderer)
                res = compare(t, tf, exp, ry, rf)
                rows.append(row_from(res, take=t.id, renderer=renderer, candidate=f"own{st:+d}", kind="transposed", n_notes=len(exp)))
            # other licks at this take's tempo/swing
            own_sig = phrase_signature(t)
            for sig, (name, exp0) in phrases.items():
                if sig == own_sig:
                    continue
                exp = retime(exp0, t.tempo, t.swing)
                ry, rf = reference(t, exp, renderer)
                res = compare(t, tf, exp, ry, rf)
                rows.append(row_from(res, take=t.id, renderer=renderer, candidate=name, kind="other", n_notes=len(exp)))
        print(f"  [{i+1:2d}/{len(takes)}] {t.id} ({time.time()-t_start:.0f}s)", flush=True)
    df = pd.DataFrame(rows)
    df.to_csv(RESULTS / "metrics.csv", index=False)
    postprocess(df, takes, truth, skip_e4)


def postprocess(df, takes, truth, skip_e4):
    """E1-E3 from the metrics table, then E4 unless `skip_e4`. E1 ranks the own
    line against transpositions, other licks and other licks within one note
    of its length (ties rank against it); E2 and E3 use verified, timing-known
    takes only. Writes the e1/e2/e3 CSVs under results/."""
    t_start = time.time()
    # ---------------- E1 discrimination ----------------
    e1 = []
    for (take_id, renderer), g in df.groupby(["take", "renderer"]):
        own = g[g.kind == "own"].iloc[0]
        n_own = int(own.n_notes)
        for m in METRIC_NAMES:
            tr = g[g.kind == "transposed"][m]
            ot = g[g.kind == "other"][m]
            same_len = g[(g.kind == "other") & (g.n_notes.between(n_own - 1, n_own + 1))][m]
            e1.append({
                "take": take_id, "renderer": renderer, "metric": m, "own": own[m],
                "best_transposed": tr.max(), "rank_vs_transposed": int((tr >= own[m]).sum()) + 1,
                "best_other": ot.max(), "rank_vs_other": int((ot >= own[m]).sum()) + 1,
                "best_same_len": same_len.max() if len(same_len) else np.nan,
                "rank_vs_same_len": (int((same_len >= own[m]).sum()) + 1) if len(same_len) else np.nan,
                "n_same_len": len(same_len),
            })
    e1 = pd.DataFrame(e1)
    e1.to_csv(RESULTS / "e1_discrimination.csv", index=False)
    e1s = e1.groupby(["renderer", "metric"]).agg(
        top1_transposed=("rank_vs_transposed", lambda r: (r == 1).mean()),
        top1_other=("rank_vs_other", lambda r: (r == 1).mean()),
        top1_same_len=("rank_vs_same_len", lambda r: (r.dropna() == 1).mean()),
        mrr_transposed=("rank_vs_transposed", lambda r: (1 / r).mean()),
        margin_transposed=("own", "mean"),
    ).reset_index()
    e1m = e1.assign(margin=e1.own - e1.best_transposed, margin_other=e1.own - e1.best_other).groupby(["renderer", "metric"]).agg(
        margin_transposed=("margin", "mean"), margin_other=("margin_other", "mean")).reset_index()
    e1s = e1s.drop(columns=["margin_transposed"]).merge(e1m, on=["renderer", "metric"])
    e1s.to_csv(RESULTS / "e1_summary.csv", index=False)

    # ---------------- E2 truth agreement ----------------
    own = df[df.kind == "own"].copy()
    own["truth"] = own["take"].map(lambda k: truth_score(truth[k]) if k in truth else np.nan)
    own["verified"] = own["take"].map(lambda k: bool(truth.get(k, {}).get("verified", False)))
    own["case"] = own["take"].map(lambda k: truth.get(k, {}).get("case", "clean"))
    bytake = {t.id: t for t in takes}
    own["saved"] = own["take"].map(lambda k: bytake[k].saved_overall)
    own["timing_assumed"] = own["take"].map(lambda k: bytake[k].timing_assumed)
    own["source"] = own["take"].map(lambda k: bytake[k].source)
    own.to_csv(RESULTS / "e2_own_scores.csv", index=False)
    e2 = []
    for renderer, g in own[own.verified & ~own.timing_assumed].groupby("renderer"):
        for m in METRIC_NAMES:
            rho_t, p_t = spearmanr(g[m], g.truth)
            rho_s, p_s = spearmanr(g[m], g.saved.fillna(g.saved.mean()))
            e2.append({"renderer": renderer, "metric": m, "spearman_truth": rho_t, "p_truth": p_t,
                       "spearman_saved": rho_s, "p_saved": p_s, "n": len(g)})
    e2 = pd.DataFrame(e2)
    e2.to_csv(RESULTS / "e2_summary.csv", index=False)

    # ---------------- E3 named cases ----------------
    e3 = []
    for renderer, g in own[own.verified & ~own.timing_assumed].groupby("renderer"):
        clean = g[g.case == "clean"]
        for m in METRIC_NAMES:
            cmin, c10, cmed = clean[m].min(), clean[m].quantile(0.10), clean[m].median()
            for _, r in g[g.case != "clean"].iterrows():
                pct = (clean[m] < r[m]).mean()
                e3.append({"renderer": renderer, "metric": m, "take": r["take"], "case": r.case, "value": r[m],
                           "clean_min": cmin, "clean_p10": c10, "clean_median": cmed, "percentile_among_clean": pct,
                           "ok": (pct >= 0.10) if r.case == "butchered" else (pct < 0.10)})
    e3 = pd.DataFrame(e3)
    e3.to_csv(RESULTS / "e3_cases.csv", index=False)

    if not skip_e4:
        run_e4(takes, own, truth)
    print(f"done in {time.time()-t_start:.0f}s")


def run_e4(takes, own, truth):
    """Perturb the ten cleanest takes and measure each metric's drop."""
    from .metrics import compare
    feats = {}
    g = own[(own.renderer == "sampled") & own.verified & ~own.timing_assumed & (own.case == "clean")]
    picks = g.sort_values("m3_chroma", ascending=False).head(10)["take"].tolist()
    bytake = {t.id: t for t in takes}
    rows = []
    rng = np.random.default_rng(7)
    for tid in picks:
        t = bytake[tid]
        feats[tid] = extract(t.band, t.sr)
        base_res = compare(t, feats[tid], t.expected, *reference(t, t.expected, "sampled"))
        lag = base_res["m3_chroma"].lag
        y0 = t.audio.copy()
        sr = t.sr
        spans = [(int((lag + n.onset) * sr), int((lag + n.onset + n.duration) * sr), n) for n in t.expected]
        spans = [(a, min(b, len(y0)), n) for a, b, n in spans if a < len(y0)]
        mid = spans[len(spans) // 2]
        variants = {}
        # 1. one note a semitone sharp
        y = y0.copy(); a, b, _ = mid
        seg = librosa.effects.pitch_shift(y[a:b], sr=sr, n_steps=1)
        y[a:b] = seg[: b - a]; variants["pitch+1st"] = y
        # 2. one note silenced
        y = y0.copy(); y[a:b] = 0; variants["note_dropped"] = y
        # 3. one note delayed 150 ms
        y = y0.copy(); d = int(0.15 * sr); seg = y0[a:b].copy(); y[a:a + d] = 0
        e = min(len(y), b + d); y[a + d:e] = seg[: e - a - d]; variants["note_late150ms"] = y
        # 4. an extra note after the line (a sampled note, 0.4 s, a major third above the last note)
        y = y0.copy(); last = spans[-1]; p = last[2].midi + 4
        from .takes import ExpectedNote
        from fractions import Fraction
        extra = render_sampled([ExpectedNote(p, 0.0, 0.4, Fraction(0), Fraction(1, 8))], sr)
        s0 = min(len(y) - len(extra), last[1] + int(0.05 * sr))
        if s0 > 0:
            y[s0:s0 + len(extra)] += extra * (np.abs(y0[last[0]:last[1]]).max() / 0.5)
            variants["extra_after"] = y
        # 5. an extra note inside the line (over the middle note's second half: a fumble)
        y = y0.copy(); half = (a + b) // 2
        extra2 = render_sampled([ExpectedNote(mid[2].midi + 3, 0.0, (b - half) / sr, Fraction(0), Fraction(1, 8))], sr)
        y[half:half + len(extra2)] = extra2[: len(y) - half] * (np.abs(y0[a:b]).max() / 0.5)
        variants["extra_inside"] = y
        # 6. time-stretch ±5 %
        variants["stretch+5%"] = librosa.effects.time_stretch(y0, rate=1 / 1.05)
        variants["stretch-5%"] = librosa.effects.time_stretch(y0, rate=1 / 0.95)
        for name, y in variants.items():
            t2 = Take(**{**t.__dict__, "audio": y.astype(np.float32), "raw": {}})
            tf2 = extract(t2.band, sr)
            res = compare(t2, tf2, t.expected, *reference(t, t.expected, "sampled"))
            for m in METRIC_NAMES:
                rows.append({"take": tid, "perturbation": name, "metric": m, "clean": base_res[m].similarity,
                             "perturbed": res[m].similarity, "drop": base_res[m].similarity - res[m].similarity})
        print(f"  E4 {tid}", flush=True)
    e4 = pd.DataFrame(rows)
    e4.to_csv(RESULTS / "e4_perturbations.csv", index=False)
    e4s = e4.groupby(["metric", "perturbation"]).drop.agg(["mean", "min"]).reset_index()
    e4s.to_csv(RESULTS / "e4_summary.csv", index=False)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--renderer", default="both")
    ap.add_argument("--skip-e4", action="store_true")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--from-csv", action="store_true", help="skip the compute loop, post-process results/metrics.csv")
    a = ap.parse_args()
    rs = ["sampled", "synthetic"] if a.renderer == "both" else [a.renderer]
    run(rs, a.skip_e4, a.only, a.from_csv)
