"""Sanity checks that every metric must pass before its numbers mean anything."""
import numpy as np
from fractions import Fraction
from .takes import ExpectedNote, Take, expected_note
from .render import render_sampled, render_synthetic, transpose
from .features import extract, extract_reference, FRAME_SECONDS
from .metrics import compare, METRIC_NAMES, piano_roll, precision_masks
from .gate_audio import expected_roll_fn
from .fix_impact import line_end_seconds

sr = 44100
tempo, swing = 100.0, 0.6
line = [expected_note(m, Fraction(i, 4), Fraction(1, 4), tempo, swing) for i, m in enumerate([60, 59, 62, 60])]
ref_y = render_sampled(line, sr)
notated = max(n.onset + n.duration for n in line)

def take_from(y, source="ear-training"):
    """Wrap signal `y` as an octave-strict Take at the module's sr, tempo and
    swing, expecting `line`, with no files or saved score (pre-armed by the
    dataclass default)."""
    return Take(id="self", wav_path=None, json_path=None, audio=y.astype(np.float32), sr=sr, tempo=tempo, swing=swing,
                source=source, octave_insensitive=False, concert_key="C", phrase_id=None, phrase_name=None,
                expected=line, saved_overall=None, saved_notes_hit=None, saved_grade=None)

ok = True
def check(name, cond, detail=""):
    """Print PASS/FAIL for one invariant and fold it into the module-level `ok`."""
    global ok
    print(("PASS" if cond else "FAIL"), name, detail)
    ok &= bool(cond)

# 1. a rendering compared with itself (embedded at 0.8 s in silence) scores ~1 and recovers the lag
pad = np.zeros(int(0.8 * sr), dtype=np.float32)
y = np.concatenate([pad, ref_y, np.zeros(int(0.5 * sr), dtype=np.float32)])
t = take_from(y)
tf = extract(t.band, sr)
rf = extract_reference(ref_y, sr, notated, extension_seconds=0.6)
res = compare(t, tf, line, ref_y, rf)
for m in METRIC_NAMES:
    check(f"self-similarity {m}", res[m].similarity > (0.9 if m.startswith("m5") else 0.85 if m.startswith("m2") else 0.95), f"{res[m].similarity:.3f} lag={res[m].lag:.3f}")
for m in ["m3_chroma", "m4_cqt", "m2_env", "m1_raw"]:
    check(f"lag recovered {m}", abs(res[m].lag - 0.8) <= 2 * FRAME_SECONDS, f"{res[m].lag:.3f}")

# 2. the synthetic rendering of the same line vs the sampled take: pitch metrics high, raw xcorr low
syn = render_synthetic(line, sr)
rf2 = extract_reference(syn, sr, notated, extension_seconds=0.6)
res2 = compare(t, tf, line, syn, rf2)
for m in ["m3_chroma", "m4_cqt", "m5_cover"]:
    check(f"cross-timbre {m}", res2[m].similarity > 0.85, f"{res2[m].similarity:.3f}")
print("INFO cross-timbre m1_raw", f"{res2['m1_raw'].similarity:.3f}")

# 3. a semitone transposition scores lower than itself under every pitch-aware metric
tr = transpose(line, 1)
ref3 = render_sampled(tr, sr)
rf3 = extract_reference(ref3, sr, notated, extension_seconds=0.6)
res3 = compare(t, tf, tr, ref3, rf3)
for m in ["m3_chroma", "m3_chroma_dtw", "m4_cqt", "m4_cqt_dtw", "m5_cover", "m5_cover_strict"]:
    check(f"transposed +1 lower {m}", res3[m].similarity < res[m].similarity - 0.3, f"{res3[m].similarity:.3f} vs {res[m].similarity:.3f}")

# 4. an octave transposition: chroma blind, cqt strict
tr12 = transpose(line, 12)
ref4 = render_sampled(tr12, sr)
rf4 = extract_reference(ref4, sr, notated, extension_seconds=0.6)
res4 = compare(t, tf, tr12, ref4, rf4)
check("octave: m3_chroma stays high", res4["m3_chroma"].similarity > 0.8, f"{res4['m3_chroma'].similarity:.3f}")
check("octave: m4_cqt drops", res4["m4_cqt"].similarity < 0.6, f"{res4['m4_cqt'].similarity:.3f}")
check("octave: m5_cover_strict drops", res4["m5_cover_strict"].similarity < 0.3, f"{res4['m5_cover_strict'].similarity:.3f}")

