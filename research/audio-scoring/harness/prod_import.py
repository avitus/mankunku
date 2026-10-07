"""Turn production takes into harness takes.

Inputs (a raw directory, default takes/prod/raw/):
  <sessionId>.webm          — objects copied from the `recordings` bucket
                              (`recordings/{userId}/{sessionId}.webm`)
  session_results.json      — rows of public.session_results for the user
                              (id, timestamp, phrase_id, phrase_name, category,
                              key, tempo, pitch_accuracy, rhythm_accuracy,
                              overall, grade, notes_hit, notes_total,
                              note_results, source), as a JSON array
  user_settings.json        — optional, {"swing": 0.62}; default 0.62

Ear-training takes have a row (their sessionId IS the session_results id);
lick-practice takes do not (a random UUID per window, logged only in the
browser) and are skipped as unscorable.

Outputs takes/prod/<date>-<slug>-<id6>.wav (mono, Opus' native 48 kHz) and
.json in the diagnostic-export subset the harness reads, and appends a
truth-prod.yaml row per take (hits = notes_hit, verified: false).

Run:  uv run python -m harness.prod_import [raw_dir] [--limit N] [--since YYYY-MM-DD]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
from pathlib import Path

import soundfile as sf
import yaml

from .takes import ROOT

PREARM_DATE = dt.date(2026, 8, 11)  # exports carry audio.captureTrimSeconds from here on
DEFAULT_SWING = 0.62


def slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:40]


def norm01(v: float | None) -> float | None:
    if v is None:
        return None
    return v / 100.0 if v > 1.0 else v


def convert(raw_dir: Path, out_dir: Path, limit: int | None, since: dt.date | None) -> list[dict]:
    rows = json.loads((raw_dir / "session_results.json").read_text())
    if isinstance(rows, dict):  # `supabase db query -o json` wraps the rows
        rows = rows.get("rows") or rows.get("result") or []
    settings_p = raw_dir / "user_settings.json"
    swing = DEFAULT_SWING
    if settings_p.exists():
        st = json.loads(settings_p.read_text())
        if isinstance(st, dict) and "rows" in st:
            st = st["rows"]
        if isinstance(st, list):
            st = st[0] if st else {}
        swing = float(st.get("swing", DEFAULT_SWING))
    webms = {p.stem: p for p in raw_dir.rglob("*.webm")}  # `storage cp -r` keeps the user folder
    rows = sorted(rows, key=lambda r: r["timestamp"], reverse=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    truth_rows = {}
    done = []
    skipped_no_blob = 0
    for r in rows:
        sid = r["id"]
        if sid not in webms:
            skipped_no_blob += 1
            continue
        date = dt.datetime.fromtimestamp(r["timestamp"] / 1000, dt.timezone.utc).date()
        if since and date < since:
            continue
        nr = r["note_results"] if isinstance(r["note_results"], list) else json.loads(r["note_results"])
        if not any(not x.get("extra") for x in nr):
            continue
        base = f"{date.isoformat()}-{slug(r['phrase_name'])}-{sid[:6]}"
        wav = out_dir / f"{base}.wav"
        if not wav.exists():
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(webms[sid]), "-ac", "1", "-ar", "48000",
                            "-acodec", "pcm_s16le", str(wav)], check=True)
        info = sf.info(wav)
        audio = {"duration": info.duration, "sampleRate": info.samplerate}
        if date >= PREARM_DATE:
            audio["captureTrimSeconds"] = 0  # pre-armed capture; the harness searches lags >= 0 only
        export = {
            "version": 1,
            "exportedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "recording": {"sessionId": sid, "timestamp": r["timestamp"], "date": date.isoformat()},
            "context": {
                "phraseId": r["phrase_id"], "phraseName": r["phrase_name"],
                "source": r.get("source") or "ear-training",
                "instrument": {"id": "tenor-sax", "name": "Tenor Saxophone", "key": "Bb"},
                "concertKey": r["key"], "tempo": r["tempo"], "swing": swing,
                "backingTrackUsed": None, "metronomeEnabled": None, "transportSeconds": None,
                "category": r.get("category"), "importedFrom": "prod session_results + recordings bucket",
            },
            "audio": audio,
            "detection": {"rawWorkletOnsets": [], "resolvedOnsets": [], "segmentedNotes": [], "readings": []},
            "scoring": {
                "savedDetectedNotes": [x["detected"] for x in nr if x.get("detected")],
                "savedScore": {
                    "pitchAccuracy": norm01(r["pitch_accuracy"]), "rhythmAccuracy": norm01(r["rhythm_accuracy"]),
                    "overall": norm01(r["overall"]), "grade": r["grade"], "noteResults": nr,
                    "notesHit": r["notes_hit"], "notesTotal": r["notes_total"], "timing": r.get("timing"),
                },
            },
        }
        (out_dir / f"{base}.json").write_text(json.dumps(export, indent=1))
        truth_rows[base] = {"hits": r["notes_hit"], "total": r["notes_total"], "real_extras": 0, "verified": False,
                            "note": f"prod import: saved {norm01(r['overall']):.3f} {r['grade']}, {r['notes_hit']}/{r['notes_total']}; swing from user_settings"}
        done.append(base)
        if limit and len(done) >= limit:
            break
    tp = ROOT / "takes" / "truth-prod.yaml"
    existing = yaml.safe_load(tp.read_text()) if tp.exists() else {}
    existing = existing or {}
    existing.update(truth_rows)
    tp.write_text("# Production takes imported by harness/prod_import.py — hits copied from the saved score, unverified.\n"
                  + yaml.safe_dump(existing, sort_keys=True, width=200))
    print(f"converted {len(done)} takes; {skipped_no_blob} rows without a blob; "
          f"{len([w for w in webms if w not in {r['id'] for r in rows}])} blobs without a row (lick practice, unscorable)")
    return done


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("raw_dir", nargs="?", default=str(ROOT / "takes" / "prod" / "raw"))
    ap.add_argument("--out", default=str(ROOT / "takes" / "prod"))
    ap.add_argument("--limit", type=int)
    ap.add_argument("--since", type=lambda s: dt.date.fromisoformat(s))
    a = ap.parse_args()
    convert(Path(a.raw_dir), Path(a.out), a.limit, a.since)
