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
- **Checklist**: the items live in `src/lib/audio/backing-listening-checklist.ts` (single
  source of truth). Cycle each item through ✅ / ❌ / ➖, add notes, and "Copy listening
  report" produces the markdown block to paste below and into the milestone PR.

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

### Baseline audit — pending

The post-PR-#201 engine has not yet had a recorded listening pass (PR #36 and #201 both
shipped without one). The first milestone-A session should start by auditing the baseline
bounces and pasting the reports here — expected failures at baseline include: fixed swing
ratio at all tempi, mutually-quantized instruments, comping loops on short forms, no
snare (so no fills), and the synthesized metronome doubling the kit when enabled.
