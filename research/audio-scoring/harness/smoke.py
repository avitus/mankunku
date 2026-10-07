import sys, time
import numpy as np
from .takes import load_all
from .render import RENDERERS
from .features import extract, extract_reference
from .metrics import compare, METRIC_NAMES

ids = sys.argv[1:] or ["2026-09-03-tonic-turn-with-leading-tone", "2026-10-03-honeysuckle-rose", "2026-10-06-fats-navarro-wail-a"]
for t in load_all(ids):
    t0 = time.time()
    tf = extract(t.band, t.sr)
    print(f"== {t.id} saved={t.saved_overall} sounding={tf.sounding.mean():.2f} frames={tf.frames} ({time.time()-t0:.1f}s features)")
    for name, render in RENDERERS.items():
        ry = render(t.expected, t.sr)
        rf = extract_reference(ry, t.sr, t.expected_length, 0.6, expected=t.expected, tempo=t.tempo)
        t1 = time.time()
        res = compare(t, tf, t.expected, ry, rf)
        print(f"  [{name:9s}] " + "  ".join(f"{m}={res[m].similarity:.3f}@{res[m].lag:.2f}" for m in METRIC_NAMES) + f"  ({time.time()-t1:.1f}s)")
        print("            m5:", res["m5_cover"].extra, " m2:", res["m2_env"].extra)
