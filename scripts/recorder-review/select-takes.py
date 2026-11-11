"""Refresh the recorder baseline from an account's labeled Firefox export."""
import argparse
import json
from collections import Counter
from itertools import chain
from pathlib import Path
from shutil import copyfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("archive", type=Path, help="Directory containing diagnostic JSON/WAV pairs")
parser.add_argument("account", help="Production account UUID")
parser.add_argument("--additional-archive", type=Path, action="append", default=[],
                    help="Another snapshot of the same account (repeatable, newest first)")
args = parser.parse_args()
corpus = Path(__file__).resolve().parents[2] / "tests/fixtures/recorder-baseline"
manifest = corpus / "takes.json"
best = {}
counts = Counter()
seen = set()

archives = [args.archive, *args.additional_archive]
for archive in archives:
    if not archive.is_dir():
        raise FileNotFoundError(archive)
for path in chain.from_iterable(sorted(archive.glob("*.json")) for archive in archives):
    data = json.loads(path.read_bytes())
    context = data["context"]
    if context.get("importedFrom") != f"firefox IndexedDB mankunku-audio:{args.account}":
        continue
    if context["source"] != "lick-practice" or not path.with_suffix(".wav").is_file():
        continue
    score = data["scoring"]["savedScore"]
    if not score or not score["noteResults"]:
        continue
    session_id = data["recording"]["sessionId"]
    if not session_id:
        raise ValueError(f"Missing session ID in {path.name}")
    if session_id in seen:
        continue
    seen.add(session_id)
    overall = score["overall"]
    if not 0 <= overall <= 1:
        raise ValueError(f"Invalid saved score in {path.name}")
    lick = context["phraseId"].removesuffix("_" + context["concertKey"])
    counts[lick] += 1
    rank = (overall, data["recording"]["timestamp"], path.name)
    if lick not in best or rank > best[lick][0]:
        best[lick] = (rank, path, data)

if not best:
    raise ValueError("No labeled lick-practice takes matched that account")

cases = []
for lick, (_, path, data) in best.items():
    context = data["context"]
    score = data["scoring"]["savedScore"]
    notes = [row["expected"] for row in score["noteResults"] if not row["extra"]]
    notes.sort(key=lambda n: n["offset"][0] / n["offset"][1])
    if len(notes) != score["notesTotal"] or any(n["pitch"] is None for n in notes):
        raise ValueError(f"Incomplete exercise reference in {path.name}")
    cases.append(dict(lickId=lick, name=context["phraseName"], file=path.with_suffix(".wav").name,
                      instrumentId=context["instrument"]["id"], key=context["concertKey"], tempo=context["tempo"], practiceScore=score["overall"],
                      sessionId=data["recording"]["sessionId"], recordedAt=int(data["recording"]["timestamp"]),
                      candidateCount=counts[lick], expected=notes))
cases.sort(key=lambda case: (case["name"], case["lickId"]))
previous = json.loads(manifest.read_bytes()) if manifest.exists() else []
for case in cases:
    copyfile(best[case["lickId"]][1].with_suffix(".wav"), corpus / case["file"])
manifest.write_text(json.dumps(cases, indent=2, ensure_ascii=False) + "\n")
for name in {c["file"] for c in previous} - {c["file"] for c in cases}:
    (corpus / name).unlink(missing_ok=True)
print(f"Selected {len(cases)} licks from {sum(counts.values())} scored takes")
