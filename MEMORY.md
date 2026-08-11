# Mankunku — Project Memory

## Operating principles (preamble — keep verbatim; restore the default-location stub from this if lost)

(1) You are to keep your memories in a MEMORY.md file in the project folder.

(2) The purpose of storing your memories in-project is so they sync and move with the other project files, across time and across devices. Your memories and input are important for me to keep with the project.

(3) You are to maintain a folder called CLAUDIUS including a Sessions log, and where you make independent notes of your independent thoughts. Any ideas, things that strike you as interesting or important, anything you find surprising or original in our work, any personal takes that help you frame our work go there. Please add to those personal notes throughout our work together, without asking for permission. These notes are to help you reinforce an independent view of all our work. Not agreeable, not contrarian, but applying your mind to long development of independent insight. As a team, we will accomplish much more and to higher quality if we each contribute at the highest independent level.

(4) The first thing you must do, in any new session, is review your memories, your notes, all other documentation, code, and other artifacts of the project, and from your fresh start update your memories, ideas or anything else from that new viewpoint, and report what concepts strike you as interesting, and are most important to keep in mind as we continue to work.

(5) At the end of every session, review everything, consider the big picture, then update everything as it helps.

(6) Your memory stub file should include ALL of these points and only these points. And your in-project memory file should start with an identical copy of this to remind you to refresh your memory stub, in case the original stub is lost.

---

## User profile

### Instrument and transposition
The user plays **Bb tenor saxophone**. Unlike Bb clarinet/trumpet (which sound a major 2nd below written), **Bb tenor sax sounds a major 9th (14 semitones) below written**:

- Written B4 (MIDI 71) → concert A3 (MIDI 57)
- Written D5 (MIDI 74) → concert C4 (MIDI 60)
- Written C4 (MIDI 60) → concert Bb2 (MIDI 46)

Internal data is concert pitch. The saxophone physically produces concert frequencies, so pitch trackers read concert MIDI directly — the conversion is purely cosmetic (display layer only).

Mistake to avoid: assuming "Bb instrument" always means "major 2nd transposition." It does for clarinet, trumpet, and soprano sax; it does NOT for tenor sax (major 9th) or bass clarinet (major 9th).

---

## Working agreements (lessons distilled from past sessions)

