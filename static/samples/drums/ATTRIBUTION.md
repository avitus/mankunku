# Jazz Drum Kit Samples

**Source:** Virtuosity Drums v0.924 — a Karoryfer Samples / Versilian Studios collaboration
**License:** CC0 1.0 Universal (Public Domain Dedication)
**Repository:** https://github.com/karoryfer/karoryfer-samples (mirror)
**Upstream:** https://www.karoryfer.com/karoryfer-samples

Original recordings captured at 48 kHz / 24-bit FLAC across multiple microphone
positions (close, overhead, room) with multiple velocity layers and round-robin
variants. This app uses three hand-picked hits from the set:

| File         | Source mic | Layer | Notes                                |
| ------------ | ---------- | ----- | ------------------------------------ |
| `kick.ogg`   | kickmic    | vl3   | felt-beater acoustic kick            |
| `ride.ogg`   | overhead   | vl2   | ride cymbal bow stroke, full sustain |
| `hihat.ogg`  | overhead   | vl3   | closed hi-hat                        |

## Encoding

Ogg **Opus**, VBR 128 kbps, 48 kHz, source channel count preserved
(`kick` mono; `ride` and `hihat` stereo overheads).

Re-encoded 2026-08-01. These three files had previously been **Ogg FLAC** —
despite this file claiming Vorbis — and Safari/WebKit cannot decode FLAC-in-Ogg
via `decodeAudioData`, so the drum kit silently failed to load there. smplr then
fell back to `baseUrl("") + name + ".ogg"`, producing the `/kick.ogg` 404s that
made the symptom look like a path bug. Opus is what the other 196 instrument
samples in `static/samples/` already use, and it decodes in every engine the
app supports.

Attack timing was measured before and after: all three shift by < 1 ms, so
nothing about the groove changes. Payload dropped 1,148 KB → 154 KB.

`tests/unit/audio/sample-formats.test.ts` pins the codec invariant for every
file under `static/samples/`; `tests/e2e/audio-sample-decode.spec.ts` proves
real browsers can decode them.
