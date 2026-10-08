"""Import takes from a Firefox profile's IndexedDB copy of `mankunku-audio[:uid]`.

Firefox stores each IndexedDB value as a Snappy-compressed SpiderMonkey
structured clone in `object_data.data`, with Blob payloads as separate
files under `<db>.files/<fileId>` (ids in `object_data.file_ids`). The
record is `{ sessionId, blob, timestamp, metadata }` (audio-store.ts), and
`metadata` is the RecordingMetadata snapshot: phrase, source, key, tempo,
swing, the full saved Score (noteResults carry the expected notes),
detectedNotes, transportSeconds, metronomeEnabled, captureTiming.

Run:  uv run python -m harness.firefox_import <copied idb dir> [--out takes/firefox] [--test N]
The idb dir is a COPY of
  ~/Library/Application Support/Firefox/Profiles/<profile>/storage/default/https+++mankunkujazz.com/idb/
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sqlite3
import struct
import subprocess
from pathlib import Path

import cramjam
import soundfile as sf
import yaml

from .takes import ROOT
from .prod_import import slug, PREARM_DATE

# SpiderMonkey structured clone tags (js/src/vm/StructuredClone.cpp)
SCTAG_FLOAT_MAX = 0xFFF00000
SCTAG_HEADER = 0xFFF10000
SCTAG_NULL = 0xFFFF0000
SCTAG_UNDEFINED = 0xFFFF0001
SCTAG_BOOLEAN = 0xFFFF0002
SCTAG_INT32 = 0xFFFF0003
SCTAG_STRING = 0xFFFF0004
SCTAG_DATE_OBJECT = 0xFFFF0005
SCTAG_ARRAY_OBJECT = 0xFFFF0007
SCTAG_OBJECT_OBJECT = 0xFFFF0008
SCTAG_ARRAY_BUFFER_OBJECT_V2 = 0xFFFF0009
SCTAG_BOOLEAN_OBJECT = 0xFFFF000A
SCTAG_STRING_OBJECT = 0xFFFF000B
SCTAG_NUMBER_OBJECT = 0xFFFF000C
SCTAG_BACK_REFERENCE_OBJECT = 0xFFFF000D
SCTAG_TYPED_ARRAY_OBJECT_V2 = 0xFFFF0010
SCTAG_MAP_OBJECT = 0xFFFF0011
SCTAG_SET_OBJECT = 0xFFFF0012
SCTAG_END_OF_KEYS = 0xFFFF0013
SCTAG_ARRAY_BUFFER_OBJECT = 0xFFFF001F
SCTAG_TYPED_ARRAY_OBJECT = 0xFFFF0020
# DOM tags written by IndexedDB (dom/indexedDB/IDBObjectStore.cpp)
SCTAG_DOM_BLOB = 0xFFFF8001
SCTAG_DOM_FILE = 0xFFFF8002
SCTAG_DOM_FILE_WITHOUT_LASTMODIFIEDDATE = 0xFFFF8003


class Blob:
    def __init__(self, index, size, mime):
        """A Blob/File reference: `index` is its clone tag's data word (its
        position among the record's files), `size` in bytes, `mime` its type."""
        self.index, self.size, self.mime = index, size, mime

    def __repr__(self):
        """Index, MIME type and byte size, for the --test listing."""
        return f"<Blob #{self.index} {self.mime} {self.size}B>"


