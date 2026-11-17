# Shared mixer reference and verification

The 2026-11-17 mixer makes every page use the tune backing reference, separates
listening volume from recording balance, and keeps musical velocity independent
of volume faders. `reference-before.json` was captured from commit
`ec15dba091b7bee16663d8814ca620dddea78cb8` before the implementation changed.

## Reference method

Run `npm run test:sandbox -- diagnostics audio-mixer-reference --project=chromium`.
The diagnostic bundles production audio modules, fetches the actual instrument
samples and room impulse, and renders at 44.1 kHz in Linux Chromium. It measures
both channels over the entire render (including silence and release). RMS is
an electrical reference, not LUFS or a claim that different timbres sound equally
loud. The committed golden 140 BPM event fixture fixes attacks and velocities.

The original 9.5-second piano band at lab defaults measured -11.46 dBFS peak and
-35.32 dBFS RMS. The organ band measured -11.83 / -35.49. The tune output reference
was 4 rather than the lab's 1.995; adopting the tune reference adds 6.04 dB to these
lab measurements. Original exports all peaked at approximately -1 dBFS because
normalization erased their absolute levels. Melody references use four F4 notes
at MIDI velocities 60, 88, 110, 88 over eight seconds; they preserve the existing
instrument calibrations, rather than normalizing each note or instrument anew.

After implementation, `reference-after.json` records piano band -5.47 / -29.25
and organ band -5.84 / -29.43 dBFS peak/RMS. The small deviations from an exact
+6.04 dB shift reflect moving drum trims out of quantized MIDI velocity. Melody
RMS differences are below 0.001 dB. Reference band peaks remain over 4 dB below
the output ceiling, and exported PCM matches raw levels within 16-bit rounding.

## Gain ownership

```text
Melody samples → explicit calibration/expression → Melody ─┐
Synth clicks → fixed 0.6 trim → Click ─────────────────────┤
Cross-stick count-off → fixed calibration → Click ────────┤
                                                        Program ──→ Recording
Bass / keyboard / drum voices → instrument faders ─┐     │
Post-pan sends → Room ─────────────────────────────┤     │
                   fixed 0.6 drive → compressor → Backing┘
                                                        │
Recorded media ──────────────────────────────────────────┤
                                    sample ceiling → Master → Speakers
Microphone → fixed 0.4 trim ────────────────────────────→ Recording
```

There is no microphone-to-speaker connection. Replay does not enter Program.
Recordings tap Program before listening Master: reducing the listening volume
or using Master mute does not rebalance the saved microphone/accompaniment mix.
The separate microphone-only scoring capture on `dev` retains its native-clock
start time and bypasses these listening gains. Melody balance remains device-local:
account hydration preserves it, and changing it alone sends no cloud patch.
Old recordings retain their baked-in mix; the shared Master applies on replay.
The former Progress replay attenuation of 0.25 is removed. Native media controls
can still attenuate or mute their own element; their default is unity.

| Stage | Reference / behavior |
| --- | --- |
| Main faders | Master 0.8, Melody 1, Click 0.5, Backing 0.6, stored as amplitudes |
| Control travel | 60 dB logarithmic span; bottom is exact mute; readouts are dB |
| Advanced faders | Same taper; maximum amplitude 3 (+9.54 dB), unity explicitly marked |
| Sample channels | Explicit smplr volume 127; former `(100/127)²` moved into named calibration |
| Soundfont channels | Explicit extraGain 1; historical factor 5 moved into named calibration |
| Bass | Existing bank-qualified 7.74 compensation and instrument trim 0.05 retained |
| Keyboard | Piano trim 0.1; organ factor 2.18 and measured style corrections retained |
| Drum voices | Historical fixed velocity trims squared into amplitude calibration; faders no longer change velocity/layers |
| Band | Fixed compressor drive 0.6, followed by `4 × Backing / 0.6` on every surface |
| Count-off | Independent cross-stick channel through Click; band/instrument mutes cannot silence it |
| Output | Latency-free -1 dBFS sample ceiling before listening Master; not a true-peak limiter |
| WAV | Same band graph and ceiling, before listening Master; no peak normalization |