# 5. an extra note after the line costs under the extension
extra = render_sampled([ExpectedNote(64, 0.0, 0.4, Fraction(0), Fraction(1, 8))], sr)
y5 = y.copy(); s0 = int((0.8 + notated + 0.05) * sr); y5[s0:s0 + len(extra)] += extra
t5 = take_from(y5); tf5 = extract(t5.band, sr)
res5 = compare(t5, tf5, line, ref_y, rf)
check("extra after the line costs m3_chroma", res5["m3_chroma"].similarity < res["m3_chroma"].similarity - 0.05,
      f"{res5['m3_chroma'].similarity:.3f} vs {res['m3_chroma'].similarity:.3f}")
check("extra after the line costs m5 precision", res5["m5_cover"].extra["precision"] < res["m5_cover"].extra["precision"] - 0.05,
      f"{res5['m5_cover'].extra['precision']:.3f} vs {res['m5_cover'].extra['precision']:.3f}")

# 6. M5 precision follows the app's rule (src/lib/scoring/frame-coverage.ts): a frame is precise when
#    ANY note whose [start, end + RELEASE_TOLERANCE] holds it matches its pitch, and only frames from
#    0.25 s before the line to one beat after it count
def frame(s):
    """Frame index of `s` seconds, rounded as piano_roll rounds."""
    return int(round(s / FRAME_SECONDS))

def note(midi, onset, duration):
    """An ExpectedNote at `onset` lasting `duration` seconds (fractions unused by the roll)."""
    return ExpectedNote(midi, onset, duration, Fraction(0), Fraction(1, 8))

roll6 = piano_roll([note(60, 0.0, 0.35), note(62, 0.3, 0.3)], 60, 0)
check("piano roll: where two notes overlap, the later one owns its frames from its onset",
      (roll6[frame(0.3):frame(0.6)] == 62).all(), f"{roll6[frame(0.3) - 1:frame(0.3) + 3]}")

line6 = [expected_note(60, Fraction(0), Fraction(1, 8), 100.0, 0.5),
         expected_note(62, Fraction(1, 8), Fraction(1, 8), 100.0, 0.5)]  # 0-0.3 s, 0.3-0.6 s; the window runs -0.25 to 1.2 s
lag6 = frame(1.0)

def precise_at(pitch, t0, t1):
    """(precise, counted) frames for a take sounding `pitch` only from phrase time t0 to t1 s."""
    f0 = np.full(frame(3.0), np.nan)
    f0[lag6 + frame(t0):lag6 + frame(t1)] = pitch
    p, c = precision_masks(f0, ~np.isnan(f0), line6, lag6, False, 100.0)
    return int(p.sum()), int(c.sum())

r = precise_at(62, 0.3, 0.42)
check("M5 precision: the next note is precise from its own onset", r[0] == r[1] > 0, f"{r}")
r = precise_at(60, 0.3, 0.41)
check("M5 precision: the previous note still sounding in the next note's first 0.12 s is its release, not an extra",
      r[0] == r[1] > 0, f"{r}")
r, r2 = precise_at(62, 0.6, 0.71), precise_at(62, 0.75, 0.9)
check("M5 precision: the last note's pitch is precise for 0.12 s after its end, and not after",
      r[0] == r[1] > 0 and r2[0] == 0 < r2[1], f"{r} {r2}")
r = precise_at(64, 0.8, 1.1)
check("M5 precision: a wrong pitch inside the window counts against it", r[0] == 0 < r[1], f"{r}")
r, r2 = precise_at(64, 1.25, 1.5), precise_at(64, -0.6, -0.3)
check("M5 precision: frames more than one beat after the line or 0.25 s before it are not counted",
      r[1] == 0 and r2[1] == 0, f"{r} {r2}")

# 7. the extras-gate helpers read the line as the shipped scorer does (src/lib/scoring/extras.ts)
eighths = [{"expected": {"pitch": 60, "offset": [0, 1], "duration": [1, 8]}},
           {"expected": {"pitch": 62, "offset": [1, 8], "duration": [1, 8]}}]  # at 100 BPM straight: 0-0.3 s, 0.3-0.6 s
at = expected_roll_fn(eighths, 100.0, 0.5)
check("gate roll: a back-to-back note is the expected pitch from its own onset",
      [at(0.29), at(0.31), at(0.41), at(0.65)] == [60, 62, 62, 62], f"{[at(0.29), at(0.31), at(0.41), at(0.65)]}")
check("gate line end: swing moves an off-beat last note's end, as extras.ts lineEnd does",
      abs(line_end_seconds(eighths, 100.0, 0.6) - (0.6 + 0.5) * 0.6) < 1e-9, f"{line_end_seconds(eighths, 100.0, 0.6):.3f}")
print("ALL PASS" if ok else "SOME FAILED")
