# Sessions Log

Newest at the top.

## 2026-06-25 — Fixed legato-tongue re-articulation via a new captured signal (hfRms) — blues-curl-down, concert Bb

**What happened:**

- User reported the 4th instance of the re-articulation-merge class: an ear-training lick where "a re-articulated note failed to be detected." Diagnostic JSON + WAV (`2026-06-25-blues-curl-down`, bc-042_Bb, tenor sax, 100 BPM, no backing track).
- Ground truth (raw WAV, numpy + FFT): phrase is **Db Db Bb** (the blue 3rd tongued twice, curling to the root). The second Db was a **soft legato tongue** at t≈0.474 s — the airflow never stopped. Segmenter produced **2 notes** (one long Db, one Bb) → second Db MISSED → score 0.631 ("fair"), pitch 2/3.
- Root cause: this re-attack is invisible to **all four** existing detectors. **No reading gap** (continuous 16.7 ms frames), **rms RISES** not dips (no envelope dip), **clarity dip only 0.042** (< 0.07 floor), **worklet never fired** (its "HFC" is amplitude-weighted `Σ|s|·(i+1)`, and the amplitude barely moved). The *only* clean signature is a broadband **high-frequency transient** (FFT centroid spikes to ~9 kHz, HF>4 kHz energy 0.05→0.7) — and that signal **was not captured in `PitchReading` at all**.
- This is the first fix in this class that required a **new captured signal**, not a new reading of existing fields. Added `hfRms` to `detectFrame` (RMS of the first-difference / +6 dB-oct high-pass; one extra term in the existing energy loop), exposed on `PitchReading` (optional → old JSON skips it). Because `detectFrame` is shared by live capture AND the WAV-replay harness, the replay recomputes `hfRms` from this exact WAV → an end-to-end regression test works.
- **The hard part — the false-positive question.** A bare hfRms spike is NOT specific. Profiling all 12 fixtures through the real replay path: `a4-c5` and `a3-c4` (curated 2 notes, `[57,60]`) each show a mid-note HF burst at ~2.5 s (similar ~9 kHz centroid spike). I first read these as the same tongue event and wrote that their ground truth was "debatable." **The user then listened (temp `/listen` page) and confirmed a4-c5/a3-c4 have NO audible transient — only curl-down's re-tongue is audible. So `[57,60]` is correct and the gate makes the right call on all three.** I'd over-read the spectrogram: a centroid/HF-*ratio* spike with no change in *total* energy need not be audible.
- The separator: the genuine re-attack perturbs the **fundamental** (midiFloat dips 61.1→60.94, ≈0.12–0.16 st — the reed resetting) because the tone audibly restarts; the inaudible a4-c5/a3-c4 blips leave the fundamental steady (≤0.07 st). The single threshold (`HF_RE_ARTICULATION_MIN_PITCH_PERTURB = 0.1`) sits between them — numerically tight (~0.03 each side) but, per the listening test, **perceptually aligned** (fires iff the reed audibly re-attacked). See observations.md.
- Fix (`note-segmenter.ts`, ~40 lines): new HF-transient tier in `findReArticulationsInSegment`, after the gap pass. For each same-MIDI stable run: spike = `hfRms ≥ 3× run-median`; fire only if a coincident `|midiFloat − run-median| ≥ 0.1 st` perturbation exists. Emits an articulation onset → splits the run AND reinforces it as attack evidence.
- Tests: copied both fixtures into `tests/fixtures/recordings/`; added a WAV-replay block in `pitch-replay.test.ts` (3 tests: HF articulation onset, segments [Db,Db,Bb], scores 3/3). Verified **RED without the fix** (detected [61,58], 0 onsets — matches the diagnostic exactly) → **GREEN with it**. NO JSON-fixture test: the saved readings predate `hfRms`, so only the WAV path can exercise it. Full suite green (**2014 passed**), `npm run check` clean (0 errors).

**Notes:**

