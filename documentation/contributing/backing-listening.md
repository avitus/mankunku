# Backing-track listening protocol

The backing-track upgrade program ("professional session musicians") is verified two ways:

1. **Automated musicality guards** — property tests over the seeded generator plus two
   committed artifacts that force every engine PR to show its musical diff:
   - `documentation/reference/backing-report.txt` — statistics report; regenerate with
     `npm run backing:report`, review the diff, commit it. A drifted report fails
     `tests/unit/audio/backing-report.test.ts`.
   - `tests/fixtures/backing/golden-*.json` — full event dumps for six fixed
     (preset, style, tempo) cases: three swing (the mixer loop at 140, blues and AABA
     at 160) and one per other style — bossa nova (blues, 130), ballad (AABA, 72),
     straight (blues, 140). Non-swing fixtures carry the style in the filename
     (`golden-lab-aaba-c-ballad-72.json`). Regenerate with `npm run backing:golden`; a
     drifted engine fails `tests/unit/audio/backing-golden.test.ts`.
2. **Human listening milestones** — the part no test can do. The program gates on three
   listening passes (A: after tempo-dependent swing; B: after the full-band vocabulary
   and intensity arc; C: final, all styles). Individual PRs between milestones rely on
   the automated guards.

## The lab

`/diagnostics/backing-mixer` is the listening lab:

- **Progression presets**: ii-V-I-VI loop, 12-bar F blues, rhythm-changes A, and a
  3-chorus AABA form with a section map. Use the AABA preset for anything involving
  setups, fills, or chorus arc — loop mode replays a single generated pass, so a short
  loop literally cannot exhibit chorus-to-chorus behavior.
- **Style**: swing, bossa nova, ballad, straight — the four styles at parity; defaults to
  the Settings backing style. **Instrument**: piano or organ comping.
- **Tempo presets**: 90 / 160 / 240 BPM — the protocol's three swing-feel anchors.
- **Variation seed** (0–99): re-rolls every generation stream (the seed suffixes the
  phrase id, which all seeds derive from). Seed 0 is canonical: the golden fixtures and
  the reference bounces use it. The statistics report aggregates several seeds per preset.
- **Bounce to WAV**: renders the exact events the live engine would schedule, through the
  same instruments and mix math. Keep dated bounces (the filename embeds preset, style,
  tempo and date) as references for later comparisons.
- **Blind A/B**: load a reference WAV, bounce the current engine, start the comparison —
  slots are shuffled behind X/Y labels and the verdict is recorded before revealing which
  is which.
- **Export events JSON**: dumps the exact generated event streams (bass / comp / drums
  plus the generation params) for the current preset+tempo+seed. This is the format the
  golden fixtures use and the input the WAV renderer takes, so it is how you freeze
  "what the engine played today" independently of "how it sounded".
- **Render WAV from events JSON**: the inverse — plays any past engine's exact events
  through *today's* instruments and mix. Validates shape and rejects a tempo below
  20 BPM (a degenerate tempo would ask for an Infinity-second render).
- **Checklist**: the items live in `src/lib/audio/backing-listening-checklist.ts` (single
  source of truth — 19 items across swing-feel / bass / comp / drums / ensemble / mix).
  Cycle each item through ✅ / ❌ / ➖, add notes, and "Copy listening report" produces
  the markdown block to paste below and into the milestone PR.

### Producing a comparison set headlessly

Clicking through eight bounces by hand is how the first milestone went; don't repeat it.
`tests/e2e/backing-milestone-render.spec.ts` drives the lab in a real browser and saves
one WAV per events JSON:

```sh
RENDER_DIR=tests/fixtures/backing/milestone-a OUT_DIR=~/Desktop/milestone-a \
  npx playwright test tests/e2e/backing-milestone-render.spec.ts --project=chromium
```

It self-skips unless both env vars are set, it is not running in CI, and the project is
Chromium — so it never fires as part of an ordinary `npm run test:e2e`. The committed
Milestone A set lives at `tests/fixtures/backing/milestone-a/` (old/new × blues at
90/160/240 + AABA at 160).

## Full-tune blind reviews