class Reader:
    def __init__(self, buf: bytes):
        """Cursor at byte 0 of a decompressed clone; `objs` lists the objects
        read so far, in order, for SCTAG_BACK_REFERENCE_OBJECT lookups."""
        self.b = buf
        self.p = 0
        self.objs: list = []

    def pair(self):
        """Read one (data, tag) pair, two little-endian uint32s, and advance 8 bytes."""
        data, tag = struct.unpack_from("<II", self.b, self.p)
        self.p += 8
        return data, tag

    def peek_pair(self):
        """The next (data, tag) pair, without advancing."""
        return struct.unpack_from("<II", self.b, self.p)

    def raw(self, n):
        """The next `n` bytes; the cursor skips past them rounded up to a multiple of 8."""
        out = self.b[self.p:self.p + n]
        self.p += (n + 7) & ~7  # 8-byte alignment
        return out

    def u64(self):
        """Read a little-endian uint64 and advance 8 bytes."""
        v = struct.unpack_from("<Q", self.b, self.p)[0]
        self.p += 8
        return v

    def f64(self):
        """Read a little-endian float64 and advance 8 bytes."""
        v = struct.unpack_from("<d", self.b, self.p)[0]
        self.p += 8
        return v

    def string(self, data):
        """The characters after a string tag whose data word is `data`: the high
        bit set means Latin-1, else UTF-16LE; the low 31 bits are the length in
        characters (so 2 bytes each for UTF-16)."""
        latin1 = bool(data & 0x80000000)
        n = data & 0x7FFFFFFF
        raw = self.raw(n if latin1 else 2 * n)
        return raw.decode("latin-1") if latin1 else raw.decode("utf-16-le")

    def dom_string(self):
        """IDBObjectStore's WriteString: a (length, 0) pair then Latin-1 bytes,
        padded to 8 (seen: 22 bytes of "audio/webm;codecs=opus" + 2 pad)."""
        n, _ = self.pair()
        return self.raw(n).decode("latin-1")

    def value(self):
        """Read one value, recursing into arrays and objects. A tag below
        SCTAG_FLOAT_MAX means the pair itself is a float64; a Date becomes
        {"$date": ms}, a Blob/File a Blob, and ArrayBuffer/typed-array bytes are
        skipped, sizes kept. Array elements with string keys are dropped; an
        unhandled tag (Map, Set, ...) raises ValueError."""
        data, tag = self.pair()
        if tag < SCTAG_FLOAT_MAX:
            self.p -= 8
            return self.f64()
        if tag == SCTAG_NULL or tag == SCTAG_UNDEFINED:
            return None
        if tag == SCTAG_BOOLEAN:
            return bool(data)
        if tag == SCTAG_INT32:
            return data - (1 << 32) if data & 0x80000000 else data
        if tag == SCTAG_STRING:
            return self.string(data)
        if tag == SCTAG_DATE_OBJECT:
            return {"$date": self.f64()}
        if tag == SCTAG_BACK_REFERENCE_OBJECT:
            return self.objs[data]
        if tag in (SCTAG_ARRAY_OBJECT, SCTAG_OBJECT_OBJECT):
            container: dict | list = [] if tag == SCTAG_ARRAY_OBJECT else {}
            self.objs.append(container)
            if tag == SCTAG_ARRAY_OBJECT:
                arr = [None] * data
                while True:
                    kd, kt = self.pair()
                    if kt == SCTAG_END_OF_KEYS:
                        break
                    if kt == SCTAG_INT32:
                        idx = kd
                    elif kt == SCTAG_STRING:
                        idx = self.string(kd)
                    else:
                        raise ValueError(f"array key tag {kt:#x}")
                    v = self.value()
                    if isinstance(idx, int):
                        if idx >= len(arr):
                            arr.extend([None] * (idx + 1 - len(arr)))
                        arr[idx] = v
                container.extend(arr)
                return container
            while True:
                kd, kt = self.pair()
                if kt == SCTAG_END_OF_KEYS:
                    break
                key = self.string(kd) if kt == SCTAG_STRING else (kd if kt == SCTAG_INT32 else None)
                container[key] = self.value()
            return container
        if tag in (SCTAG_DOM_BLOB, SCTAG_DOM_FILE, SCTAG_DOM_FILE_WITHOUT_LASTMODIFIEDDATE):
            size = self.u64()
            mime = self.dom_string()
            if tag == SCTAG_DOM_FILE:
                self.f64()  # lastModified
            if tag in (SCTAG_DOM_FILE, SCTAG_DOM_FILE_WITHOUT_LASTMODIFIEDDATE):
                self.dom_string()  # name
            b = Blob(data, size, mime)
            self.objs.append(b)
            return b
        if tag == SCTAG_ARRAY_BUFFER_OBJECT:
            n = self.u64() if data == 0 else data
            self.objs.append(None)
            return {"$bytes": len(self.raw(n))}
        if tag == SCTAG_TYPED_ARRAY_OBJECT:
            n = self.u64()
            buf = self.value()
            self.u64()  # byteOffset
            self.objs.append(None)
            return {"$typed": data, "n": n, "buf": buf}
        raise ValueError(f"unhandled tag {tag:#x} at {self.p - 8}")


