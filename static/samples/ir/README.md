# Room impulse response

`room.ogg` — a synthesized small-room IR for the backing-track ambience send
(`ROOM_IR_URL` in `src/lib/audio/backing-mix.ts`). Stereo, 48 kHz, 0.45 s,
T60 ≈ 0.32 s, Ogg Opus 96k (same fetch + `decodeAudioData` path as the drum
samples; the codec pin in `tests/unit/audio/sample-formats.test.ts` covers it).

**License:** synthesized from seeded noise for this project — no source
recording, public domain (CC0).

Synthesized rather than sampled so provenance is a seed, not a license: six
asymmetric early-reflection taps (offsets 5.2–23.5 ms on top of a 4 ms
pre-delay, so 9–28 ms absolute) over decorrelated
exponentially-decaying Gaussian noise (T60 0.32 s), one-pole low-pass at
5.5 kHz (air/wall absorption) and high-pass at 150 Hz (low-end reverb reads
as mud), peak-normalized to −6 dBFS. `ConvolverNode.normalize` (default true)
rescales by IR energy at load, so the absolute level here only affects
headroom, not the mix — room level lives in `ROOM_SENDS` / `ROOM_RETURN_GAIN`.

Regeneration recipe (deterministic, seed 20260806):

```python
import numpy as np, wave

SR = 48000; N = int(SR * 0.45)
rng = np.random.default_rng(20260806)

def lp(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR); y = np.empty_like(x); acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc; y[i] = acc
    return y

t = np.arange(N) / SR
env = np.exp(-6.91 * t / 0.32)
channels = []
for ch in range(2):
    tail = rng.standard_normal(N) * env
    tail = lp(tail, 5500.0); tail = tail - lp(tail, 150.0)  # hp via lp
    x = np.zeros(N)
    taps = [(5.2, 0.7), (7.9, 0.55), (11.3, 0.5), (14.1, 0.4), (17.8, 0.32), (23.5, 0.25)]
    for k, (ms, amp) in enumerate(taps):
        w = amp * (1.0 if (k % 2 == ch) else 0.6)
        x[int((ms + 4.0) / 1000 * SR)] += w * (1 if rng.random() < 0.5 else -1)
    x = lp(x, 6500.0)
    tail[: int(0.004 * SR)] = 0.0
    channels.append(x + 0.8 * tail)

stereo = np.stack(channels, axis=1)
stereo *= (10 ** (-6 / 20)) / np.max(np.abs(stereo))
with wave.open('room.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(np.clip(stereo * 32767, -32768, 32767).astype('<i2').tobytes())
```

```bash
ffmpeg -i room.wav -c:a libopus -b:a 96k -vbr on room.ogg
```

Note the per-channel `rng` consumption order (tail noise, then tap signs) is
part of the recipe — reordering draws changes the file.