### Eliminate warnings wherever possible
Builds, tests, and CI output should be warning-free as far as possible. A constant stream of warnings buries real signal and trains everyone to ignore the log. When a tool emits a warning on every run (e.g. sentry-vite-plugin's "No auth token" in token-less CI e2e builds, silenced 2026-07-14 by gating `autoUploadSourceMaps` in `vite.config.ts`), either fix the underlying cause or configure the tool so the warning legitimately doesn't apply — don't leave it to scroll by.

**How to apply:** When you introduce or notice a recurring warning in build/test/CI output, treat it as a defect: silence it at the source in the same change, or flag it explicitly if out of scope.

### Display written pitch in the UI — never concert
Every key, note, pitch class, or tonality label rendered in the UI must be in the user's written pitch. This applies everywhere: home page tonality labels, practice/scales headers, key selectors, chord charts, progress displays, session reports, lick card tags, diagnostics. No exceptions.

**Why:** The user is a transposing-instrument player. Concert pitch is canonical internally; the user never wants to see concert pitch on screen. This error has recurred many times.

**How to apply:** Before displaying ANY key or pitch, call `concertKeyToWritten(key, getInstrument())` or `displayRoot()`. When reviewing or writing template code, flag any raw `PitchClass` rendered without going through that conversion.

### Metronome beat 1 must use kick drum (all branches)
Beat 1 must always use the kick (`MembraneSynth`), not ride cymbal. Both the finite metronome and the infinite-loop branch (used during recording) must do this — the infinite-loop branch has previously regressed to ride-only.

**Why:** Without a distinct downbeat, the bar boundary is hard to feel while recording.

**How to apply:** When touching `scheduleMetronome()` or adding new metronome patterns, verify ALL branches use kick on beat 0.

### Always follow the design system
Mankunku has a written design system at `documentation/architecture/design-system.md`, but the spec doc has drifted from what's actually implemented. Treat `src/app.css` as ground truth for current color values and `src/routes/+layout.svelte` as ground truth for the `data-domain` route mapping — read the code before making any color, layout, typography, or styling change.

Durable principles (won't go stale as values evolve):

- **Three color domains** — Ear Training, Lick Practice, Neutral — all controlled by a single `--color-accent` CSS variable, switched via a `[data-domain]` attribute on the layout root.
- **Single-variable theming**: never hardcode hex values, Tailwind color classes (e.g. `text-blue-500`), or new CSS variables for accent purposes. Use `var(--color-accent)` / `var(--color-accent-hover)` and let the data-domain override do the work.
- **Subtle, not decorative**: backgrounds, text colors, layout, spacing, typography, and component shapes stay constant across domains. Only the accent variable changes.
- **The `practice` tag's star icon on `LickCard`** is a semantic marker for the tag, not a mode-accent color — it uses its own hardcoded color regardless of the surrounding domain.
- **Light + dark parity**: every domain override needs both `:root [data-domain='…']` and `:root.light [data-domain='…']` rules.

**Why:** The user defined the three-domain system on 2026-04-09 to make Ear Training and Lick Practice visually distinct without making them feel like two unrelated apps. The structural rules above are stable; the actual palette has evolved.

**How to apply:** For the structural rules, enforce. If a request would deviate from them, push back and propose a spec amendment. For specific color/route values, look them up in `src/app.css` and `src/routes/+layout.svelte` rather than trusting a snapshot in this file.

**Open item (2026-07-28, PR #181):** white text on accent fills fails WCAG AA on some domain/theme combinations (≈3.96:1 on default teal; worst on dark-mode neutral slate). Proposed fix parked for user decision: a `--color-on-accent` token per domain × theme, enforced by `tests/unit/ui/design-token-consistency.test.ts`. Until decided, `text-white` on accent fills remains the standardized convention.

**Spec status (2026-04-20):** `documentation/architecture/design-system.md` was rewritten to match the current implementation — three-domain palette (peacock teal / terracotta / slate), brass decorative tokens, on-air red, Fraunces display serif, `.jazz-rule`/`.smallcaps`/`.grain-overlay` utilities. Before making design changes, still read `src/app.css` and `src/routes/+layout.svelte` — they remain ground truth.

### Never leave a bug unfixed — failing test first, then fix (TDD is a core tenet)

Every bug found during a session gets fixed in that session. The required order is **test first**: write a test that fails *because of the bug*, watch it fail, then fix and watch it pass. Then revert the fix once to confirm the test is load-bearing — a test that passes without the fix proves nothing.

This covers bugs found **incidentally**: pre-existing failures, bugs in other subsystems, latent issues spotted while reading. "Pre-existing, not from this branch" explains where a bug came from; it is never a reason to leave it. Neither is "outside the scope of this task."

**Why:** Reporting a bug without fixing it hands the work back to the user and lets real defects pile up behind a note that reads as though it were handled. The expensive part of a bug is *finding* it; leaving it unfixed throws that away and makes the next person pay for the discovery again. Test-driven development is a key tenet of this project, not a stylistic preference.

**How to apply:** On finding any bug, write the failing test before the fix. Never claim work complete with known bugs outstanding — if something truly can't be fixed now, say so prominently rather than burying it in a summary.

### Write tests for new functionality (especially at framework/storage boundaries)
**Why:** PR #40 added metadata to `saveRecording` without a test verifying the metadata could be persisted to IndexedDB. Svelte 5 `$state` proxies can't be `structuredClone`d, so every recording save silently failed in production for a day. A simple test would have caught this.

**How to apply:** When adding new parameters, data paths, or persistence changes, write a test that exercises the full save→retrieve round-trip with realistic data shapes — especially at framework/storage boundaries (Svelte runes → IndexedDB, reactive state → postMessage, etc.).

### No Claude Code attribution in issues / commits / PRs
Never add `Co-Authored-By: Claude…`, "Generated with Claude Code", or any similar attribution to issues, commit messages, PR descriptions, or PR comments (including autofix summary comments).

**Why:** The user explicitly requested this. They don't want automated tooling attribution in their repository's public record.

**How to apply:** Strip attribution from default commit/PR templates before posting. Applies to `gh issue create`, `gh pr create`, `gh pr comment`, `git commit`, etc.

### Create PRs from the current branch
When the user asks to create a PR, base it on the branch they're currently on. Don't create a new branch.

**Why:** The user prefers to stay on their working branch.

**How to apply:** "Commit and create a PR" → commit on current branch, push, open PR from that branch. Only create a new branch if explicitly asked.

### Skip redundant git checks; chain add, commit, and push
When changes are already known from the current conversation, skip `git diff` / `git log` and chain `add`, `commit`, and `push` in a single Bash call.

**Why:** The bottleneck is model inference time between tool calls, not git itself. Fewer calls = fewer inference rounds = dramatically faster. A trivial commit+push once took 8 minutes because of unnecessary sequencing.

**How to apply:** `git add <files> && git commit -m "..." && git push` in one shot. Parallelize independent reconnaissance calls. Chain dependent ones.

### CodeRabbit autofix — fetch all comment sources
The GraphQL `reviewThreads` query only returns inline diff comments. CodeRabbit also posts:

- PR review bodies (`reviews` endpoint)
- Outside-diff comments
- Top-level PR comments

**Why:** Missed valid CodeRabbit findings on PR #28 because only inline review threads were queried.

**How to apply:** Use multiple API calls covering all comment locations, or ask the user to paste any missed comments.

### Proactively autofix CodeRabbit comments after every push, and keep iterating until clean
After any `git push` to a PR branch — including the autofix commits themselves — automatically wait for CodeRabbit's review to complete (~2-5 min), fetch ALL comment sources, and fix the valid ones. After pushing the fixes, **wait for CodeRabbit's next review pass and repeat**; CodeRabbit will often have follow-on comments triggered by the previous fix or duplicates it didn't surface in the first round. Continue until a review pass produces no actionable comments.

**Why:** The user doesn't want to manually trigger autofix every time, and doesn't want to be the one watching for follow-on review rounds.

**How to apply:**
- Poll for CodeRabbit review completion after every push (including autofix pushes).
- Check all comment sources (inline `reviewThreads`, review bodies via `reviews`, top-level PR `comments`, outside-diff comments).
- After applying fixes, push, then loop back to polling. Stop when a review round produces no new actionable findings.
- **Resolve the inline review threads** for issues that were actually fixed via the GraphQL `resolveReviewThread` mutation — keeps the PR view clean and signals to the user (and to CodeRabbit's next pass) that the finding is addressed.

---

### Navigation failure & recovery reality (2026-07-25)

**What:** Dead menu clicks ("prior screen stays loaded") were: dev = stale-module-graph 500s from a days-old dev server crossing renames; prod = stale chunks + clicks racing the deploy's PM2 restart gap. The amplifier was our own recovery: `location.reload()` in `handleError` re-renders the page the user was LEAVING (SvelteKit commits the URL only after loads resolve). Recovery now full-page navigates to `event.url` (the click target) — `navRecoveryAction` in `src/lib/util/stale-chunk.ts`.

**Standing facts (verify before relying on the old assumptions):**
- **Pool hydration** (f3560b8): release.sh hardlinks pooled chunks into each staged release's client dir, so Node itself serves prior releases' chunks — the nginx pool alias never went live on the box and is now optional. Takes effect once merged to main; the first such deploy backfills from the existing 555MB pool.
- Sentry debug-ID injection changes **every** chunk hash on **every** build — a one-line deploy invalidates the entire open-tab world; the pool + hydration is what absorbs that.
- **PWA removed** (534ac67): @vite-pwa/sveltekit is gone (its worker was never registered by SSR pages AND threw mid-eval on `createHandlerBoundToURL('/')`). `static/manifest.webmanifest` keeps installability; `static/sw.js` is a kill-switch that exorcises legacy zombie SWs — **keep it deployed indefinitely**. Real offline support = prerendered shell + injectManifest + explicit registration; never resurrect the old generateSW config.
- Root `+error.svelte` now exists; before 2026-07-25 the app had NO error boundary and failed navs were invisible.
- After large file renames, **restart `npm run dev`** — a long-lived dev server's stale graph kills all navigation in open tabs.

---

### Tune editor: MuseScore-style rail + implicit paging (2026-07-26)

**What:** `/tunes/editor` is a two-column layout: sticky 16rem left entry rail (desktop) / fixed bottom dock (mobile, collapsible), chart-first main column. The ≤4-bar page selector is GONE — clicking any note/rest/bar in the chart moves the cursor (`cursorToFlattened`/`cursorToBar` in tune-entry), entry auto-advances across page/section boundaries with split-with-tie, and chords are typed directly onto the chart (beat hit-zones + inline input; Space advances, `k` opens from a selected note). `ChordEntryPanel.svelte` is deleted.

**Standing facts:**
- The step-entry 4-bar cap still exists and is still load-bearing for the lick editor — it's hidden, not lifted. All tune-side entry goes through `tuneAddNote`/`tuneAddRest`/`tuneEnterTiedNote` wrappers; raw step-entry calls in the tune editor are a bug (they bypass auto-advance and the entry cursor).
- abcjs facts that shaped the design: clickListener only fires within 12 SVG units of a glyph (empty-space clicks need the hit rects); responsive mode is viewBox-based so SVG-appended rects rescale for free; hit rects must swallow mouse AND touch events (abcjs binds touchstart/touchend to the same proximity dispatch).
- `tuneToAbcWithMap` returns `{ abc, noteAnchors, barAnchors, chordSlotAnchors }` — golden tests pin the ABC byte-identical; `phraseToAbc` untouched (hard rule). Geometry math lives in pure `src/lib/notation/chart-geometry.ts`; abcjs adaptation in `src/lib/notation/abcjs-adapter.ts`.
- The shared panels reflow via Tailwind 4 container queries under named `@container/entry` wrappers — inert in the lick editor (no named container ancestor). Panel action props (`onAddNote` etc.) default to raw step-entry; only the tune editor passes wrappers.
- Cursor-mode entry: overwrite rests, block on pitched collision, section-level occupancy, window-fit guard (the section-end overhang fix — final review's one blocker).

### Tune chart chord symbols: MuseScore-height drop pass (2026-07-28)

**What:** abcjs anchors every chord in a system above the tallest ink of the WHOLE line (`set-upper-and-lower-elements.js` — one high bar lifts every chord; no option exists to change it). The app corrects this post-render: `chordSymbolDeltas` (pure, abcjs-adapter) drops each chord to MuseScore's default — baseline 2.5 staff-spaces above the top line (measured from the user's own .mscz styles/PDFs) — pushing a chord up only over x-overlapping ink, with 0.5-space clearance. Applied in NotationDisplay's `dropChordSymbols`, strictly BEFORE `buildHitZones` so band geometry measures final positions.

**Standing facts:**
- Every voice-H chord `<text>` is a CHILD of that segment's `g.abcjs-rest` group — even for invisible `x` spacers. Any transform on the group moves the chord with it; `normalizeChordVoiceRests` therefore shifts only the group's non-text children. This coupling was the hidden 2-extra-spacings bug that made all app chords ride high even on flat systems.
- `getBBox()` is local (excludes own AND ancestor transforms); client rects include everything. Post-render passes that set transforms must keep the two spaces straight — measure obstacles/staff in untransformed local space only while ancestors are untransformed.
- Regression pins: unit describe `chordSymbolDeltas` in abcjs-adapter.test.ts (per-chord independence, clearance, push-up-only, bracket veto); e2e `tune-chord-height.spec.ts` (high-bar tune, scale-invariant staff-space assertions).
- **Stems (2026-07-28):** declaring a second voice WITHOUT `stem=` makes abcjs's `createVoice` (parse/tune-builder.js) splice a forced stem-up event into the MELODY voice — the two-real-voices convention, triggered purely by voice count. The header's `V:H stem=down` keeps `params.stem` truthy so that splice never happens and M gets pitch-based auto stems (head at/above middle line → down, below → up; on-line → down — matches MuseScore). Deliberate variance: abcjs decides BEAMED groups by the group's average pitch vs the middle line, MuseScore by the furthest note — user accepted the abcjs rule (2026-07-28). No `stem=auto`, `%%stemdir`, or inline stem directive exists in abcjs; don't go looking. E2E pin: `tune-stem-direction.spec.ts` (self-classifying rule check over every rendered stem).

### Backing-track engine: seeded, section-aware, per-bar (2026-08-02)

**What:** Backing generation lives in pure `src/lib/audio/backing-generation.ts` (Node-testable, no Tone/smplr); `backing-track.ts` only schedules. All randomness is seeded per (role, position) — `seedFrom(phraseId, tempo, 'bass'|'comp'|'drums'|'voicing', index)` — so replays are byte-identical and no generator's edits can shift another's output (independent streams, not one threaded stream).

**Standing facts:**
- `StyleDefinition.drumPattern`/`compPattern` are per-BAR functions: `(ctx: GenerationContext) => hit[]` with fractional `beatOffset`s. Per-beat callbacks can't state Charleston/spang-a-lang/anticipation figures — don't regress to them.
- Swing applies at beat→tick conversion (`applySwingToBeats`; x.5 offsets land late), seeded jitter layers on top. Effective swing = `options.swing > 0.5 ? options.swing : style.defaultSwing` (session default is straight, so the style default is what usually swings the backing).
- Drums are a `Tone.Part` (tick-placed events), NOT a `Sequence` — swung skip eighths need tick placement. The coverage/supersede tests identify the drum part by its events carrying a `drum` field.
- `Phrase.sectionMap` (optional) flows from `tuneToPhrase` → engine; `buildBarInfos` derives sectionIndex/chorusIndex (chorus = sourceSection restart) and section-final bars (drum setup figures, comp density). Lick/ear-training phrases have none → flat fallback, no setups.
- Off-beat comp hits voice the chord at the NEXT beat (anticipation). Bass reads real chord tones via `chordToneIntervalsForBass` (natural 5th preferred over 7#11/7b13 colour; 6th chords walk the 6th). Rootless voicings read tensions straight from `CHORD_DEFINITIONS`.
- **Control-byte hazard is now a triple recurrence** (Edit 07-30, Write and a Bash heredoc 08-02): tools emitting escape-adjacent strings can land literal 0x00/0x1f bytes. Symptom: Edit can't match a line grep shows. Check with `od -c` / `file`; the Bash validator sometimes catches it, the Write tool does not.

### Documentation has four surfaces, not one (2026-08-01)

Adding or changing a player-facing doc means touching up to four places. Missing any one leaves the docs *internally* consistent and externally wrong, which is the hardest kind to notice.

1. **`documentation/*.md`** — the file itself. Also the developer docs; `documentation/README.md` is the index and carries the "last major docs update" note.
2. **`src/lib/docs/structure.ts` (`DOC_TREE`)** — the musician-facing subset surfaced at `/docs`. A slug absent here **404s**, so a new page is invisible until registered. Also feeds the sitemap.
3. **`src/lib/docs/context.ts` (`CORE_DOC_SLUGS`)** — what the docs assistant gets as system context. Deliberately small (tokens per request), but a whole feature area missing here makes the assistant answer "not documented" — the exact failure the build-time bundling was added to fix (Sentry MANKUNKU-N). Both tune pages are in as of 2026-08-01.
4. **`src/lib/tour/tours/*.ts`** — tour copy is user-facing prose that *no* docs audit looks at and no test or type-check validates. It went stale unnoticed (a lick category listed as a progression type; superseded tempo thresholds). Same blind spot covers empty states, error copy, and onboarding.

Markdown is bundled via `import.meta.glob` at build time in **both** the `/docs` route loader and `context.ts` — reading from `process.cwd()` fails in prod because the deploy ships only `build/`.

Audit direction matters: enumerate the product from `src/routes` + `src/lib` and ask "where is this documented". Reading the docs and asking "is this still true" finds drift but is structurally blind to *absence*, which is the larger failure. Cross-check docs against each other too — a contradiction between two pages is worse than either being wrong alone.

### OMR subsystem: LEGATO 2 unreleased, v1 is chord-blind (2026-08-09)

**What:** `omr/` is a standalone uv-managed Python 3.12 subsystem (first Python in the repo) for lead-sheet OMR, built to receive LEGATO 2 — which is **paper-only** (arXiv:2607.05769; "code upon publication"; the gated, unlicensed `legato-1.5` HF uploads are NOT a release). `Legato2Backend` is a documented stub; `LegatoV1Backend` (vendored MIT code, pinned checkpoint `guangyangmusic/legato@2d07c5d`) is experimentation-only.

**Standing facts:**
- **LEGATO v1 transcribes no text** — `<|text|>` replaces titles, annotations, AND chord symbols (chords are quoted text in ABC). Benchmark chord metrics ≈0 by design; the standing `TEXT_ELIDED_BY_MODEL` warning encodes this. The text-aware tokenizer is the LEGATO-2-only capability this app most needs.
- Everything depends on the `OMRBackend` protocol, never a concrete engine; raw output is preserved verbatim; the normalizer records only what is printed (absent = None; Db never respelled to C#); validation flags, never rewrites; debug dirs never fabricate (no `systems/` for whole-page models).
- Real inference needs **TWO gated repos**: `guangyangmusic/legato` (gate "auto" — accept + go) AND `meta-llama/Llama-3.2-11B-Vision` (Meta license form; the 429MB checkpoint stores only the decoder — the frozen vision encoder streams from Meta's repo at load time, several GB). The backend loads from a `snapshot_download`ed local path because passing `revision=` to `from_pretrained` propagates into the meta-llama fetch where our pin doesn't exist (regression-pinned in `test_legato_v1.py`). Unit suite is hermetic (no torch — the `legato` extra is separate); model tests behind `pytest -m omr_integration`. CI runs the hermetic suite via the `omr-changed` path filter (mirrors `nginx-changed`); no HF token in CI ever.
- Ground truth is **written pitch as printed** (tenor rule: written = concert + 14 semitones). The converter deliberately emits NO rehearsal marks — section labels are an app concept, not printed ink (my converter initially invented marks; the printed page falsified it). Converted GT stays `"reviewed": false` until human-reviewed; A-Train's boxed A/B/A marks were added from the page.
- **First recorded baseline (2026-08-09, CPU ~36s/page)**: melody MIDI 94.8%, rhythm 96.8%, measure alignment 73/73, keys/meters 100%, repeats F1 1.0 — chords 0/60 and marks 0.0 (text elision, as predicted). Typeset-jazz melody is NOT the weak spot; text is the whole gap. Baseline: `docs/omr/benchmark-2026-08-09-legato-v1.md`.
- **MPS is unusable on torch 2.6 for this model**: generation SIGABRTs the process (LLVM shape-inference failure in `mps.matmul`, Mllama cross-attention) — uncatchable, so `auto` never selects MPS (regression-pinned). Also: a `cmd | tail` pipeline's exit code is tail's — a silently killed upstream reads as success.
- **Hybrid import shipped (2026-08-10)**: the import page fuses an attached `.omr.json` (melody, via `src/lib/tunes/import/omr-transcription.ts` → the same `ModelBar` seam Claude fills) with text-layer chords + geometry bars; covered systems make ZERO API calls, and keyless servers can import via OMR alone. Recorded vs MuseScore refs: melody 0.887/0.956/1.0 (Claude floors were 0.55/0.6/0.5), chords exact-position 2/3, A-Train full form strict. The fused-fixture recorder is COMMITTED and env-gated (`RECORD_OMR_FIXTURES=1`) — never let it run un-gated in CI, it writes fixtures. OMR floors live as `omrFloors`/`omrKnownDefects` in `tests/helpers/leadsheet-corpus.ts`.
- Watch list for the LEGATO 2 release + definition-of-ready: `docs/omr/legato2.md`.

## Reference map

- **Design system spec**: `documentation/architecture/design-system.md`
- **Architecture overview** (with module dependency diagram): `documentation/architecture/overview.md`
- **All architecture docs**: `documentation/architecture/` (audio-pipeline, data-model, scoring-algorithm, state-management, tech-stack, tonality-system, adaptive-difficulty, phrase-system, tune-system, lick-alignment, pitch-rhythm-coupling, design-system)
- **Player guides**: `documentation/getting-started.md`, `user-guide.md`, `tunes.md`, `tune-practice.md`
- **PRD**: `PRD.md`
- **Project conventions**: `CLAUDE.md`
- **Independent observations**: `CLAUDIUS/observations.md`
- **Sessions log**: `CLAUDIUS/SESSIONS.md`