- **Shipped to PR #139** (`dev→main`, 2026-06-25), awaiting user merge. Temp `/listen` page deleted after the listening test.
- **CodeRabbit round did real work.** One Major comment: the perturbation gate compared `midiFloat` to the whole-run median, which a key click during a bend/vibrato could clear. Adopted its **local-baseline** fix (bracket the spike with PRE_CONTEXT frames). Validating it — re-profiling the whole corpus through the WAV path, per the 2026-06-23 discipline — caught a **latent regression in my own original fix**: the HF pass fired inside a McLeod **octave artifact** (`octave-flat-seven-drop` C5 harmonic lock: broadband + 0.33 st swing, so it cleared both gates), and its spurious onset blocked `mergeOctaveBoundariesWithoutAttack` → `[62,72,72,72,60]` instead of `[62,60]`. Invisible to CI because that fixture only has a JSON-path test (saved readings predate `hfRms`). Fixed with a 3rd corroborator — **energy must sustain** across the spike (real re-attack post/pre rms 1.11; decaying artifact 0.61; gate ×0.9). Added a WAV-replay guard for it (RED without the energy gate). Commit `1702299`; thread resolved; suite 2016 green.
- The 2026-06-21 prediction held a 4th time but **evolved**: this axis wasn't latent in the existing readings — it required new capture (`hfRms`). Two headline corrections this session, both from outside my own analysis: (1) the user's ear settled that a4-c5/a3-c4 are genuinely single notes (`[57,60]` correct, cue perceptually aligned); (2) CodeRabbit's review prompted the re-validation that caught the octave-artifact landmine. **Lessons: for a "would a human hear this?" question, ask the human first; and the 2026-06-23 "interrogate EVERY fixture against the boundary" rule applies to fixtures that only have a JSON test too — the WAV path is the one production uses.** See observations.md.

---

## 2026-06-23 — Fixed weak-step-up re-articulation merge via a true-silence gate (blues-curl-up, concert D)

**What happened:**