On `/musicality`, choose **Try a blind comparison**. Pick a real tune, concert key, style, tempo and one to four solo choruses, then start the comparison. The page locks those inputs and assigns the two arrangements to A/B without showing their identities or musician decisions.

Listen to each full take. Stopping is allowed, but an interrupted take must be replayed completely before it qualifies. Rate each version on the seven musical dimensions, then choose A, B or no preference before revealing the arrangements. For listening ease, a higher rating means less tiring. Include specific moments in the notes, especially crowding, timing, form arrivals or a convincing response. The ordinary listening view remains useful for inspecting each musician's evidence after the blind judgment.

Export the revealed review to retain both exact generated scores, settings and judgments. **Save review locally** keeps a compact summary in this browser (latest 20); its history offers summary exports. Export the current full review before leaving if the actual score traces are needed. A saved verdict is listening evidence, not automatic acceptance or a production rollout decision.

Use the same headphones and listening level for a pair. Repeat across Swing, Straight, Bossa Nova and Ballad at appropriate playing tempos, and preserve ties and unfavorable results. The A/B mapping is randomized per comparison; deliberately vary which label is heard first when assembling a review set. This compares the two modes of the current engine. Historical-engine WAV comparisons and microphone-feature replay remain in the advanced lab.

## Milestone procedure

For each milestone (A, B, C):

1. Bounce the current engine at 90, 160 and 240 BPM on the blues preset, plus 160 BPM on
   the 3-chorus AABA preset (seed 0).
2. Blind-A/B each against the corresponding baseline/previous-milestone bounce. If you
   don't have a dated reference WAV, reproduce one from data: grab the golden events JSON
   for the engine you want to compare against out of git history
   (`git show <commit>:tests/fixtures/backing/golden-lab-blues-f-160.json > old.json` —
   the pattern is `golden-<preset>[-<style>]-<tempo>.json`),
   then use the lab's **Render WAV from events JSON** — it plays any past engine's exact
   events through today's instruments and mix, so the comparison surface is placement,
   swing and vocabulary rather than level balance.
3. Work through the checklist at each tempo; copy the reports.
4. Paste the reports below (newest first) and into the PR that closes the milestone.

A milestone passes when the blind verdict is "new ≥ old" at every tempo and no checklist
item that a previous milestone flipped to ✅ has regressed to ❌.

## Listening log

<!-- Paste listening reports below, newest first. -->

### Sample timing audit — 2026-10-20

The listener confirmed the pedal hi-hat correction with “That sounds much better.”
This accepts that specific timing improvement, not the complete musicality specification.

The follow-up measured actual recordings and isolated WAV output, separately from
the musical offsets in `backing-timing.ts`. Bass uses the Smolken Pizzicato bank;
piano uses Splendid Grand Piano with PPP/PP/MP/MF/FF bands (PPP filters the PP
recordings), not the previously documented 16-layer Salamander bank.

| Recording audit | Scope | Measured attack before correction |
| --- | --- | --- |
| Bass | All 91 samples mapped to MIDI 28–55 | 0–4 ms; median 1 ms |
| Piano | All 226 unique loaded recordings, source anchors MIDI 23–108 | 0–39 ms; median 1 ms |

These measurements use 1 ms stereo RMS windows and the first crossing of 10% of
the early peak (first 300 ms for bass, 250 ms for piano). They identify recorded
lead-in; a later body peak or 50% crossing is not by itself unwanted latency.
Native isolated bass rendering also starts promptly, within 0–5 ms, so no bass
trim or global timing advance was applied.

The source piano SFZ specifies start offsets for ten recordings that the player
omits. Their original 44.1 kHz frame counts are now restored by
`backing-piano-samples.ts`, with a short fade at each new sample edge based on the
source's 0.5 ms attack setting. Offsets are converted through seconds, not applied as frame counts to the
48 kHz decoded OGGs. The remaining natural attack is retained: the soft D sample
still has about 15 ms of buildup after its declared 23.72 ms offset. Other piano
recordings, bass, musical timestamps, and mix gains are unchanged.