The ceiling is a last-resort hard sample clamp, not automatic gain control. Dense
or heavily boosted mixes can still distort when the ceiling engages. Ordinary
reference renders must leave it inactive. No compressor is added to the melody.

## Compatibility

Existing main settings remain amplitudes; changing the UI taper never reinterprets
saved values as knob positions. Melody is a new device-local preference. Advanced
mixes migrate once from `backing-mix-levels-v2` to `backing-mix-levels-v3`: drum voice
faders are squared, and the retired band Master is folded into the three instrument
faders. Values are bounded at 3 and mutes remain zero. The v2 entry is retained.

Migration preserves the former unclipped amplitude relationships, but cannot
reproduce velocity saturation or compression at every legacy setting. Folding the
old Master into instrument levels changes compressor drive for non-unity legacy
Master values. The shared reference deliberately raises ordinary practice and the
lab to the former tune level. Saved feedback remains readable with optional legacy
Master metadata; it is historical evidence, not a promise of bit-identical replay
through the new engine.

## Verification

`audio-mixer.spec.ts` measures real rendered PCM for separate recording/listening
routing, saved Master mute, replay, output protection, linear drum faders, independent
count-off, and unnormalized WAV output. The settings and mixer browser tests check
keyboard interaction, dB readouts, persistence, mute/restore, and live bus changes.
Unit coverage retains transport cancellation and retry continuity, sample readiness,
keyboard calibration, migration, and archived feedback validation.

Linux browser checks do not establish native Safari, hardware output, or acoustic
microphone parity. A listening pass on the target device remains useful before
release; no automated test plays sound on the developer's desktop.

### Recorded verification runs

- Native reference: before `fad1a0ca-f41d-42a0-b19a-8e78fdef4116`; after
  `a2187490-e2a2-448a-b2db-f35dafbf3448`. Measurements are committed beside this guide.
- Audio unit sweep: 192 files exercised; updated gain/routing expectations were
  then verified in focused follow-ups, including transport continuity and count-in.
  The existing transport-loop expected failure remains unchanged.
- Settings, ear-training audio and tune/lick playback: 39 Chromium tests passed
  in `b1b55d39-65d6-4570-9748-58f173efb00f`.
- Backing lab and Listening Studio controls: 12 Chromium tests passed in
  `e9a02ec1-1e20-41d5-9679-a5e07f9ca451`.
- Final PCM and replay: eight Chromium/WebKit tests passed without retries in
  `067eb243-8acf-42c7-8b5a-04aebb7a4e86`. Firefox's three offline PCM tests also
  passed; its existing Linux real-time-audio limitation excludes media replay.
- Regression sensitivity: a disposable snapshot first passed all four PCM tests.
  Forcing Master to unity, ignoring drum faders, fixing the backing output, and
  replacing the dB taper/clamp then failed all four PCM tests and all three policy
  tests. These mutations were confined to the disposable container.

The WebKit replay regression is specifically covered: temporarily muting a media
element while its source is constructed can leave its Web Audio output silent.
The action now pauses and restores the original mute state **before** creating the
source, connects it once, then starts playback. Tests wait for media progress and
check startup mute, unmute, half amplitude, and re-mute. Type checking completed
with no errors or warnings. All browser playback ran in Linux sandboxes.

Integration onto `dev` retained separate scoring capture, per-field cloud sync,
and the retired arrangement selector. The six affected unit suites passed in
`8f477260-692d-4771-bad9-98b07dd13b61`; the added device-local melody regression
passed in `eb460ee7-665b-4757-8408-95ced6c3b178`. PCM and ear-training browser
checks passed in `75e71bd3-1ae7-4599-b4e8-06dd8f4d9551`. The cloud dial assertion
was corrected for its first step snapping to the 1% grid, then both cloud-sync
scenarios passed in Chromium and WebKit in `c3bd5c12-508d-4582-ad03-5111c4199c8f`.
The integrated source also passed type checking with no errors or warnings.
