"""Spectrogram + expected piano roll + f0 track for one take, at the lag the
chroma metric chose. Writes results/inspect-<id>.png and prints a frame table."""
import sys
import numpy as np
import librosa
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from .takes import load_all, ROOT
from .render import render_sampled
from .features import extract, extract_reference, f0_track, FRAME_SECONDS, CQT_MIN_MIDI, CQT_BINS
from .metrics import compare, piano_roll

ids = sys.argv[1:]
for t in load_all(ids):
    tf = extract(t.band, t.sr)
    ry = render_sampled(t.expected, t.sr)
    rf = extract_reference(ry, t.sr, t.expected_length, 0.6, expected=t.expected, tempo=t.tempo)
    res = compare(t, tf, t.expected, ry, rf)
    k = int(round(res["m3_chroma"].lag / FRAME_SECONDS))
    f0 = f0_track(tf)
    roll = piano_roll(t.expected, tf.frames, k)
    tt = np.arange(tf.frames) * FRAME_SECONDS
    C = librosa.amplitude_to_db(np.abs(librosa.cqt(tf.y, sr=tf.sr, hop_length=512, fmin=librosa.midi_to_hz(CQT_MIN_MIDI), n_bins=CQT_BINS, bins_per_octave=12)), ref=np.max)
    fig, ax = plt.subplots(3, 1, figsize=(14, 9), sharex=True, gridspec_kw={"height_ratios": [3, 1, 1]})
    ax[0].imshow(C, aspect="auto", origin="lower", extent=[0, tf.frames * FRAME_SECONDS, CQT_MIN_MIDI - 0.5, CQT_MIN_MIDI + CQT_BINS - 0.5], cmap="magma", vmin=-60)
    ax[0].plot(tt, roll, color="cyan", lw=3, alpha=0.6, label="expected (at chroma lag)")
    ax[0].plot(tt, f0, ".", color="lime", ms=3, label="pyin f0")
    ax[0].set_ylabel("MIDI"); ax[0].legend(loc="upper right")
    ax[0].set_title(f"{t.id}  saved={t.saved_overall}  lag={res['m3_chroma'].lag:.2f}s  m3={res['m3_chroma'].similarity:.2f} dtw={res['m3_chroma_dtw'].similarity:.2f} m5={res['m5_cover'].similarity:.2f} (p={res['m5_cover'].extra['precision']:.2f} r={res['m5_cover'].extra['recall']:.2f})")
    ax[1].plot(tt, tf.energy_db, label="energy dB"); ax[1].axhline(-35, color="r", ls="--"); ax[1].set_ylabel("dB"); ax[1].legend()
    ax[2].plot(tt, tf.onset_env, label="onset strength"); ax[2].plot(np.arange(rf.frames) * FRAME_SECONDS + res["m3_chroma"].lag, rf.onset_env, alpha=0.6, label="ref onset strength (shifted)"); ax[2].legend()
    if t.transport_seconds is not None and t.metronome:
        beat = 60.0 / t.tempo
        raw_stamp = t.transport_seconds - t.capture_trim
        first = (-raw_stamp) % beat
        for a in ax: 
            for b in np.arange(first, t.duration, beat):
                a.axvline(b, color="white", alpha=0.3, lw=0.8)
    fig.savefig(ROOT / "results" / f"inspect-{t.id}.png", dpi=80); plt.close(fig)
    print(f"{t.id}: trim={t.capture_trim:.3f} transportSeconds={t.transport_seconds} metronome={t.metronome} lag={res['m3_chroma'].lag:.2f}")
    print(" frame  t     dB   f0    roll  chromaMax")
    for i in range(0, tf.frames, 3):
        print(f" {i:4d} {tt[i]:5.2f} {tf.energy_db[i]:6.1f} {f0[i]:5.1f} {roll[i]:5.1f}   {int(np.argmax(tf.chroma[:, i])) if tf.sounding[i] else '-'}")