The calibrated raw piano bank now measures 0–16 ms across all 226 recordings,
and 0–15 ms for the 128 source anchors in MIDI 36–84, using the same 250 ms
measurement window. The declared offsets come from the pinned source
[PP mapping](https://github.com/sfzinstruments/SplendidGrandPiano/blob/1c595d827b7fd7f0be3134aaed0f90b3662a09cf/Data/PP.txt),
[MP mapping](https://github.com/sfzinstruments/SplendidGrandPiano/blob/1c595d827b7fd7f0be3134aaed0f90b3662a09cf/Data/MP.txt),
[FF mapping](https://github.com/sfzinstruments/SplendidGrandPiano/blob/1c595d827b7fd7f0be3134aaed0f90b3662a09cf/Data/FF.txt),
and [global attack setting](https://github.com/sfzinstruments/SplendidGrandPiano/blob/1c595d827b7fd7f0be3134aaed0f90b3662a09cf/Splendid%20Grand%20Piano.sfz#L45).
The converted library's mappings at revision
`009793ebf849aee57f9a213aeaf8f2d1e2178f4f` match those source definitions.

`tests/e2e/backing-pitched-timing.spec.ts` exercises the public events-JSON WAV
renderer with real CDN samples, a dry mix, and isolated notes: bass MIDI
28/36/43/48/55 at three velocities and piano MIDI 35/38/48/60/72 across all five
velocity bands. It measures 10%/50%/peak timing in the first 150 ms, checks that
the lead-in stays below 1% of the attack's peak, and guards against delayed
attacks. Each note gets its own WAV render because a combined render retained
residual audio in Firefox; a fresh graph prevents earlier notes from influencing
another note's measurement. The exact cause of that residual audio remains
unresolved. The test fetches each real recording once and reuses its downloaded
bytes across renders, avoiding repeated full-bank CDN requests. Before the fix,
soft piano MIDI 35 and 38 attacked at 28 ms and 45 ms respectively, including the
shared mixer delay, and failed the 25 ms onset guard. This is a local diagnostic
with real network samples; it skips hosted CI. Human listening of the piano
correction remains pending.

The final independent renders passed in Chromium, Firefox and WebKit: all 40
notes per engine had silent lead-ins, bass attacks measured 6–11 ms, and the
corrected soft low piano notes measured 14–21 ms through the mixer. The broader
local checks passed 6,387 unit tests (40 expected failures), type checking,
the production build and 24 focused browser checks including this diagnostic,
the drum timing regression, mixer controls and `/musicality`. No hosted CI ran.

**Bass selection repair — 25 October 2026:** the installed Smolken preset conversion dropped
one-sided velocity limits and region-level round-robin lengths. Native rendering
confirmed 7–12 sample voices per note where the source preset selects one.
The shared loader now restores the pinned Pizzicato bank’s velocity bands
(0–74, 75–120 and 121–127) and three/four-take round robins for MIDI 28–55,
before the sampler constructs its matcher. The complete active signature must
match; foreign, partial or modified banks stay untouched. Ten other source groups
remain unchanged. The source fixture is SHA-256
`0aea1def56753b0dcc89914b1ac24054200bacc01dd696572745c70787eaec4f`.

This applies to live playback and offline bounce, in Original and Coordinated
modes and all styles. It changes sample selection, level and timbre, not generated
notes, onset trims or envelopes. The existing bass bus trim stays at 0.05. Unit tests use the
installed converter and region matcher against all supported keys/velocities and
complete cycles; native tests count actual AudioBufferSourceNode starts and check
recording identity, finite signal and onset. Source `amp_velcurve_*` opcodes remain
unsupported. Sampler counters retain their existing per-group behavior; exact
counter parity with a separate SFZ engine is not claimed.

Raw same-gain full-tune bass stems and before/after RMS/peak measurements are
retained for audition. Removing accidental layers reduced reference RMS by 17.2–19.2 dB.
The shared bass constructor adds a linear gain of 7.74 only after a recognized bank
loads successfully. This is the rounded geometric mean of the four style-specific
before/after RMS ratios, restoring these raw reference levels within about 1.4 dB.
It preserves velocity dynamics and user faders; unknown banks get no boost.
The insert belongs to the instrument channel and is disconnected with it.

The public WAV exporter peak-normalizes its output. Raw pre-normalization mix
measurements are therefore retained separately; normalized isolated bounces cannot
establish relative balance. Full-tune artifacts live at
`/Users/avitus/.codex/artifacts/musicality-2026-10-25/bass-selection/listen.html`;
the calibrated public-app comparison is at
`/Users/avitus/.codex/artifacts/musicality-2026-10-25/bass-calibration/listen.html`.
This measured reference-level preservation still needs human ensemble listening;
see the [development log](/docs/contributing/musicality-progress).

### Milestone B — 2026-08-06 — verdict: NEW preferred at all three tempi

Blind pairs (increment-4 engine vs increments 5–8, 3-chorus AABA at 90/160/240,
both sides rendered through identical samples/mix, produced headlessly at
`~/Desktop/milestone-b/`): "a good improvement — I preferred the new easily in
all three tests." Gate result: **pass** — the vocabulary increments (walking
bass planner, comping engine, drum vocabulary, plus the intensity arc)
dominate perception, bearing out the Milestone A hypothesis.

One finding: "a very loud (and long) crash/ride cymbal at the end of choruses
or sections." Investigated: the crash *placement* (section-first downbeat after
the setup fill, more often deeper into the form) is idiomatic and kept; the
jarring quality was three stacked engineering causes — the asset kept its full
11.8 s natural decay (≈ 8 bars at 160), peak normalization put its sustained
body ~18 dB above the ride bed, and the trigger gain stacked another +4–6 dB.
Fixed in increment 8.5: soft-layer (vl1) crash re-export with decay shortened
to ~3 s, `BACKING_BASE_TRIMS.crash` 0.9 → 0.55 (see
`static/samples/drums/ATTRIBUTION.md`, "Crash exception"). Generation was
deliberately untouched, so goldens and the report are unchanged. Confirm
listen verdict (2026-08-06, post-fix): better, and best at 85% of the fixed
level — trim refined 0.55 → 0.51. (smplr's velocity→gain curve is quadratic,
so × √0.85 in velocity space is × 0.85 in output *amplitude* — the sqrt rule
documented at `BACKING_BASE_TRIMS`.) A second confirm listen (2026-08-08)
took one more 85% step, 0.51 → **0.47**, which is the value at HEAD.

### Milestone A — 2026-08-05 — verdict: tie (no perceived difference)

Blind pairs (pre-#206 vs increment-4, blues 90/160/240 + AABA 160, both sides
rendered through identical samples/mix, produced headlessly — set committed at
`tests/fixtures/backing/milestone-a/`): the listener could not distinguish any
pair. Gate result: **pass as non-regression** (tie satisfies "new ≥ old"), with
the caveat that the tempo-swing/microtiming improvement is not yet perceptible.
Hypotheses recorded for later increments: the ride skip (the swing-feel
carrier) is the quietest voice in the mix (revisit balance in increment 9), and
the pre-vocabulary engine's sparse repetitive texture gives the ear little to
anchor on — vocabulary increments 5–7 are expected to dominate perception.

### Baseline audit — never recorded

The post-PR-#201 engine never had a checklist pass of its own (PR #36 and #201 both
shipped without one); Milestone A heard it only as the "old" side of the blind pairs.
The failures expected of it at the time: fixed swing ratio at all tempi,
mutually-quantized instruments, comping loops on short forms, no snare (so no fills),
and the synthesized metronome doubling the kit when enabled.

## Structural-energy listening focus — 24 October 2026

In the listening studio, choose Coordinated and play the whole tune with at least two solo choruses. Compare the opening head, early and later solo choruses, the return to the head and the ending. The **Planned arc** cue and instrument details show the structural intention used for the sounding bar, not an assertion that the result sounds convincing.

Listen for development without an endless rise in busyness, useful room for the melody on returning heads, and a release that preserves pulse. Check especially that Bossa keeps its clave and bass pattern and Ballad keeps its spacious two-feel. Use the blind full-tune comparison to record preference without the stage labels influencing it. Retain regressions such as an overly quiet head, a sudden transition, an indistinct peak or a lifeless ending. No human acceptance results have been recorded for this increment.