def decode_record(blob: bytes) -> dict:
    """Raw-Snappy-decompress one `object_data.data` value and parse it, skipping
    the clone header pair if present. If the full parse fails, parse only the
    values after the "metadata" and "sessionId" keys and return them with the
    error under "_fallback" (no blob or timestamp); re-raise without "metadata"."""
    raw = bytes(cramjam.snappy.decompress_raw(blob))
    r = Reader(raw)
    d, t = r.peek_pair()
    if t == SCTAG_HEADER:
        r.pair()
    try:
        return r.value()
    except Exception as e:  # fall back: find the `metadata` key and parse from there
        needle = struct.pack("<II", 8 | 0x80000000, SCTAG_STRING) + b"metadata"
        i = raw.find(needle)
        if i < 0:
            raise
        r2 = Reader(raw); r2.p = i + len(needle)
        md = r2.value()
        needle2 = struct.pack("<II", 9 | 0x80000000, SCTAG_STRING) + b"sessionId"
        j = raw.find(needle2)
        sid = None
        if j >= 0:
            r3 = Reader(raw); r3.p = j + ((len(needle2) + 7) & ~7)
            sid = r3.value()
        return {"sessionId": sid, "metadata": md, "_fallback": str(e)}


def load_records(idb_dir: Path):
    """Every object_data row of every *.sqlite in `idb_dir`, opened read-only, as
    {"db": database name, "file": `<db>.files/<first file id>` or None, "rec":
    decoded record}. A row that fails to decode is printed and skipped."""
    out = []
    for db in sorted(idb_dir.glob("*.sqlite")):
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        name = con.execute("select name from database").fetchone()[0]
        files_dir = db.with_suffix(".files")
        for key, file_ids, data in con.execute("select key, file_ids, data from object_data"):
            try:
                rec = decode_record(data)
            except Exception as e:
                print(f"  decode failed in {name}: {e}")
                continue
            fid = (file_ids or "").split()[0] if file_ids else None
            out.append({"db": name, "file": files_dir / fid if fid else None, "rec": rec})
        con.close()
    return out


