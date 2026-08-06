# Jazz Drum Kit Samples

**Source:** Virtuosity Drums v0.924 — a Karoryfer Samples / Versilian Studios collaboration
**License:** CC0 1.0 Universal (Public Domain Dedication)
**Repository:** https://github.com/sfzinstruments/virtuosity_drums
**Upstream:** https://www.karoryfer.com/karoryfer-samples

Original recordings captured at 48 kHz / 24-bit FLAC across multiple microphone
positions (close, overhead, room) with multiple velocity layers and round-robin
variants. This app uses hand-picked hits from the set:

| File               | Source file (repo path)                          | Role                            |
| ------------------ | ------------------------------------------------ | ------------------------------- |
| `kick.ogg`         | kickmic, vl3 (2026-08-01 pick, re-normalized)    | felt-beater acoustic kick       |
| `ride.ogg`         | overhead, vl2 (2026-08-01 pick, re-normalized)   | ride bow stroke — **med** layer |
| `ride_soft.ogg`    | `Samples/oh/ride/oh_ride_ride_vl1_rr1.flac`      | ride bow — **soft** layer       |
| `ride_acc.ogg`     | `Samples/oh/ride/oh_ride_ride_vl3_rr1.flac`      | ride bow — **accent** layer     |
| `ride_bell.ogg`    | `Samples/oh/ride/oh_ride_bell_vl2_rr1.flac`      | ride bell accent                |
| `hihat.ogg`        | overhead, vl3 (2026-08-01 pick, re-normalized)   | closed hi-hat (stick)           |
| `hihat_pedal.ogg`  | `Samples/oh/hh/oh_hh_pedal_vl2_rr1.flac`         | hi-hat foot chick               |
| `snare_ghost.ogg`  | `Samples/oh/snare/oh_snare_center_vl8.flac`      | snare center — **ghost** layer  |
| `snare_med.ogg`    | `Samples/oh/snare/oh_snare_center_vl20.flac`     | snare center — **med** layer    |
| `snare_acc.ogg`    | `Samples/oh/snare/oh_snare_center_vl31.flac`     | snare center — **accent** layer |
| `crossstick.ogg`   | `Samples/oh/snare/oh_snare_crossstick_vl10.flac` | cross-stick                     |
| `crash.ogg`        | `Samples/oh/crash/oh_crash_crash_vl1_rr1.flac`   | crash — **soft** layer, decay shortened |

The library has no brush articulations (sticks only), so the ballad style will
use low-velocity snare + cross-stick instead of the originally planned brushes.

## Encoding & normalization (2026-08-04)

Ogg **Opus**, VBR 128 kbps, 48 kHz, source channel count preserved. Every file
(including the original three) is **peak-normalized to −3 dBFS** with trailing
silence trimmed at −70 dBFS:

```bash
ffmpeg -i <src> -af "volume=<gain>dB,areverse,silenceremove=start_periods=1:start_threshold=-70dB,areverse" \
  -c:a libopus -b:a 128k -vbr on <out>.ogg
```

Rationale: the raw library files sit 7–29 dB below full scale (ride vl1 at
−29 dBFS), which is why the old `BACKING_BASE_TRIMS` needed ×3 velocity
multipliers that clipped the top half of the velocity range against the [0, 1]
clamp — "the kit is quiet even at max velocity" was an asset problem. With flat
−3 dBFS assets, velocity (times modest trims) is the only level control and the
whole musical range is audible. The trims in `backing-mix.ts` re-express the
ear-tuned 2026-08-02 balance against the new levels.

Opus is what the other instrument samples in `static/samples/` already use, and
it decodes in every engine the app supports (the three original files were once
Ogg FLAC, which Safari/WebKit cannot decode — see git history).

## Crash exception (2026-08-06)

Peak normalization is blind to sustain: the original vl2 crash kept its full
11.8 s natural decay, and with its body peak-normalized like every short hit it
sat ~18 dB above the ride bed for bars on end — the one jarring element in the
Milestone B listening pass. `crash.ogg` is now the **vl1 soft-stroke** hit with
the decay shortened to ~3.1 s before normalization:

```bash
ffmpeg -i oh_crash_crash_vl1_rr1.flac \
  -af "atrim=0:3.2,afade=t=out:st=1.0:d=2.2:curve=tri,volume=25.2dB,areverse,silenceremove=start_periods=1:start_threshold=-70dB,areverse" \
  -c:a libopus -b:a 128k -vbr on crash.ogg
```

The linear (`tri`) fade multiplied onto the cymbal's own exponential decay
gives a smooth, accelerating dB slope (measured ≈ −16 → −68 dB RMS across the
shipped 3.1 s, no cliff, ending just above the −70 dB silenceremove floor);
`curve=exp` was auditioned and rejected — it collapses 43 dB in 400 ms.
The remaining level correction lives in `BACKING_BASE_TRIMS.crash` (ear-tuned
at Milestone B), not the asset.

`tests/unit/audio/sample-formats.test.ts` pins the codec invariant for every
file under `static/samples/`; `tests/e2e/audio-sample-decode.spec.ts` proves
real browsers can decode them.