- User reported the same class of bug as 2026-06-21: an ear-training lick "missing the division between the second and third notes." Diagnostic JSON + WAV (`2026-06-24-blues-curl-up`, bc-041_D, tenor sax, 100 BPM, no backing track).
- Ground truth from the raw WAV (numpy autocorr + RMS envelope): player played **D-F-F** — the day's concert-D tonality snapped the lick's blue note (F#) down to F, so the rendered phrase was D F F and the player matched it. Three clean attacks; the third (re-articulated F) attacks at ~1.02 s with a true ~1.8× energy jump (peak 0.38). Segmenter produced only **2 notes** → third F MISSED → score 0.627 ("fair"), pitch 2/3.
- Root cause: the **same dead zone** as flat-five, but with a weaker *measured* step-up. The 117 ms reading gap (0.950→1.067) brackets the attack — clarity collapses through the tongue click so Pitchy drops the whole transient; readings resume on the new note's decay shoulder, so the captured rise is only **1.26×**, under the short-gap tier's 1.5× floor. `extractOnsetsFromReadings` made the boundary (gap >100 ms) but `mergeSamePitchWithoutAttack` collapsed it for lack of attack evidence; `findReArticulations` supplied none.
- The trap: lowering 1.5×→1.26× re-admits a real false positive. Built a cross-fixture decision table from the **actual replay path** — the **upper-neighbor-on-root** (C-D-C) fixture's sustained-final-C "gap" rises **1.27× / peak 1.51×**, *higher* than the genuine re-attack, and must NOT split. Ratio cannot separate them.
- The separating axis is the **`warmup` flag**: a genuine soft-tongue silence emits *no* frames across the hole (worklet missed it → no stabilizer reset → no warmup); the upper-neighbor "gap" is bridged by warmup frames (the worklet fired at 1.355 s → reset → `findSameMidiRuns` skips warmup → phantom gap).
- Fix (`note-segmenter.ts`, ~15 lines): added `hasReadingInOpenInterval` and gated the short-gap tier on a **true reading-time silence** (no frames, warmup included, bridge the hole). That rejects the warmup-bridged landmine *by structure*, which then makes lowering `RE_ARTICULATION_GAP_ATTACK_RISE` 1.5→1.2 safe (remaining true-gap non-re-attacks sit ≤1.12×). The ≥150 ms bare-gap tier is untouched (the 2026-05-22 takes' 217 ms warmup-bridged gaps must still fire — they do).
- Tests (diagnostics-regression habit): copied both fixtures into `tests/fixtures/recordings/`; added a WAV-replay block in `pitch-replay.test.ts` (3 tests: articulation onset, segments [D,F,F], scores 3/3). Verified **RED without the fix** (detected [62,65], 0 onsets) → **GREEN with it**. Full suite green (**2011 passed**), `npm run check` clean (0 errors).

**Notes:**

- **Shipped.** Committed on `dev` (`d76f53b` fix + `74b6d09` CLAUDIUS note), merged to main via **PR #137** (confirmed 2026-06-24). On 2026-06-24 fetched + fast-forward-merged main back into `dev` (alongside PR #136 from `dev-macbook` + a docs sync); `dev` now identical to `origin/main`. The 2026-06-21 prediction ("future fixes here will be a new *axis*, not a new threshold") held precisely — see observations.md.

---

## 2026-06-21 — Fixed short-gap same-pitch re-articulation merge (flat-five-chromatic-up)

**What happened:**

- User reported an ear-training lick was mis-scored: "two notes were combined into one" despite clear audible separation. Diagnostic JSON + WAV provided (flat-five-chromatic-up, concert G, bc-045_G, tenor sax, 100 BPM, no backing track).
- Established ground truth from the raw WAV (numpy autocorrelation + RMS envelope, independent of the app's captured readings): player played **C-C-D** — two tongued C4 quarters + a D4 half. The two C4s re-articulate at t≈0.42 s (RMS doubles 0.05→0.09; pitch readings drop ~6 frames → a 100 ms gap at 0.333→0.433 with a clarity dip to 0.847). The post-phrase transients at 2.2/2.8/3.4 s are key-clicks (no sustained pitch).
- Root cause (mapped via a 4-agent Workflow over onset-core / note-segmenter / score-pipeline / tests): the soft re-attack fell in the **dead zone between `findReArticulations`' two passes** — bare-gap pass wants ≥150 ms (this is 100 ms); dip-and-rise pass wants an RMS *dip* (this RMS *rises*). `splitOnReadingGaps` (75 ms) created the boundary, but with no articulation onset `mergeSamePitchWithoutAttack` collapsed it → 2 notes, second expected note MISSED, score 0.62 ("fair").
- Fix (`note-segmenter.ts`, surgical, ~12 lines + 2 consts + `meanRms` helper): gave the gap pass a corroborated lower tier — a gap ≥ `READING_GAP_SPLIT_THRESHOLD` (75 ms) now counts as a re-articulation when the post-gap RMS window averages ≥1.5× the pre-gap window (a re-attack). A sustain dropout fades/holds (ratio ≲1.0), so the energy-*direction* discriminator separates the two without lowering the 150 ms bare-gap floor that protects against mid-sustain glitches.
- Tests (per the diagnostics-regression-suite habit): copied both fixtures into `tests/fixtures/recordings/`; added a JSON-fixture block (`audio-processing-pipeline.test.ts`, algorithm in isolation) and a WAV-replay block (`pitch-replay.test.ts`, end-to-end). Verified all 5 new tests **fail without the fix and pass with it** (git-stashed the source to confirm). Full suite green (2008 passed), `npm run check` clean (0 errors).
- Side finding (not a bug, flagged to user): the scored target was C-C-D, not the chromatic C-Db-D, because the day's tonality was G major — `snapLickToScale` snaps the out-of-scale b5 (Db) to the root. See observations.md.

**Notes:**

- Shipped: committed on `dev` (fix + tests/fixtures + these notes), opened **PR #135** (dev→main), CodeRabbit had one trivial nitpick (extract a shared replay→segmentation helper in the new WAV block) — applied; the non-blocking "docstring coverage 40%" pre-merge warning declined with rationale. **User merged PR #135.**
- The "Flat Five Chromatic Up renders without its flat five in diatonic tonalities" question is **resolved — accepted as-is** (see observations.md); don't re-raise.

---

## 2026-06-21 — Diagnosed dev/prod data contamination (no code changed yet)

**What happened:**

- User reported recurring contamination between dev and production: dev-user licks leaking into the prod account, hard-to-delete duplicates. Asked whether two specific cases are *possible* (not yet asking for a fix).
  - Case 1: same machine, prod user + dev user with the same username, both logged in.
  - Case 2: same machine, logged-in prod user + a not-logged-in dev user.
- Root cause: **dev and prod share one Supabase project** — a single `.env`/`PUBLIC_SUPABASE_URL` is read by both `npm run dev` and the deployed site → one DB + one `auth.users` pool. Confirmed: no `.env.development`/`.env.production`, CI does `supabase db push --linked` to prod. The `user_licks` SELECT RLS policy (`00013`) is open to any authenticated user; only the client-side `.eq('user_id', self)` filter isolates libraries.
- Verdicts (adversarially verified via a 4-agent workflow — 3 lens refuters + 1 completeness critic):
  - **Case 1 — YES, effectively by definition.** Same email = same `user.id` in the shared project, so dev/prod are one cloud account; licks merge in both libraries, origin-independent. Duplicates persist because IDs are `user-${Date.now()}-${rand}` and dedup is ID-keyed.
  - **Case 2 — literal scenario impossible, real variant exists.** Anonymous = zero cloud presence; `@supabase/ssr` cookies are origin-scoped so you can't be prod-logged-in and dev-logged-out on one origin. The genuine vector is the anonymous→first-login absorption on a *shared origin* (`syncUserScope` deliberately doesn't wipe on first login; `initUserLicksFromCloud` pushes unstamped local licks into the new account). Diagnostic inversion: a real Case 2 produces no contamination, so observed contamination ⇒ the dev tab still holds a persisted session ⇒ it's Case 1 in disguise.
  - **Bigger than licks:** shared account also *destroys* data — `session_results` prune (`sync.ts:169`) deletes the other env's history; `user_lick_metadata` (`sync.ts:941`) clobbers `prog:*` eligibility + unlock counts LWW. Stolen-lick payloads render in `/library` but `deleteUserLick:633` refuses to delete them (the literal "can't delete" symptom).
- Fix implemented (local Supabase stack, chosen over a cloud dev project after the user reconsidered): `supabase init` + `npx supabase start`; committed `supabase/config.toml` (auth URLs → localhost:5173); local `.env` → `http://127.0.0.1:54321` (prod creds saved to gitignored `.env.prod.backup`); added `db:start`/`db:stop`/`db:reset` scripts + README note. Verified all 17 migrations apply on a clean DB, schema/RLS mirror prod, and the dev server renders 200 with no connection errors. Production untouched (CI injects build creds; `.env*` gitignored; CI migrate pinned to prod ref). Not committed — left for the user. Shared-origin anonymous-absorption code bug still open (now low impact).

**Notes:**

- The whole owner-stamp / `syncUserScope` / generation-counter apparatus is symptom-fixing for an infra misconfig — see observations.md 2026-06-21. The defenses are blind to the dev/prod channel because both environments legitimately stamp the same `user.id`.
- Left open: PR #133's CodeRabbit review completed mid-session; not yet processed (user redirected to this investigation).

---

## 2026-05-07 — Calendar wasn't recording lick-practice sessions

**What happened:**

- User reported the progress calendar didn't reflect their lick-practice sessions.
- Bug was in `rebuildHistoryIfNeeded()` in `src/lib/state/history.svelte.ts`. That function runs on every authenticated page load (twice, in `+layout.ts`) and re-derives daily summaries from `progress.sessions`. But `progress.sessions` only contains ear-training sessions — `recordLickPracticeAttempt` deliberately writes lick attempts straight into the daily summary without polluting the session log.
- For mixed days (ear + lick), the derived summary undercounts the day by exactly the lick-practice contribution. The "earliest derived date" guard (existing.sessionCount > derived.sessionCount → skip) was the right shape but only ran for the earliest derived date, citing pruning. For every other mixed day, `Object.assign(existing, derivedSummary)` silently wiped lick-practice contributions on each reload.
- Fix: extended the existing-wins guard to all dates. Added an integration regression test covering a multi-day history with one mixed non-earliest day.
- All 1781 tests pass; type check clean.

**Notes:**

- Two callers exist for `aggregateSession`: `recordAttempt` (ear-training, full session log + cloud sync) and `recordLickPracticeAttempt` (lick-only, lightweight aggregate sync). The asymmetry is intentional — lick attempts must not pollute adaptive difficulty or per-key proficiency. But that asymmetry is the trap: any consumer that re-derives state from `progress.sessions` will silently lose lick-practice signal. Two existing places do this re-derivation: `migrateScaleProficiency` and `migrateKeyProficiency` both correctly skip non-ear-training sessions. The third place — `rebuildHistoryIfNeeded` — was the one that didn't account for it. Worth flagging as a category of bug: anything reading `progress.sessions` as if it were the full activity log is wrong.
- The cloud round-trip *would* have papered over the bug for a single reload (mergeCloudSummaries restores from the `daily_summaries` table), but the layout calls `rebuildHistoryIfNeeded` a second time after the cloud merge as a safety net for slow hydrations, which wiped again. The layout's safety-net rebuild is now harmless because the guard preserves existing-wins everywhere.

---

## 2026-04-20 — Documentation refresh pass

**What happened:**

- Audited all `src/lib/` modules, routes, types, migrations against `documentation/`. Several docs had drifted significantly since the three-domain palette landed, the score pipeline was extracted, and the backing-track + bleed-filter path was added.
- Rewrote `documentation/architecture/design-system.md` end-to-end: replaced the old blue/green palette with the current peacock teal (ear-training), terracotta (lick-practice), slate (neutral) identity. Documented the full brass decorative palette (`--color-brass`, `--color-brass-soft`, `--color-paper`), the on-air recording red, the Fraunces display serif, and the `.jazz-rule` / `.smallcaps` / `.grain-overlay` utilities.
- Rewrote `documentation/architecture/scoring-algorithm.md`: corrected the rhythm penalty formula from `× 1.5` to the tempo-scaled `min(1.0, 0.5 + tempo/300)` curve, added octave-insensitive matching, documented the new `score-pipeline.ts` orchestrator, the bleed-filter A/B, and the `TimingDiagnostics` field on `Score`. Added `GRADE_CAPTIONS` to the grade table.
- Updated `overview.md` module diagram (persistence, new audio modules, pipeline wrapper), `audio-pipeline.md` (backing track, bleed filter, quantizer, recorder/replay sections + updated awaiting-input behavior), `tech-stack.md` (current CSS token values + domain overrides + Fraunces note), `data-model.md` (Score.timing + BleedFilterLog + TimingDiagnostics).
- Fixed `api-reference/components.md` LickCard difficulty colors to reflect the actual 10-band table in `difficulty/display.ts`.
- Rewrote the `documentation/getting-started.md` project-structure tree to match real counts (20 audio files, 7 state modules, 8 type files, 12 migrations, nested components by domain, etc.).
- Updated `README.md` migration count (5 → 12) and `CLAUDE.md` module descriptions for audio/ and scoring/.

**Notes:**

- The underlying insight worth keeping: documentation drift in this project concentrates in visual/design artifacts (palette docs lag the CSS by months) and in the scoring layer (formulas in prose go stale even when `api-reference/scoring.md` — which is generated from signatures — is current). Architecture docs that paraphrase code are fragile; docs that describe *decisions* survive longer. Future doc passes should lean harder on the "why" of each section.
- The api-reference directory held up better than the architecture directory. That pattern probably means refreshing it is already someone's habit. The architecture docs need explicit prompting.

---

## 2026-04-16 — Fix chord/demo alignment in continuous lick practice

**What happened:**

- Diagnosed the recurring chord/demo alignment bug in continuous lick practice mode (second lick onwards)
- Root cause: visual tracking used seconds-based anchors computed with constant-BPM formula, which diverges from actual `transport.seconds` when tempo changes between licks (~3 second / ~5 beat error)
- Fix: replaced seconds-based tracking with tick-based; applied BPM synchronously; cleaned up backing Part start pattern
- Files changed: `src/routes/lick-practice/session/+page.svelte`, `src/lib/audio/backing-track.ts`
- All 1341 tests pass, zero new type errors

---

## 2026-04-16 — Session start; memory restructure

**What happened:**

- User established new operating principles: in-project `MEMORY.md`, default-location stub reduced to the 6-point instruction set, CLAUDIUS folder for sessions and independent notes.
- Migrated all existing memory content from the default local Claude memory location into `MEMORY.md` at the project root, structured as: preamble + user profile + working agreements + reference map.
- Stub at default location now contains only points (1)–(6) per instruction.
- Created `CLAUDIUS/README.md`, `CLAUDIUS/SESSIONS.md`, `CLAUDIUS/observations.md`.
- Reviewed the project from a fresh start: PRD, README, `CLAUDE.md`, design system, architecture overview, source layout, recent git history.

**Open / awaiting:**

- User to communicate what we're working on next.

**Notes:**

- Old per-topic memory files at the default location are left in place as historical artifacts. They're no longer referenced by the stub, so they don't load into context. The user can prune them at will.