def convert(idb_dir: Path, out_dir: Path, test: int | None):
    """Write each scorable record to `out_dir` as a 48 kHz mono 16-bit WAV
    (ffmpeg; an existing WAV is kept) plus a diagnostic-export JSON, always as
    tenor sax, and rewrite the harness's takes/truth-firefox.yaml (whatever
    `out_dir`) with the saved hits/total, unverified. Records lacking metadata,
    a saved score with a non-extra note, or their blob file are skipped and
    counted. With `test`, summarise the first `test` records and write nothing."""
    recs = load_records(idb_dir)
    print(f"{len(recs)} records decoded from {idb_dir}")
    if test:
        for r in recs[:test]:
            rec = r["rec"]; md = rec.get("metadata") or {}
            sc = md.get("score") or {}
            print(f"  {r['db'][:30]:30s} sid={str(rec.get('sessionId'))[:12]} ts={rec.get('timestamp')} blob={rec.get('blob')} file={r['file'].name if r['file'] else None} "
                  f"src={md.get('source')} phrase={md.get('phraseName')} key={md.get('key')} tempo={md.get('tempo')} swing={md.get('swing')} "
                  f"overall={sc.get('overall')} notes={len(sc.get('noteResults') or [])} ct={'captureTiming' in md} fb={'_fallback' in rec}")
            if r["file"]:
                print("    ", subprocess.run(["file", "-b", str(r["file"])], capture_output=True, text=True).stdout.strip()[:80])
        return
    out_dir.mkdir(parents=True, exist_ok=True)
    truth_rows, done, skipped = {}, [], {"no_metadata": 0, "no_score": 0, "no_blob": 0}
    for r in recs:
        rec, md = r["rec"], (r["rec"].get("metadata") or None)
        if not md:
            skipped["no_metadata"] += 1; continue
        sc = md.get("score")
        if not sc or not any(not x.get("extra") for x in (sc.get("noteResults") or [])):
            skipped["no_score"] += 1; continue
        if not r["file"] or not r["file"].exists():
            skipped["no_blob"] += 1; continue
        ts = rec.get("timestamp") or 0
        date = dt.datetime.fromtimestamp(ts / 1000, dt.timezone.utc).date()
        sid = str(rec.get("sessionId") or r["file"].name)
        base = f"{date.isoformat()}-{slug(md.get('phraseName') or md.get('phraseId') or 'take')}-{sid[:6]}"
        wav = out_dir / f"{base}.wav"
        if not wav.exists():
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(r["file"]), "-ac", "1", "-ar", "48000",
                            "-acodec", "pcm_s16le", str(wav)], check=True)
        info = sf.info(wav)
        audio = {"duration": info.duration, "sampleRate": info.samplerate}
        if date >= PREARM_DATE:
            audio["captureTrimSeconds"] = 0
        export = {
            "version": 1, "exportedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "recording": {"sessionId": sid, "timestamp": ts, "date": date.isoformat()},
            "context": {
                "phraseId": md.get("phraseId"), "phraseName": md.get("phraseName"), "source": md.get("source") or "ear-training",
                "instrument": {"id": "tenor-sax", "name": "Tenor Saxophone", "key": "Bb"},
                "concertKey": md.get("key"), "tempo": md.get("tempo"), "swing": md.get("swing"),
                "backingTrackUsed": bool(md.get("backingTrackLog")), "metronomeEnabled": md.get("metronomeEnabled"),
                "transportSeconds": md.get("transportSeconds"), "backingBleedOnsets": md.get("backingBleedOnsets"),
                "importedFrom": f"firefox IndexedDB {r['db']}",
            },
            "audio": audio,
            "detection": {"rawWorkletOnsets": [], "resolvedOnsets": [], "segmentedNotes": [], "readings": []},
            "scoring": {"savedDetectedNotes": md.get("detectedNotes") or [], "savedScore": sc},
            "captureTiming": md.get("captureTiming"),
        }
        (out_dir / f"{base}.json").write_text(json.dumps(export, indent=1))
        truth_rows[base] = {"hits": sc.get("notesHit"), "total": sc.get("notesTotal"), "real_extras": 0, "verified": False,
                            "note": f"firefox import: {md.get('source')}, saved {sc.get('overall'):.3f} {sc.get('grade')}, {sc.get('notesHit')}/{sc.get('notesTotal')}"}
        done.append(base)
    tp = ROOT / "takes" / "truth-firefox.yaml"
    tp.write_text("# Takes imported from the Firefox IndexedDB store by harness/firefox_import.py — hits copied from the saved score, unverified.\n"
                  + yaml.safe_dump(truth_rows, sort_keys=True, width=200))
    print(f"converted {len(done)}; skipped {skipped}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("idb_dir")
    ap.add_argument("--out", default=str(ROOT / "takes" / "firefox"))
    ap.add_argument("--test", type=int)
    a = ap.parse_args()
    convert(Path(a.idb_dir), Path(a.out), a.test)
