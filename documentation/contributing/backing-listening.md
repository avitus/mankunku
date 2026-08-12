# Backing-track listening protocol

The backing-track upgrade program ("professional session musicians") is verified two ways:

1. **Automated musicality guards** — property tests over the seeded generator plus two
   committed artifacts that force every engine PR to show its musical diff:
   - `documentation/reference/backing-report.txt` — statistics report; regenerate with
     `npm run backing:report`, review the diff, commit it. A drifted report fails
     `tests/unit/audio/backing-report.test.ts`.
   - `tests/fixtures/backing/golden-*.json` — full event dumps for fixed
     (preset, tempo) pairs; regenerate with `npm run backing:golden`. A drifted engine
     fails `tests/unit/audio/backing-golden.test.ts`.
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
- **Tempo presets**: 90 / 160 / 240 BPM — the protocol's three swing-feel anchors.
- **Variation seed**: re-rolls every generation stream (the seed suffixes the phrase id,
  which all seeds derive from). Seed 0 is canonical: the golden fixtures and the
  reference bounces use it. The statistics report aggregates several seeds per preset.
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

## Milestone procedure

For each milestone (A, B, C):

1. Bounce the current engine at 90, 160 and 240 BPM on the blues preset, plus 160 BPM on
   the 3-chorus AABA preset (seed 0).
2. Blind-A/B each against the corresponding baseline/previous-milestone bounce. If you
   don't have a dated reference WAV, reproduce one from data: grab the golden events JSON
   for the engine you want to compare against out of git history
   (`git show <commit>:tests/fixtures/backing/golden-<preset>-<tempo>.json > old.json`),
   then use the lab's **Render WAV from events JSON** — it plays any past engine's exact
   events through today's instruments and mix, so the comparison surface is placement,
   swing and vocabulary rather than level balance.
3. Work through the checklist at each tempo; copy the reports.
4. Paste the reports below (newest first) and into the PR that closes the milestone.

A milestone passes when the blind verdict is "new ≥ old" at every tempo and no checklist
item that a previous milestone flipped to ✅ has regressed to ❌.

## Listening log

<!-- Paste listening reports below, newest first. -->

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

### Baseline audit — pending

The post-PR-#201 engine has not yet had a recorded listening pass (PR #36 and #201 both
shipped without one). The first milestone-A session should start by auditing the baseline
bounces and pasting the reports here — expected failures at baseline include: fixed swing
ratio at all tempi, mutually-quantized instruments, comping loops on short forms, no
snare (so no fills), and the synthesized metronome doubling the kit when enabled.
