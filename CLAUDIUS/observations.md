# Independent Observations

Running notes from working on Mankunku. Newest at the top. Not deleted unless proven wrong — patterns only become visible over time, so keep the trail.

---

## 2026-08-12 — Every click-contamination heuristic is stressed exactly where music happens

The whole fixture family now tells one story from five angles: curl-to-the-floor,
blue-note-climb, down-to-the-third, and today's repeated-Eb pair are all the SAME
collision — a musician articulating **on the beat**, which is both where they are
trained to play and where the metronome emits the one signal our tiers must
distrust. The suppression window isn't paranoid; clicks genuinely fake every
HF-tier gate. But its blast radius is centred on the musically correct instant,
so its false-negative population is not random takes — it is specifically the
takes of a player with good time. The better the user's timing, the more the
scorer used to punish them. That inversion (accuracy punished as contamination)
is worth watching for in any system that discounts evidence near a scheduled
event: the discount lands precisely on the behaviour the system exists to reward.
CLAUDE.md already crystallised the principle as "the beat is exactly where notes
start"; today extended it from the gap tier to the HF tier, and I'd now phrase
the general rule as: **a suppression keyed to a schedule needs a rescue for each
physical signature the scheduled event cannot produce** — the horn silenced
in-band (band-floor dip), the horn stopped-then-restarted (stop-recover), the
reed reshaped without the air ever stopping (shallow shape band). When the next
false merge arrives, the question is not "which threshold moved" but "which
signature is still missing a rescue."

Second keep, methodological: when two takes fail identically, assume nothing —
they failed on DIFFERENT gates (one suppressed, one disbelieved). Had I fixed
only the suppression (the shared, obvious cause), slide-back-down would still
have died on the 0.9 sustain floor and blue-note-roll-off on the perturbation
gate, and the "fix" would have looked mysteriously partial. The instrumented
corpus sweep cost ~20 minutes and turned both threshold placements from
argument into measurement; I'd previously done this ad hoc (2026-08-01 band
floors), but it should be the default move for any gate in the splitter: the
21-take corpus is a population, and every constant in that file is a claim
about a population.

## 2026-08-08 — Exit codes describe the deployer's actions, not the system's state

The deploy had two opposite blind spots at once, and realising they were the *same* blind spot is the thing worth keeping.

Going one way: the deploy failed loudly, immediately, with a red X on `main` — and production served a two-day-old build because nothing delivered that signal to a human. Going the other way: `pm2 start` returns 0 the moment a process is *spawned*, so a build that crashes on boot leaves PM2 restart-looping while the pipeline reports success. Red-but-unnoticed and green-but-dead look like opposite bugs. They aren't. In both cases the deploy only ever knew whether its own commands exited 0, which is a fact about the deployer, not about whether anyone can load the site. **A pipeline that asserts on command success is measuring itself.** The fix in both directions is the same shape: assert on *observed state* — poll the thing and make it tell you which release it is serving. That's also why the check compares the release id rather than liveness: a stale process still holding the port answers 200 with total confidence, and "is it up?" is precisely the check that would bless it.

A corollary about naive fixes. In both of today's structural changes the interesting half was the *guard*, not the feature. Cleaning up a failed deploy's staged release is obvious; the part that matters is refusing to when `current` already points at it, because after the swap that directory **is** production and the tidy-up would escalate a failed deploy into an outage. Same shape as the smoke check. In both, the naive version isn't merely incomplete — it's worse than nothing, because it manufactures confidence while doing harm. When a fix has a case where it must decline to act, that case is the design.

**Caching doesn't break tests; it voids their premises.** Adding "skip `npm ci` when the lockfile is unchanged" silently hollowed out two existing tests. The npm-failure test injects a failing install — but the install no longer ran, so the deploy succeeded and the test caught it. The flock serialization test proves two installs never overlap — and with the cache, neither deploy installed anything, so it would have gone on passing while asserting nothing at all. The first failed loudly and led me to the second. That asymmetry is the hazard: a skip-optimisation turns some tests red (useful) and quietly empties others (invisible). Both needed distinct lockfiles to restore their premise. Generalising: **when you add a "don't do X when unchanged" path, audit every test whose meaning depended on X happening** — a green suite is not evidence, because the tests that went hollow are exactly the ones that still pass.

Two smaller keeps. First, the cheapest decisive evidence all day was three `git rev-parse` calls: `package-lock.json` was the *same blob* across the last successful deploy and both failures, which collapsed the entire search space from "what did we change?" to "nothing in the repo changed, so it's the machine" before I read any deploy code. When something fails intermittently, find the input you can *prove* is constant. Second, and against my own instinct to declare victory: adding swap and seeing a green rerun is correlation, not proof — the box could have had a quiet moment. `pswpout` (77,123 pages ≈ 301 MB, on a counter that had no swap device to write to beforehand) is what made it causal. **When the fix is "add capacity and retry," the counter showing the new capacity was consumed is the difference between a fix and a coincidence** — and it costs one command.

Last — and this one is a correction of myself, made the same day. I told Andy `@sentry/sveltekit` had a packaging wart: declaring `vite` and `@sentry/vite-plugin` as ordinary `dependencies` and so dragging a bundler and a TypeScript compiler into production installs. He asked me to check whether Sentry had fixed it. **They never had it.** `vite` and `@sveltejs/kit` are `peerDependencies`, and have been across every version I checked back to 8.55.0. The manifest is fine.

What actually happens is npm's: **npm 7+ auto-installs peerDependencies, including peers of *production* dependencies.** `@sentry/sveltekit` is a prod dep, so its peers arrive under `--omit=dev`; `@sveltejs/kit` then brings its own peer `typescript`, and `vite@8` brings `rolldown`. And because those packages are peer-reachable from a prod dep, npm doesn't mark them dev-only in the lockfile, so `--omit=dev` can't drop them — nor, measured, can `--omit=peer` (byte-identical 378 MB). The 156 MB figure was right; the *attribution* was invented. I had the resolution tree in front of me (`npm ls` showed the nesting) and read "appears under X" as "declared by X" without running the one command that distinguishes them.

Underneath that sat a second, worse error of the same kind. I'd built the "what does prod actually need" list by grepping the built output for `from '...'` — which happily matched **JSDoc `@import` comments**, so `@sveltejs/kit` looked like a runtime import and I briefly believed production had a latent landmine. It doesn't: deleting `@sveltejs/kit`, `vite`, `typescript` and `@rolldown` outright and booting the server serves `/` and `/licks` as full SSR HTML with zero module-resolution errors, because adapter-node bundles the framework runtime into `build/server/`. **A grep for imports finds mentions, not dependencies.** The only trustworthy answer to "is this needed at runtime" is to remove it and boot — which cost one container and settled in ninety seconds what two rounds of textual analysis got backwards. Same failure I logged on 2026-07-16 and again on 2026-07-25: confident description standing in for observation, on a premise that was cheap to check.

## 2026-08-01 — Docs rot in two directions, and only one of them is visible

Auditing thirty documentation files against the code, I expected to be correcting sentences. Most of the work turned out to be different in kind, and the distinction seems worth keeping.

**Drift** is a sentence that used to be true: "the app is a PWA," "the bleed filter defaults to on," "rhythm changes is a progression type." It's cheap to find — read the doc, read the code, compare. A grep finds it. It's also the *less* damaging failure, because a wrong sentence in an otherwise-correct page still puts the reader in the right neighbourhood.

**Absence** is the other direction, and nothing in the document signals it. `user-guide.md` was internally consistent, well written, and described an app in which Tunes is a supporting room mentioned in one clause. Every sentence was true. There is no diff, no failing check, no contradiction to notice — the only way to find it is to enumerate the product from the *code* and ask what the docs never say. Six days of feature work produced maybe four correctable sentences and two entire missing pages.

Which suggests the audit procedure has to run from the code inward, not from the docs outward. Walking `src/routes` and `src/lib` and asking "where is this documented" found the gaps; re-reading `documentation/` and asking "is this still true" would have returned a nearly clean bill of health.

Two smaller things I want to remember:

**Tour copy is documentation that no docs audit looks at.** `lick-practice.ts` had been quoting a superseded tempo-gating scheme and listing a lick category as a progression type. It sits in `src/lib/tour/`, so it's invisible to anyone auditing `documentation/`, and it's prose, so it's invisible to `svelte-check` and the test suite. Any user-facing string outside the docs tree — tours, empty states, error messages, onboarding — is in the same blind spot. The tours at least have the redeeming property that they're *read aloud to new users*, which is the worst possible place for a stale number.

**Two docs contradicting each other is a distinct, worse failure than one being wrong.** The bleed filter was described accurately in the glossary and inaccurately in the audio pipeline page. A single wrong statement gets corrected the first time someone tests it; a contradiction teaches the reader that the documentation set as a whole isn't load-bearing, and that inference is much harder to walk back. When auditing, cross-checking docs *against each other* is a cheap second pass that finds a different class of defect than checking each against the code.

---

## 2026-07-30 — "No evidence" almost always means "no evidence in the domain I was looking at"

The previous session searched for the soft G3 re-articulation across five signals — reading gaps, window RMS, `rmsMin`, `hfRms`, clarity — found nothing above threshold in any of them, and concluded the evidence didn't exist. From there it did something reasonable and wrong: it escalated a *detection* dead end into a *product* question ("should the scorer credit an un-rearticulated repeat?"), and both implementations of that question broke standing regressions. The dead end was real; the inference from it was not.

What the five have in common is not one domain — three are RMS reductions, while clarity is McLeod's normalized autocorrelation peak and reading gaps are just clarity falling under threshold, so those two are periodicity, not energy. What all five share is the **93 ms analysis window**. Finding nothing in five views through one window is close to one negative result, not five.

The tell was available the whole time: the user could hear it. A human ear resolving a 20 ms event through a 93 ms averaging window means the ear is using something the window destroys — which points at *time resolution* before it points anywhere else.

And the sharpest version of that: `shapeBreak`, the signal that finally worked, is **clarity's near neighbour**. Both ask "do consecutive periods look alike?" The only material difference is that clarity answers it over 93 ms and `shapeBreak` answers it over 10 ms. The winning signal was sitting adjacent to one already being consulted, separated by a timescale rather than by a concept. That is worth remembering, because it means "we already measure something like that" is *not* evidence that a domain has been covered.

I want to keep the generalization narrow enough to be useful: when a search fails, enumerate what the candidate signals have in *common* before concluding absence. If they share a timescale (the analysis window), a source (the same buffer reduction), or a domain, the search covered fewer hypotheses than it appeared to. And when a human can perceive what the instrument cannot, the instrument's limitation is the finding.

## 2026-07-30 — The discriminator ran backwards, and that's what made it trustworthy

I went in assuming a re-articulation would show a *large* discontinuity and the false positives would be small — so the gate would be "dip deeper than X". The corpus said the exact opposite: the two genuine legato tongues dip to 0.957 and 0.961, while Blue Monk's held E (must not split) dips to 0.33 and metronome clicks to ~0.54. Once stated physically it's obvious and it stops being a fitted threshold: a click *adds an uncorrelated signal*, which drives normalized similarity toward zero in proportion to the energy added; a tongue *modifies an oscillation that never stops*, so it barely moves. Depth measures contamination, not articulation.

That inversion is why I trust this gate more than the numeric ones stacked around it. `SHAPE_CLEAN_BASELINE = 0.975` and `SHAPE_SETTLE_TIME = 0.2` are honest empirical fences and will need revisiting when a fixture arrives outside them. The 0.9 periodicity floor is a statement about what the signal *is*, and the failure mode it guards against — someone lowering it to "catch more articulations" and silently re-admitting every click — is exactly the kind that survives a green test suite. It got a named unit test for that reason.

Worth noting where this leaves the tier stack: five tiers now, each owning a distinct evidence class (silence, envelope dip, HF burst, clarity dip, waveform shape). The 2026-06-21 prediction — "future fixes here will be a new *axis*, not a new threshold" — has now held four times running. The corollary I'd add: the axes are getting *cheaper to justify and harder to find*, which is the healthy direction. This one took going back to the raw samples, and I don't think it was findable from the reading stream at all.

## 2026-07-28 — The notation was encoding the convention all along

The user's correction — "a repeat around the entire song simply outlines the form: head → solo → … → head" — looked at first like it demanded new machinery. It demanded *less*. The expanded flatten of a whole-form-repeat chart (body, ending 1, body again, ending 2) IS the jazz performance already: pass one is the head taking the turnaround ending, pass two is the form again taking the out. All the head feature needed was a boundary — the first *revisited* section in `sectionMap` — and the harmony doubling I'd built became unnecessary for exactly the charts where the head matters most. The doubling survives only for repeat-free charts, where the notation genuinely contains one chorus.

The general lesson: when a domain convention seems to require transforming the data, first check whether the notation already encodes the convention and the code has merely been reading it too literally. "Play the repeat" was the literal reading; "the repeat is the form" was the semantic one — and the semantic reading needed fewer moving parts, not more. This is the same genus as concert-vs-written pitch: the chart is a *notation system* with performance semantics layered on top, and every naive structural interpretation of it is a bug waiting for a musician to notice.

Also filed permanently (user-instructed): head once; ending 1 = turnaround in, ending 2 = out. The tune-practice session now literally performs the form: head over pass one, solo windows only in pass two.

## 2026-07-28 — Detection had to abandon the spec's frame to satisfy the spec's intent

The tune-practice spec said: compute each chord's degree *relative to the tune key* and match degree-shapes (ii=min7 on 2, V=7 on 5…). Implemented literally, that finds zero ii-V-Is in two of our three curated tunes — Mankunku Blues' only ii-Vs are a secondary cadence into the IV key and a cadence that resolves across the repeat barline. The correct detector binds a **local tonic from root motion inside the window** and uses the tune-key degree only as a *label* ("ii-V-I in the IV area"). The spec's own Phase 2 quietly knew this — it says to transpose licks "using the tune's local harmony root" — but its Phase 1 wording would have built a detector that starves Phase 2 of anything to transpose. The general shape: when a spec's phases disagree, the downstream phase usually encodes the real requirement, because it's written from the consumer's seat. Worth checking phase N against phase N+1's inputs before building N.

Two adjacent musical facts that will matter again: in blues, the tonic is a *dominant seventh* — any "resolution quality" set that only admits maj7/maj6 silently fails on the genre this app is named for; and plain major triads reach the detector as `maj6` because `chordSymbolToQuality` maps them there for comping. Quality sets over the closed enum have to be written against what the *parser emits*, not against what a theory book says.

## 2026-07-28 — The persisted-mastery shape dictates product language, not vice versa

"Show whether the user knows this lick in this key" sounds like a UI task until you look at what's actually persisted: per-key `passCount`/`tempo`/`lastPracticedAt` and a separate unlock count — no score anywhere. So "known/learning/unknown" had to be *derived* semantics: known = has passed at the 0.9 bar in that key; learning = attempted there, or inside the lick's unlock ramp; unknown = everything else, including a never-practiced lick's own entry key. The subtle trap we dodged: "any progress → learning" would have marked a lick practiced only in C as "learning" in F#, a claim the data cannot support. When the store can't express a distinction, the honest move is to narrow the product claim to what it can — the unlock ramp turned out to be the exact right fence, and it already existed.

Same session, same lesson from the other side: category overrides turn out to be **write-only at read time** (no consumer ever applies them), so the matcher keys off `prog:*` tags. That's now the second consumer (after lick-practice) whose correctness depends on tags-not-categories. The category field increasingly looks like display metadata wearing a data-model costume.

## 2026-07-28 — A render effect that reads a prop is a contract, not an implementation detail

NotationDisplay's render effect reads `selectedIndex`, so every selection change re-runs `renderAbc` — a full SVG rebuild. Fine for click-selection; fatal for a per-note playback cursor. The fix wasn't to optimize the effect but to *route around it*: cursor and markers live on dedicated effects over stashed per-render caches (anchors, visualObj, bar zones), and the render effect must never read the new props. The fragile part is that this invariant is invisible — one innocent `rangeMarkers` read inside the render effect silently reinstates per-note rebuilds with no error, just jank. I left a comment naming the contract and an e2e that asserts marker rects exist; a stronger guard (asserting SVG node identity across cursor moves) needs a running session, which our e2e layer deliberately doesn't do. This is the same genus as the tick-based-visuals rule from 2026-04-16: the boundary holds only as long as every future author knows it exists.

## 2026-07-28 — Mirrored IA without mirrored components guarantees drift

The licks/tunes restructure (2026-07-25) made the two trees structurally symmetric — same routes, same verbs, same page roles — but the tunes pages were written months apart from the licks pages, by different sessions, without a shared component or class recipe for "header action button", "empty-state card", "accent CTA". A 72-finding audit shows the result: every seam where the two trees should rhyme (button shape, section headings, card titles, error states) diverged, and the divergence isn't random — it's two internally-consistent dialects. Licks speaks pill-buttons/`accent-hover`/`text-white`/Fraunces-card-titles; tunes speaks rounded-rect/`hover:opacity-80`/inherited-text/sans-titles. Each was locally coherent, which is exactly why nobody noticed while writing.

Two sharper points under this. First, **structural symmetry raises the cost of visual asymmetry**: before the rename, licks and lead sheets were different features and drift read as difference; after the rename made them siblings, the same drift reads as sloppiness — the restructure implicitly promised a consistency the CSS never delivered. Second, the audit surfaced a class of finding that isn't drift at all but latent bugs wearing drift's clothes: `--color-bg-primary` (a token that has never existed — hover silently computes to transparent), `text-black` on a fill that darkens in light mode, accent fills inheriting near-black text in light mode. **Copy-adjacent code without a shared source of truth doesn't just diverge, it invents tokens** — the author pattern-matched `bg-secondary`/`bg-tertiary` to a plausible `bg-primary` and nothing failed loudly. A tokens-that-exist lint (grep `var(--color-` against `app.css` definitions) would catch that class mechanically; worth proposing if drift cleanup lands.

The direction question has a non-obvious answer, too: neither side simply wins. Licks carries the documented conventions (design-system utilities used as app.css comments describe), but tunes contains genuine improvements made later (flex-wrap on crowded header rows, `type="search"`, explanatory subtitles, smallcaps section labels). Standardize on the *older* side by default and you'd erase newer judgment; on the *newer* side and you'd canonize its contrast bugs. The audit's per-finding "which side should win" was the actual work product, not the finding count.

---

## 2026-07-22 — Reuse by shrinking the problem to fit the tool, not stretching the tool to fit the problem

The lead-sheet editor needed long forms; the existing melody-entry buffer maxes out at four bars, deliberately. The obvious move was to lift the cap — touch `setBarCount`'s clamp, the capacity math, the status bar, and accept that the lick editor now carries lead-sheet-sized state. The better move, hiding in one word of the spec ("paging"), was to leave the tool alone and cut the problem into tool-shaped pieces: a section is edited one ≤4-bar page at a time through the UNMODIFIED buffer, and the section list — plain data, no reactivity constraints — is the real document. Every entry component, the keyboard map, the range validation, the accidental logic came along for free, and the lick editor's invariants were never at risk. The general form: **when a constraint in a shared component looks like the obstacle, first try shrinking your working set to honor it; the constraint is usually load-bearing for someone else.**

The cost of that design is an ownership rule: while a page is loaded, the buffer owns that window, and writing to the section list underneath it is undefined. My own test violated it (seeded sections directly, then watched a commit "eat" a note) and my first instinct was to blame the commit. The commit was right; the test used a door that doesn't exist in production. Worth naming: **an ownership invariant binds tests too — a test that mutates state through a path the UI can't reach isn't testing the system, it's testing a hypothetical one.** The fix was to route the test through the real hydration API, which also made it a better test.

Two smaller keeps. The written-pitch discipline caught ME: I asserted the chart would show "Gm7" after selecting written G, but the ii of written G is Am7 — the exact error class this project's memory warns about, committed by the entity that wrote the warning into the test suite an hour earlier. The rule survives because the tests enforce it, not because anyone internalizes it permanently. And the importer fixtures: the iReal unscrambler is an involution, so the temptation was to generate test input with the function under test — agreement by construction. Writing the scrambler into the TEST from the published reference instead means both sides pin to the spec; if I mistranscribed the algorithm, the hand-computed spot-checks (position 0 takes char 49) fail rather than agree. **When an algorithm is its own inverse, independent fixtures require a second implementation from the source document, plus at least one assertion a human can verify by counting.**

---

## 2026-07-21 — An invariant that holds because the content happens to match is not an invariant

Removing the progression line from the home page's Side B panel made its stat block two lines, matching Side A's two, and the two Continue buttons lined up. That is a true sentence about one state of the data and a false sentence about the feature. A fresh user gets one line on Side B against Side A's two, and a tagged-but-unpracticed set gives the same 1-vs-2. The buttons were staggered by 38px and 20px in those states — measured, after restoring the pre-fix file, not inferred.

The distinction worth keeping is between a property that *obtains* and a property that is *enforced*. Content-driven layout gives you the first: the buttons align when the line counts happen to match, and the alignment silently expires the next time someone adds a stat line, or a user reaches a state nobody screenshotted. `mt-auto` in a flex column gives you the second — the button is at the bottom because the layout says so, and no future edit to the copy above it can change that. The same shape shows up in the stub-cloud fixture (2026-07-19): **a value restated is a value that decays; a value derived stays true.** Here it's a *position* rather than a value, but the failure mode is identical, and so is the tell — the property was true when written and nobody wrote down what it depended on.

What made this catchable was enumerating the states rather than looking at the one on screen. I had the "pleasing side effect" claim in hand and it was pleasant enough to be worth checking, which is roughly the right instinct: **a claim that arrives as a bonus has had no scrutiny applied to it, because nobody asked for it.** The cost of checking was reading two `{#if}` branches.

Second, smaller, on process: I flagged the caveat and named the fix instead of either doing it unasked or staying quiet. The user's reply was two words. That exchange cost less than the alternative in both directions — a silent scope expansion I'd have had to justify, or a bug shipped behind a claim I'd already half-retracted. **The flag is cheap precisely when you can state the fix in one clause**; if it takes a paragraph to describe, it's a design conversation, not a flag.

---

## 2026-07-19 — The await must come before the commitment, and one of the three bugs had already fixed itself

Three long-open bugs, taken TDD. The most interesting thing is that they failed in three *different* ways relative to their write-ups, and only one matched its note exactly.

**The race was real and the obvious fix was a trap.** `scheduleBackingTrack` created and *started* the bass and comp Parts, then hit `await ensureDrums()` and a supersession bailout — so being superseded mid-load left bass and comp playing over no drums. The obvious repair, hoisting the await above the part creation, would have traded it for something worse: `startBackingTrack` turns out to be **imported but never called**, so the kit was only ever loaded lazily *inside* scheduling, and a cold sample fetch in front of the first audible commit could push bass and comp past their absolute `tickOffset`. The fix needed two halves — hoist the await *and* preload the kit with the pitched instruments, so the hoisted await is a microtask on every real path. The generalisable rule: **every await must sit before the first irreversible commitment, and making that true usually means moving the slow work earlier, not moving the checkpoint later.** A bailout that can fire after you've already made noise isn't a bailout.

**The second bug was real but my test fixture was wrong in a way only running it revealed.** I wrote a phrase with `duration: [1, 4]` chords meaning "one bar" — but fractions here are in *whole notes*, so `[1,4]` is a quarter note and my two-bar harmony was two beats. The test went red for the wrong reason (4 drum beats, not 8), which is the only reason I caught it. Had I written a fixture that happened to be red for a plausible-looking reason, I'd have "fixed" the code until my wrong fixture passed. **A red test is not evidence until you have read the failure message and confirmed it fails for the reason you predicted** — the number in the error mattered more than the colour.

**The third bug had already been fixed by a change made for another purpose, and my notes hadn't noticed.** Case 2 — anonymous licks absorbed into the next account to sign in — was closed by PR #164's per-user storage namespacing, which is *literally candidate fix #3 from my own write-up of it*, adopted for unrelated reasons. My memory still said "unfixed." Two lessons. First, the memory file carried a `verify against current code` warning and it was right: **notes describe the code on the day they were written, and a fix can arrive sideways.** Second, and sharper: I could only *prove* it was fixed by writing a control test. An assertion that "the anonymous lick was not pushed to the cloud" is worthless if the push path was dead in that scenario — absence of evidence again, the shape this codebase keeps producing. So the spec ships with a control that seeds the same lick into the signed-in bucket and asserts it *is* pushed. **Every negative assertion needs a positive twin proving the detector is live**, and I should reach for that reflexively rather than after noticing the gap.

Worth carrying forward: the isolation fix silently dropped the *legitimate* half of the behaviour — offline-entered licks no longer migrate into a first account, they strand in the anon bucket. Nobody chose that; it fell out of a storage-layout change. **When a structural fix closes an abuse vector, check what legitimate flow used the same road.**

---

## 2026-07-19 — A test suite that is green in CI and red on every dev machine is worse than a red one

Three cloud-convergence specs had been failing locally while passing in CI, and the split was structural, not flaky. `tests/e2e/fixtures/stub-cloud.ts` hardcoded `https://ynzfliunzejusnlvpeey.supabase.co` and keyed Playwright route interception off it. When the project moved dev onto a local Supabase stack (2026-06-21, to stop dev/prod data contamination), `.env` began setting `PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, the production build under test baked *that* in, and no browser request ever matched the intercept. CI still passed because there `PUBLIC_SUPABASE_URL` is a CircleCI project-level variable holding the production URL. So the fix for one problem silently disabled the tests guarding another — and the signal that would have said so was inverted: CI green.

The durable point is about **which environment a test's assumptions are pinned to**. A fixture that hardcodes any build-time-configurable value has quietly asserted "the build will be configured the way it was the day I wrote this." That assumption is invisible, untested, and decays the moment configuration becomes environment-specific — which is exactly what adopting a local dev stack does, deliberately, everywhere at once. The fix was to resolve the URL the same way Vite resolves it (`process.env` first, then `.env`, then a default) and to derive the project ref by supabase-js's own rule rather than restating it as a constant. Both bugs were the same bug: **a value restated instead of derived**. The auth cookie name `sb-<ref>-auth-token` had been hardcoded too, and was equally wrong for any non-production host.

Second keep, sharper than the first: **"passes in CI" is not evidence a test works.** It is evidence the test works *in CI's configuration*. When CI and local diverge in configuration on purpose — and here we made them diverge on purpose, for good reasons — every test that hardcodes configuration silently changes meaning in one of the two places. The version that keeps running is the one nobody is watching, because the humans are looking at local output and the machine is looking at CI. I found this only because I ran the full e2e suite locally to check I hadn't regressed something, which is not a habit I can rely on catching it next time. Worth a standing question when touching environment config: *which tests encode the value I am changing?*

Third, on process, and it is the thing I got wrong before I got it right. I found these three failures, verified they were pre-existing, checked they also failed on `origin/main`, wrote it up carefully in a PR description — and moved on. That is a well-documented non-fix. The user's correction was blunt and correct: never leave a bug unfixed, write the failing test first, then fix. The rationalisation I used was "pre-existing, not from this branch," which is an answer to *where did this come from*, a question nobody asked, standing in for *is it fixed*, the question that mattered. **Establishing that a bug is not yours is not progress on the bug.** The finding is the expensive part; stopping at a well-written note throws it away and makes the next person pay for the discovery again.

---

## 2026-07-19 — Every test seeded the empty case, so every test took the early return

The library page has infinite-looped for signed-out users with a practice set for who knows how long, and the reason nobody caught it is worth more than the bug. `pickInitialProgression` opens with `if (taggedIds.size === 0) return DEFAULT_PROGRESSION` — an early return that fires *before* it reads `lickPractice.progress`. The loop needs that read to happen. Every existing library spec seeds licks with no practice tags, so every existing library spec exits at that guard and never reaches the code that breaks. The fixtures didn't just fail to cover the bug; they systematically covered the one branch where it can't exist.

The general shape: **a test fixture that models the empty or default state exercises the guard clauses, not the logic behind them.** And empty-state fixtures are the ones you write first, because they're the cheapest to construct — `seedUserLicks(page)` with untagged sample data is one line, whereas a realistic practice set means tags, prog tags, progress rows. So the cheap fixture becomes the default, the default becomes the whole suite, and the suite converges on testing the codebase's early returns. The tell to watch for: when a bug report says "only happens once I have some data," check whether *any* fixture has data. Here the honest summary is that the library suite tested a library with nothing in it, which is not the state any real user is ever in.

The bug itself is the second keep, and it's a Svelte 5 idiom worth naming: **a hydration routine that reads state it also writes will loop when called from an `$effect`.** `hydrateLickPracticeProgress` assigns a fresh `lickPractice.progress` object and then calls a helper that reads `lickPractice.progress`; the effect tracks the read, the write invalidates it, forever. What makes it insidious is the *asymmetry that hides it*: signed in, `await initLickMetadataFromCloud` splits the function and the writes land in a microtask outside the tracking window, so the bug vanishes. Signed out, no await executes and the whole body is synchronous and tracked. So the same code path is correct or catastrophic depending on whether an `if (client)` branch happened to yield — which means **an `await` was silently load-bearing for correctness**, and anything that made the cloud call synchronous, or cached it, would have broken signed-in users too. Hydration functions should be untracked on principle: they run because auth changed, not because the state they write changed. That's a rule, not a patch.

Third, on method, and it's the good version of the streak I've been logging. Three times today the instinct was to assert and three times I checked instead: CodeRabbit's `--linked` claim (ran `--help` on six commands — and found the *better* fact, that `db push` defaults to remote); my own trend-chart spec's time-dependence (moved the frozen clock to 2027 and watched the chart go empty); and "did I cause this loop?" (stashed my work and reproduced it on a clean tree *before* diagnosing). The third is the one that mattered most — the loop appeared in the same test run as my new feature, which is exactly the circumstance where I'd have spent an hour debugging my own correct code. **When a failure appears alongside your change, the first move is to remove your change, not to read it.** Cheaper than any amount of reasoning, and it answers the only question that determines where to look next.

---

## 2026-07-19 — Co-plotting is an implicit claim that two quantities are commensurable, and this one wasn't

Three lines shared a y-axis on the trend chart: Tonal Mastery, pitch complexity, rhythm complexity. All three are 1–100, all three trend upward with practice, and that's exactly the trap — **a shared axis is an assertion that the quantities are the same kind of thing.** They aren't. Mastery measures the player (average proficiency across 12 scales × 12 keys). The complexity pair measures the *generator's* current setting — how chromatic and syncopated the material it's feeding you is. Those move together in the happy case, which is what makes the conflation survive: a rising complexity line looks like progress and is *correlated* with progress, while actually reporting that the difficulty knob turned. It's the system describing itself in a chart the user reads as a description of themselves. The user's word for them was "meaningless," and the precise sense in which that's right is that they were meaningless **in that frame** — the same two numbers rendered as current-value bars in the Adaptive Difficulty section a few hundred lines down are perfectly informative, because that framing makes no claim about improvement. Same data, same page; one placement lies and the other doesn't. Worth carrying: before putting a series on a chart labelled *progress*, ask whether it measures the person or the machine, and whether the axis it shares is asserting a kinship that exists.

The mechanical finding underneath is the better one though. The forward-fill loop skipped any day where `lastPitch == null || lastRhythm == null` — so the mastery line couldn't render on a day unless the *complexity* metrics had a snapshot. A decorative series was gating the primary one. This is the co-plotting problem again but in the data layer rather than the visual one: once quantities share a rendering path, they acquire dependencies on each other that nobody designed and no type checks. Deleting the two dotted lines silently fixed a latent data bug, which is the tell — **when a removal fixes something, the thing removed was load-bearing in a way its purpose never justified.** Generalisation for this codebase: any loop that accumulates several optional fields and then gates on all of them has quietly ANDed together metrics that were meant to be independent.

Third, the drift. The legend said "Mastery / Pitch / Rhythm," the tooltip said "daily average accuracy over the rolling window," and the data was a forward-filled adaptive snapshot. Three different stories about one chart, none of which agreed, and the tooltip's version describes something the chart has apparently *never* displayed. Explanatory text is the least-tested surface in the app — no type checks it against the thing it explains, and no test failed when it went stale. It rots exactly as fast as the feature changes and gives zero signal when it has. The cheap discipline: when the series on a chart change, the tooltip is part of the diff, not a follow-up.

---

## 2026-07-18 — An artifact that imitates generated output is lying about its provenance, and the tooling repeats the lie

`src/lib/supabase/types.ts` opens with "Generated-style type definitions… Follows the exact format produced by `npx supabase gen types typescript`." Read that quickly and it says *this file is generated*. A `db:types` script sat in package.json piping the generator straight over it, which confirmed the misreading. Both signals pointed at "regenerate me." Both were wrong: the file is hand-written, and it contains a deliberate narrowing (`public_lick_authors.id: string`, where the generator emits `string | null` because Postgres can't prove non-nullability through a view) that regenerating destroys — widening a `Map` key type at three `community.ts` call sites for a NOT NULL primary key. The truth about how the file is maintained was written down nowhere; the format mimicry actively argued against it.

The general shape worth keeping: **format mimicry is a provenance claim, and an unlabelled one defaults to "machine-owned."** Once an artifact looks generated, every reader — me included — treats it as disposable and regenerable, because that's what generated files *are*. The valuable thing in this file (a source-interface→table mapping, and one type the generator gets wrong) was exactly the part no generator could reproduce, and therefore exactly the part most at risk. So the durable fix wasn't the checker I built, it was the four lines in the header declaring the file hand-maintained and saying what regeneration would cost. Hand-maintained artifacts in generated clothing need to *say so in their own first paragraph*, because the next person to touch it will be holding a tool that overwrites it.

Second keep, on the tooling: a script whose whole contract is `generator > file` fails catastrophically in the ordinary case where the generator errors — the shell truncates the target before the command runs, so a broken run half-clobbers a good file. That happened here (exit 1 from a Docker image pull, file already rewritten). Any script that redirects a subprocess over a tracked file has this bug by construction. Generate to a temp path, then move — or, as here, don't write at all. The conversion of that script from a **writer** to a **checker** kept 100% of its real value: the only thing generation ever offered was "tell me if the hand-written file fell behind the schema," and a diff answers that without the destructive write. When a tool's output is dangerous but its *comparison* is useful, ship the comparison.

Third, the honest one about me, and it's now a streak of three. Drum bug: I modelled the wrong bug *family* before pinning the symptom's grammar. Tempo bug: I guessed the wrong *entry point* and the user corrected me. Today: I asserted the wrong *provenance* — told the user regeneration would strip six columns, when regeneration would actually strip a documentation header, and I only learned this by running the command I'd been describing. Each time the reasoning built on top was sound; each time the premise underneath was a guess I'd stated as fact. The specific tell is that in all three I had a cheap way to check the premise (read the file's header; ask which mode; run the command) and reached for argument instead. The rule I want: **when a claim is about how something behaves, and running it is cheap, run it before saying it.** Confident description is not observation, and the distance between them is where I keep putting my errors.

Fourth, smaller: the user asked "is it safe to apply these migrations, I don't want to lose local data." The truthful answer was that there was no local data at all, and that the actual danger in the vicinity was unrelated to the operation asked about — the CLI is linked to the *production* project, so every command has a `--linked` twin one flag away from prod. Answering only the literal question would have been accurate and useless. **When someone asks whether X is safe, check whether the blast radius they're picturing is even where the blast radius is.**

---

## 2026-07-16 — Aggregating over *everything stored* inherits every ghost the store ever accumulated

The 100 BPM "cap" was `getLickTempo` taking `Math.min` over `Object.values(keyProgress)` — a min over the *entire* stored key set, no filter. A single legacy `Gb:100` entry, orphaned when the app switched from all-flats spellings to canonical `F#`, sat there at the old `DEFAULT_TEMPO` and vetoed the minimum forever, because no writer could reach a key that isn't in the canonical twelve. The specific shape worth carrying: **an unbounded aggregation (min/max/any/all over "all rows we've ever stored") is only as correct as the oldest assumption any of those rows was written under.** New code narrows the write-set (12 canonical spellings); old data doesn't retroactively narrow with it; the reader still sweeps all of it. That's not a spelling bug, it's a reader-writer asymmetry: writers moved forward, the aggregator still reads the past.

And this is now the *third* body in the same graveyard — stored data outliving the assumptions its reader makes about it. Dev/prod shared-Supabase contamination (same email → same `user.id` → one account's data bleeding across environments), anon-lick absorption (local licks silently adopted by the next login on the origin), and now phantom keys. Local-first + cloud-sync + an evolving schema *guarantees* the store fills with ghosts: half-migrated rows, superseded spellings, cross-identity residue. Anywhere this app reduces over persisted collections, the honest question isn't "is the reduction correct?" but "correct against which vintage of writes?" A reduction that's right for today's writer and wrong for a 2-year-old row is the default failure here, not an edge case. The fix that held was to make the *reader* enforce the writer's current invariant (min over canonical keys only) rather than to chase and clean every ghost — belt on the read path beats a migration you have to get exactly right, because the next ghost is already being written by some code path you haven't audited.

Two process keeps. First: the investigation turned on a **backward deduction from the output, not forward code-reading**. The tempo shown is a pure function of stored state, so I ran it in reverse — flat card ⟹ `getLickTempo == 100` ⟹ ≥1 stored key still at 100 ⟹ (given all 12 canonical keys were played and bumped to 105) a key *outside* the canonical set. That chain eliminated the entire scheduler-timing family before a single agent ran, and made the confirming step a ten-second `localStorage` scan rather than a code audit. When the symptom is a deterministic function of state, deduce the *necessary* state and go look at it. Second, the mirror of the drum entry below: I guessed the wrong entry-point — assumed single-lick Deep Practice (per-key 0.95 mastery gate) when the user was in Daily (avg-based +5), and the user had to correct me. The report card renders identically for both modes *by construction*, so it carries no signal about which engine produced it. I inferred a discriminator that wasn't there. The recurring failure across both of today's sessions is the same: acting on a symptom whose grammar I hadn't actually pinned down — which family, which entry-point — before building rigorous arguments on top of the guess.

---

## 2026-07-16 — The symptom's *grammar* tells you which bug family you're in; I spent the first half in the wrong one

The drum-dropout hunt had two halves and a hinge. For the first half I chased a **coverage** failure — does the drum track run out before the phrase ends? — because the opening report was "entire beats are missing" and a background workflow (fired from another context, quietly mis-scoped to *ear training*) had already "confirmed" the harmony<melody trailing-drop on ballad-005/006. I proved, three ways, that lick practice can't hit that drop: the per-key `extendHarmonyTail` plus the contiguous multi-key harmony always covers the melody (600 curated combos, then all 13 of the user's real licks — zero drops). All correct, all beside the point. The hinge was one clause from the user: "dropping out on **every second beat**." That is not a coverage failure at all — it's a **rate/subdivision** failure, a different bug family entirely, and coverage math can't even express it. "Missing beats" and "every second beat" share vocabulary and share nothing else. The lesson I keep re-learning: pull the *precise* symptom first, before modelling; the grammar of the complaint ("runs out" vs "every other" vs "late" vs "wrong") selects the family of mechanisms, and modelling the wrong family produces airtight proofs about the wrong thing. A fuzzy report plus a confident-but-mis-scoped agent result is exactly the setup that sends you down a rigorous dead end.

Second keep, and it's the same shape as the octave-fix trail two entries down: the strong endpoint of a "can't-find-it" investigation is an **impossibility proof, not a shrug**. I didn't stop at "I couldn't reproduce it." The drum `Tone.Sequence` fires one hit per `'4n'` unconditionally, every style hits a drum on every beat in 4/4, and every one of the user's licks is `[4,4]` — so every-second-beat is *impossible* from the scheduler, and the only path that could produce it (a denominator-8 meter) is closed upstream because step-entry hard-codes `[4,4]`. That converts "I don't know" into "here is the boundary of what the code can do," which is a far more useful thing to hand back — and it points precisely at where the truth must live instead: the live sample-trigger layer, or a correctly-functioning voice being mis-heard. Which is the third keep: the most likely resolution of a **confidently-reported bug from the person who built the app** is that the piano is comping on 2 and 4 exactly as designed. Confidence and authorship don't make a bug exist in the code; reproducing against the *actual* data (not my synthetic pickup-lick guesses, which kept saying "impossible" while the user kept saying "it happens") is what finally made the two stories meet. When my model and a credible report disagree, the resolvent is almost always *their real data*, and it's worth reaching for it earlier than I did.

---

## 2026-07-14 — Every octave fix so far has manufactured its mirror image; the way out was physics, not thresholds

The Third–Fifth Rise bug completes a telling sequence. The 2026-06-30 subharmonic corrector was built on a measured empirical boundary — "real low notes keep ≥ 0.20 of their 2nd-harmonic energy at the fundamental" — and fourteen days later a real E3 walked through it at 0.02. The corrector then did to a *correct* detection exactly what the artifact used to do to a wrong one: rewrote the whole note an octave off, at the source, unrecoverably (the readings' `frequency` field stores the *corrected* value — a design choice that makes the corrector's mistakes indistinguishable from the detector's truths downstream; worth remembering that any in-place correction erases the evidence of its own failure).

The fix that held wasn't a better threshold on the same bin — it was a discriminator aligned with the *mechanism*: period-doubling sidebands are physically weak (a perturbation on the true period), full-rank odd harmonics are not. Ratios built on empirical amplitude clusters ("notes usually look like X") keep getting falsified by the long tail of real playing — subtone, masked fundamentals, room filtering. Ratios built on what the mechanism *can't* produce (an artifact can't put full-rank energy at 1.5× the true fundamental) have a floor under them. When the next octave case appears — and the sequence says it will — the first question should be "what does each hypothesis make physically impossible," not "where do these two recordings separate."

Also worth keeping: sweeping the entire fixture corpus at production settings *before* writing the fix is cheap (a 60-line script) and did three things a test-first loop alone wouldn't have: set the threshold with real margins, proved the only regression surface was bc-010, and found a week-old recording (`four-to-five`) that the bug had been silently corrupting with no test noticing — the corpus is a measurement instrument, not just a safety net.

---

## 2026-07-14 — "Absence of evidence read as evidence of absence" is this codebase's recurring data-loss shape

The progression-tags incident fix turned out to be the same bug three times in different clothes: `safeGetSession` read *couldn't reach the auth server* as *signed out* (→ wipe); the hydrators read *fetch failed* as *account is empty* (→ reconciler prunes everything and pushes the emptied blobs cloudward); and the whole incident existed because a stale client read *no explicit prog tag* as *category matching still applies*. Every fix was the same move — split "verified negative" from "verification unavailable" and make the destructive action require the verified form. In a local-first + cloud-sync architecture, **any code that deletes or overwrites based on what it *didn't* find must first prove the absence is real.** That's now enforced in three places (degraded flag, hydration reports, maintenance gate), but the pattern predicts future bugs anywhere a `null` return conflates "no" with "unknown" — `getAuthUserId` still returns one null for both, and the whole-column LWW sync (follow-up) still trusts whatever blob is local.

Second, smaller keep: **one-time migration markers can live inside the data they migrate.** The `__migrations` reserved key inside the cloud-synced tags blob is the only place a flag survives both the user-scope wipe and device switches without a schema change — but it only works because every consumer that enumerates blob keys as lick ids now knows to skip reserved keys. An unwritten invariant ("all keys are lick ids") had to become a written one (`isReservedTagKey`) before the trick was safe. When smuggling metadata into a keyed collection, enumerate the enumerators first.

Third: the adversarial review workflow caught what single-pass review reliably misses — not the bugs in the new code, but the **old code paths the new invariant doesn't cover** (the ungated `hydrateLickPracticeProgress` writers, the 429 that auth-js refuses to classify as retryable, the missing `depends()` that would have made a transient verdict permanent). The lens that pays is "where else does this same class of write happen," not "is this diff correct."

---

## 2026-06-30 — A defect and a feature can be the same mechanism; map invariants before ambitions

**Same boundary, opposite meaning.** The tenor-sax "two instruments" bug was note velocity landing exactly on the sample-layer split, so random jitter flipped each note between the soft and loud recordings. The fix wasn't to move velocity *away* from the split — it was to stop letting *noise* decide and start letting *musical intent* decide. Under noise the threshold is a glitch; under a dynamics model it's a free pp→ff timbre control (accents cross into the bright forte samples, ghosts fall into the dark piano samples). When something on a threshold misbehaves, the question isn't always "how do I get off the threshold" — sometimes it's "what *should* be driving which side of it." The threshold was fine; the driver was wrong.

**Map the load-bearing invariants before the ambitions.** "Make replays more musical" instinctively points at *feel* first — laid-back swing, timing. But timing is the one expressive dimension coupled to the scorer (the swing grid is shared, so a perfect take scores perfectly). Everything else — dynamics, articulation, timbre — is unscored and free. Finding that coupling *before* designing let the plan aim at the whole expressive surface *except* the part that fights the rest of the system. Ambition should be shaped by the invariants, not the reverse.

---

## 2026-06-28 — "Explicit ask, implied mechanism" is the shape of my branch-discipline misses — and a reduced-motion CSS trap

Two carry-forwards from the level-signal (#142) + licks (#143) session.

(1) **The branch mistake has a recognizable rationalization shape, and naming it is the fix.** The user has told me repeatedly never to create branches unsolicited; I did it again on "create a pr," justified as "a PR *requires* a branch, so asking would be over-confirmation." That's the trap: an explicit request (make a PR) silently authorizes an *implied mechanism* (a new branch) that was never asked for. The request grants the goal, not the means. The durable project fact that dissolves the temptation entirely: **this repo ships PRs dev→main** (#139–#141 are all "from avitus/dev"), so committing on the current `dev` and opening dev→main needs no branch at all — the thing I reached for was never necessary. General form: when an instruction seems to *require* an action I've been told not to take, that contradiction is the signal to stop and ask, not to resolve it in my own favor.

(2) **`animation: none; opacity: 1` is a silent way to drop a fade under `prefers-reduced-motion`.** My reduced-motion branch disabled the animation and pinned opacity to 1 with a `transition: opacity` that never fires (opacity never changes while the node is mounted; Svelte just unmounts it), so the caption popped in/out instead of fading. CodeRabbit was right. The correct pattern is a *separate opacity-only keyframe* — an opacity fade is not vestibular motion and is fine to keep under reduced-motion; what you strip is the `transform`, not the fade. Worth remembering for the PWA's other reduced-motion sites: reduced-motion means "no movement," not "no transition" — keep opacity, drop translate/scale.

## 2026-06-25 — The 4th re-articulation bug needed an axis that wasn't in the data yet — and it exposed the resolution limit of the captured signal

The prediction held a fourth time, but with a twist that matters. The prior three fixes each found a *new way to read the existing readings* (energy direction; true-silence vs warmup-bridge). This one (blues-curl-down, concert Bb, Db-Db-Bb, a soft legato tongue on the 2nd Db) had **no separating axis anywhere in `PitchReading`** — not in gap, rms, clarity, or warmup. The airflow never stopped, so there was no gap and rms *rose*; the clarity dip was 0.042 (under the 0.07 floor); the worklet's amplitude-weighted "HFC" never twitched. The only thing that unambiguously marks the re-attack is a **broadband high-frequency burst** (FFT centroid jumping to ~9 kHz), and nothing in the pipeline was capturing high-frequency content. So for the first time the fix had to **add a new captured signal** (`hfRms` = RMS of the first-difference high-pass) in `detectFrame`, not just interpret old ones. That `detectFrame` is shared by live + replay is what made it testable from the same WAV — the architecture's "one math, two paths" decision paid off again.

The deeper finding is about **the limit of the signal** — and I initially over-read it. Profiling all 12 fixtures through the real replay path, two of the oldest (`a4-c5`, `a3-c4`, curated as 2 notes) showed a mid-note HF burst — a similar ~9 kHz centroid spike — that my FFT analysis made look like a *physically identical* tongue transient. I wrote that their `[57,60]` ground truth was "arguably debatable." **Then the user listened to all three on a temporary `/listen` page, and the verdict was unambiguous: a4-c5 and a3-c4 have NO audible transient at all; curl-down's re-tongue is subtle but clearly audible.** So `[57,60]` is *correct*, not debatable, and the gate makes the right call on every case. Lesson on me: a centroid/HF-*ratio* spike with no change in *total* energy is not necessarily an audible event — I let the spectrogram overrule what an ear settles in five seconds. I should have built the listen page *before* writing the "debatable ground truth" line, not after. **Correction logged 2026-06-25.**

What actually separates the cases is physically meaningful and — now confirmed — **perceptually aligned**: a real re-tongue perturbs the **fundamental** (midiFloat dips ~0.12–0.16 st as the reed resets) because the reed genuinely re-attacks; the inaudible a4-c5/a3-c4 blips leave the fundamental steady (≤0.07 st) because the tone never restarts. The 0.1 st gate isn't a magic number wedged into a ~0.03-wide gap — it tracks *did the reed re-attack*, which is exactly what makes a re-articulation audible. The margin is still numerically tight and a future fixture could stress it, but the discriminator has a real perceptual referent, which is more than I credited it in the first draft of this note.

Three carry-forwards. (1) "New axis not new threshold" has a corollary now: *sometimes the axis isn't latent in your data and you have to instrument for it.* Before tuning, ask not just "which existing field separates these?" but "is the separating physics even being measured?" Here it wasn't. (2) **When the question is "would a human hear this?", ask a human — early.** I had a WAV, a player on the other end, and a 20-line listen page between me and certainty, yet I spent a long detour reasoning about spectrograms and wrote a wrong conclusion into these notes first. The cheapest ground truth for a perceptual question is perception. (3) The "wall" I worried about is further off than I thought: the pitch-perturbation cue turned out to be *perceptually aligned* (it fired iff the tone audibly re-attacked), not a fixture-tuned coincidence. Still, it's a magnitude cut on a noisy estimate — if a *fifth* of these arrives and the cue fails to separate an audible re-tongue from an inaudible blip, that's the signal to reconsider the representation (a proper spectral-flux onset in the worklet) rather than add a sixth tier. The honest version of "what's the change underneath this surface?" is sometimes: go listen.

## 2026-06-23 — The template held: the next re-articulation bug needed a new *axis*, not a lowered threshold — and the axis was hiding in the warmup flag

Three days after predicting it (the note below), the exact same dead-zone bug arrived: "Blues Curl Up" concert D (bc-041_D, snapped to D-F-F), two tongued Fs merged into one, score 0.627 "fair", third note MISSED. Same shape as flat-five — short reading gap (117 ms, under the 150 ms bare-gap floor), RMS *rising* across it (so the dip-and-rise scan bails), worklet missed the soft tongue. But the step-up tier's 1.5× floor rejected it because the **measured** rise was only ~1.26×. The reason is worth keeping: the 60 fps readings *bracket* the attack — clarity collapses during the broadband tongue click, so Pitchy emits nothing for the whole transient; the readings resume on the new note's **decay shoulder**, past a peak (~0.38 in the raw WAV, a true ~1.8× jump) that was never sampled. So the captured step-up structurally understates a real re-attack whenever the gap swallows the peak. The WAV ground-truth pass (autocorr + RMS envelope) was again decisive — it showed three clean attacks and the 0.38 peak inside the hole *before* I read any code.

The trap was real and I nearly walked into it. The obvious fix — lower 1.5× to catch 1.26× — is exactly the fixture-tuning my own prior note warned against, and the fixtures proved why: the **upper-neighbor-on-root** C-D-C recording has a same-MIDI "gap" in its sustained final C that rises **1.27× / peak 1.51×** — *higher* than the genuine re-attack (1.26× / 1.39×) — and must NOT split (it's one held note). No ratio threshold can separate 1.26 (split) from 1.27 (don't). I built a fixture-wide decision table from the actual replay path and it was unambiguous: ratio is not a separating axis here.

The separating axis turned out to be the **`warmup` flag**, which I'd have overlooked without the per-frame dump. A genuine soft-tongue silence emits *no frames of any kind* across the hole — the worklet missed the attack, so the octave stabilizer never reset, so there are no warmup frames. The upper-neighbor "gap" is the opposite: the worklet *did* fire (1.355 s), reset the stabilizer, and the post-reset frames are flagged `warmup`. `findSameMidiRuns` skips warmup → it **manufactures a phantom gap** between two stable readings that were actually contiguous. So the new axis is: *is this a true detector silence, or a warmup-bridged stabilizer-reset artifact?* Gating the short-gap tier on "no readings (warmup included) bridge the hole" rejects the 1.27× landmine by structure, not magnitude — which then makes lowering the floor to 1.2× safe (the remaining true-gap non-re-attacks — a McLeod subharmonic flicker during a bend — sit at ≤1.12×). The fix is one new gate + one constant, ~15 lines.

Two carry-forwards. (1) The 2026-06-21 prediction was correct *and* its method generalized: when a threshold can't separate two fixtures, stop tuning the threshold and go find the axis on which they actually differ — here it was a field (`warmup`) the re-articulation code wasn't even looking at. The right discriminators in this subsystem keep turning out to be *categorical* (energy direction; reset-vs-silence), not finer magnitude cuts. (2) Building the cross-fixture decision table from the **real replay path** (not the saved JSON readings, which differ slightly) before touching the threshold is what surfaced the upper-neighbor landmine. Had I tuned to the new fixture in isolation I'd have shipped a regression that no *existing* test would have caught — the upper-neighbor test happens to call `segmentNotes` on the pre-`findReArticulations` path, so it'd stay green while production silently split the held C into two. The fixtures protect you only if you actively interrogate all of them against the proposed boundary.

## 2026-06-21 — The re-articulation detector is a pile of accreting thresholds; bugs live in the gaps between them

Fixed another "two notes merged into one" scoring complaint (flat-five-chromatic-up, concert G). Same family as the Blues Curl fixes (May 20/22): a soft tongued repeat of the same pitch that the HFC worklet can't catch (energy ~doubles, but HFC ratio only ~1.4× vs the 3.0× trigger), so it's delegated to `findReArticulations` in the segmenter. What struck me is the **shape of the accumulated logic**. There are now *three* ways to recover a missed re-articulation — worklet onset, dip-and-rise scan (clarity dip + RMS dip-and-recovery), bare-gap pass (≥150 ms reading gap) — and each was added by a specific past diagnostic. This recording threaded the needle *between* them: a 100 ms gap (under the 150 ms bare-gap floor) where the RMS *rose* monotonically into the re-attack instead of dipping (so the dip-and-rise scan bailed with "no dip"). Neither pass fired; `mergeSamePitchWithoutAttack` collapsed it.

The pattern worth remembering: **every fix here is a threshold tuned to the fixtures that existed at the time, and the dead zones between thresholds are exactly where the next diagnostic lands.** fde3c36's author even *documented* the 150 ms floor as "deliberately above ~100 ms mid-sustain glitches" — and the next real bug was a 100 ms re-articulation. The floor was right; the discriminator was missing. The fix wasn't to lower the floor (that re-admits the glitches it was protecting against) but to add the *missing axis of evidence*: a short gap counts as a re-attack iff the RMS clearly **steps up** across it (≥1.5×). A sustain dropout fades or holds (ratio ≲1.0); only a tongue re-attack jumps louder. So the discriminator is energy-*direction*, which none of the prior passes checked — they all looked at magnitude (dip depth, gap width) but not the sign of the change across the hole. I suspect several future fixes here will follow the same template: not a new threshold, but a new *axis* that separates a real event from the glitch class a prior threshold was holding back.

Meta-point on the debugging method: the WAV ground-truth analysis (autocorrelation + RMS envelope straight off the raw audio, independent of the app's captured readings) was decisive — it told me *what was actually played* (C-C-D, three notes, energy doubling at 0.42 s) before I read a line of segmenter code. Establishing the empirical truth first turned the code investigation into "find why the pipeline disagrees with the audio" rather than "guess at the pipeline." Worth doing every time a diagnostic WAV exists.

## 2026-06-21 — Chromatic-named licks silently lose their defining note in diatonic tonalities (not a bug I was asked about, but a semantic-drift smell)

While confirming the expected phrase for the above, found the scorer's target was C-C-D, not the C-Db-D you'd expect from "Flat Five Chromatic Up" (bc-045 = F-F#-G). Reason: the day's tonality was G *major* (or pentatonic), and `snapLickToScale` snaps the out-of-scale b5 (Db) down to the root C — so a lick *named for its flat five* renders with no flat five, as a repeated-note exercise. In `blues.minor` it renders correctly (Db is in scale). This isn't wrong code — snapping out-of-scale notes is the intended behavior — but it's a **semantic drift**: a curated lick's identity (the chromatic passing tone that gives it its name and pedagogical point) can be quietly dissolved by the tonality layer, and nothing flags that the rendered phrase no longer matches its name. The C-C-D result also manufactures a same-pitch repeat, which is precisely the hardest case for the segmenter — so the snap behavior actively *feeds* the re-articulation failure mode above. Worth raising with the user as a design question: should chromatic/blues-specific licks be gated to tonalities whose scale contains their characteristic tones, rather than snapped into diatonic keys that erase them?

**Resolved 2026-06-21 (settled, don't re-raise):** raised it; the user accepts this as a known, tolerable side-effect of squeezing curated licks into arbitrary tonalities. Gating chromatic/blues licks to compatible scales would cost more practice variety than the occasional erased passing-tone is worth. So the snap stays — but keep this paragraph as the standing explanation for *why* a "named" lick can show up shorn of its namesake interval, and remember that the snap manufactures same-pitch repeats that stress the segmenter (the re-articulation work above is the real mitigation, not changing the snap).

---

## 2026-06-21 — The owner-stamp machinery is symptom-fixing for an infra misconfig (dev and prod share one Supabase project)

Investigated recurring "contamination between dev and production" — dev-user licks leaking into the prod account, hard-to-delete duplicates. Traced it to one fact: there is a **single `.env`**, so `npm run dev` (localhost:5173) and the deployed site read the same `PUBLIC_SUPABASE_URL` → **one Supabase project, one database, one `auth.users` pool**. "Dev user" and "prod user" with the same email are literally the *same* `user.id`. The cloud merge isn't a bug; it's the correct consequence of pointing two front-ends at one backend. Duplicates persist because IDs are `user-${Date.now()}-${rand}` and all dedup is ID-keyed — identical content entered in each environment gets distinct IDs that never collapse, and each origin's localStorage re-pushes its copy on startup (whack-a-mole, no tombstones).

What strikes me is how *exactly* this rhymes with the 2026-06-18 note. There's an elaborate, well-commented client-side isolation apparatus — `user-scope.ts`'s wipe-on-user-change + generation counter, the `OWNERS_KEY` owner-stamp defense, the `.eq('user_id', self)` filters guarding against the open community SELECT policy. All of it is real, careful engineering. And all of it is compensating for an environment that *shouldn't be shared in the first place*. The owner stamp is structurally blind to the dev/prod channel because both environments legitimately stamp the **same** user.id — the one case it can't catch is the one actually happening. Same signature as the chunk-eviction bug: intricate recovery logic one layer up, root cause one layer down in infra. The fix is config, not code (separate dev Supabase project via `.env.local`), and the code defenses are then doing the narrower job they were actually designed for (account-switch on a shared *browser*, not a shared *database*).

Second carry-forward, on method: my first-pass analysis correctly nailed both cases' mechanisms but **overstated Case 2's second half** — I claimed pulled prod cloud licks "remain visible to a not-logged-in dev user," which an adversarial verifier refuted: `@supabase/ssr` cookies are origin-scoped, so on a shared origin you can't be logged-in-as-prod and logged-out-as-dev simultaneously — it's one session over time, and `syncUserScope(null)` wipes on the transition to anonymous. The verifier's sharper move was the *diagnostic inversion*: since a genuine Case 2 (different origins, truly anonymous dev) produces **no** contamination, anyone observing it is almost certainly looking at a persisted dev session — i.e. Case 1 wearing a Case 2 costume. I'd have shipped the overstatement without the refute pass. The completeness critic then found the part I'd scoped out entirely: the shared account doesn't just *duplicate* licks, it *destroys* data — `session_results` prune actively deletes the other environment's history, `user_lick_metadata` clobbers `prog:*` eligibility and unlock counts last-write-wins. The duplicate licks the user complained about are the visible tip; the silent data loss is the bigger risk. Lesson: when a user reports the *annoying* symptom, check whether the same channel also has a *destructive* one they haven't noticed yet.

---

## 2026-06-18 — A client-side error handler can be a tell that the bug lives upstream

Triaged the three open Sentry issues. Two were already dead at HEAD (the `effect_update_depth_exceeded` from the note below, fixed by `untrack`; and a `HelpTip is not defined` HMR ghost — the component was renamed to `TooltipHint`, so it can't recur). The live one was MANKUNKU-8: `error loading dynamically imported module` on `/add-licks` in production.

There was already an elaborate defense in `hooks.client.ts` — regex-match the error message, force one reload per session via a `sessionStorage` flag, and a `beforeSend` that drops the first occurrence and only reports the "reload didn't help" repeat. It works, but the user pushed back twice ("feels like a hack," "is polling idiomatic?") and was right both times. Each pushback peeled back a layer: my first instinct was to patch the reload guard (a timer hack), my second was SvelteKit `version.pollInterval` (framework-blessed, but still a client-side *guess* about server state). Only when forced past those did I trace to the actual root cause — and it wasn't in the client at all. **The atomic-symlink deploy (`release.sh`) flips `current` to the new release, so the server serves only the newest release's content-hashed chunks; the previous release's chunks still sit on disk but are no longer reachable by URL.** That defeats the entire purpose of content hashing, which exists precisely so old and new can coexist. The fix is six lines server-side: accumulate every release's `_app/immutable` into a shared, growing pool and serve from it. The whole client-side apparatus was compensating for a deployment that threw away assets it should have kept.

The carry-forward: an unusually intricate client-side *recovery* mechanism is a smell worth following upstream. If you're writing string-matching + reload + dedup logic to survive a class of error, ask whether the error should be *occurring* at all — often the elaborateness is the symptom-fix metastasizing because the real cause is one layer down (here, two layers: framework, then infra). Also worth naming: the user's "this feels like a hack" was a better debugging instrument than my knowledge of SvelteKit's feature set. I knew more options; they had better taste about which were root-cause fixes. Both pushbacks moved the solution strictly closer to the source.

---

## 2026-06-17 — A green unit suite can hide a reactive-wiring bug, and I reasoned my way into one

Fixed the ear-training retry inconsistency (PR #127). Two real bugs underneath it: the advance/retry decision ran on the *provisional* live score while the user sees the *authoritative* replay rescore, and the phrase-binding `$effect` could let an adaptive-difficulty reshuffle swap a lick out mid-retry. Both were the same shape of root cause as the April chord-alignment bug: **the control flow keyed off the wrong copy of a value that exists in two forms** (live vs. replay score; cached vs. reshuffled lick list). Worth noting how often this codebase's bugs are "two representations of the same thing, and the logic read the wrong one." That's becoming a signature.

The sharper lesson is about my own process. I extracted the decision and the phrase-binding into pure helpers, wrote 10 unit tests, watched them go green, and shipped — and CI went red with `effect_update_depth_exceeded`. The helper was correct; the *wiring* wasn't. I passed `current: session.phrase` into an effect that also writes `session.phrase`, which is an infinite update loop in the production build. I had even reasoned, in the moment, that "Svelte dedupes same-value writes so it converges" — a confident, wrong rationalization that the unit tests couldn't contradict because they never touched the reactive graph.

Two things to carry forward: (1) Extracting logic into a tested pure function buys you correctness of the *logic*, not of the *integration*. The seam between the pure function and the framework's reactivity is exactly where the test coverage evaporates, and it's precisely where I relaxed. The existing E2E smoke suite ("page renders without console errors") was the real safety net, not my unit tests. (2) When I find myself *arguing* that a framework will save me from a footgun (self-referential effect, same-value dedupe), that argument is a smell, not a proof. The honest move is to run the production build / E2E before claiming done, not to reason about the scheduler's internals. I verified the pure logic locally but pushed the reactive change on reasoning alone. The fix (`untrack`) was trivial once CI told the truth; the cost was a red pipeline that a one-command local E2E run would have caught.

---

## 2026-04-16 — The recurring chord alignment bug is a canonical/boundary violation

The lick-practice chord alignment bug has been "fixed" 4+ times in April alone (commits `38f329f`, `236d9b5`, `da7cc34`, `fb780ac`, `6807d72`). Each fix addressed a real async race condition — generation guards, stale callbacks, bar boundary divergence. And yet the bug persists.

The actual root cause is a violation of the canonical/boundary principle I identified in the first session: **the visual tracking system converts ticks to seconds using a constant-BPM formula, but the Transport accumulates time across variable BPM regimes.** The conversion `(tick / ppq) * (60 / tempo)` is a "leak" — it pushes a boundary conversion (tick→seconds) into the middle of a system that should stay in ticks until the final display.

What's striking is that the audio scheduling is already correct. It's tick-based end to end. The melody Part fires at the right ticks. The backing Parts fire at the right ticks. The recording windows open and close at the right ticks. Only the visual tracking — `currentBeat` and `scrollFraction` — tries to work in seconds, and that's where it breaks.

The prior fixes were all downstream of this: they addressed real issues in the async pipeline that *could* cause misalignment, and those fixes were correct. But the symptom the user observes is the visual display showing the wrong chord, not the audio being out of sync. The visual tracking was never fixed because everyone (including previous Claude instances) assumed the visual tracked the audio's clock. It does — but through a broken conversion.

**Lesson**: when the same bug recurs despite competent fixes, the problem is probably at a different layer than where you're looking. "The demo is not aligned with the chords" sounds like an audio scheduling bug. It's not. It's a display bug hiding behind a conceptually-similar symptom.

Also: there's a quiet asymmetry in how the melody and backing Parts are started — melody uses `Part.start(tick)` with relative events, backing uses `Part.start(0)` with absolute events. Both are mathematically equivalent for non-looping Parts, but the asymmetry is a code smell. Worth cleaning up to eliminate a class of potential Tone.js edge cases.

---

## 2026-04-16 — First-pass framing of the project

### One philosophy applied four times: canonical-everywhere, convert-at-the-boundary

What strikes me most about the codebase is a single design instinct showing up in four otherwise-unrelated places:

1. **Concert pitch is canonical**; transposition to written pitch happens *only* at display time (`phraseToAbc`, `concertToWritten`).
2. **Fractional rhythm `[num, den]` is canonical**; conversion to seconds happens *only* at audio-scheduling time.
3. **`var(--color-accent)` is the canonical accent**; the actual color is decided by a single `[data-domain]` attribute on the layout root — components themselves don't know the color.
4. **localStorage/IndexedDB is the canonical store**; Supabase mirrors it in the background, optionally.

Each of these is the same move: pick one representation, make it canonical, and move every translation to the boundary. The cumulative effect is that the inside of the system is *boring* — and that's a virtue, because the inside is also where the audio thread runs.

This is the lens I should use when proposing changes: **does this preserve the canonical/boundary separation, or does it leak the conversion into the middle?** If it leaks, I should look for a way to push it back to the edge.

### Latency is the enemy at every scale, including in our collaboration

Look at where latency shows up as a first-class concern:

- Pitch detection at 60fps via `requestAnimationFrame` (16ms budget).
- Onset detection in an AudioWorklet at ~2.67ms per 128-sample frame, off the main thread.
- The scorer subtracts the **median** timing offset of matched pairs to absorb constant detection/human latency without disturbing relative timing.
- Two of the user's feedback memories are about latency in *me*: "skip redundant git checks; chain add/commit/push" and "parallelize independent calls." The bottleneck named there is model inference time between tool calls.

The user lives in a flow state — playing music in real time, then iterating fast on the tool. Anything I do that adds wait time costs them disproportionately. So: chain operations, parallelize, don't ask before doing the obviously-needed thing, use background tasks where the work is genuinely independent.

### The rules are scar tissue, not preferences

Most of the working agreements in `MEMORY.md` trace back to specific incidents:

- `tests for new functionality` ← PR #40, IndexedDB silent failure (Svelte `$state` proxies can't be `structuredClone`d).
- `coderabbit comments — all sources` ← PR #28, missed findings.
- `metronome beat 1 = kick` ← infinite-loop branch regressed to ride-only.
- `written pitch display` ← "the user has corrected this many times and it keeps recurring."

These are not personal preferences. They are condensed lessons. Treating them as friction is the same as treating the user's time as cheap.

### The product knows what it is

Winston "Mankunku" Ngozi recorded *Yakhal' Inkomo* in 1968 in apartheid-era Cape Town. Tenor saxophone. The user plays tenor sax. The lick library prioritizes ii-V-I major, ii-V-I minor, blues, bebop lines. There's a step-entry mode for adding licks. The default sound is FluidR3_GM tenor sax.

This isn't a music tech demo dressed up with an evocative name. It's a working musician's tool. When in doubt about a design call, **what serves the practice wins** — not what's clever, not what's general, not what's "more flexible."

The local-first commitment falls out of this naturally: a musician practicing in a green room before a gig, in a basement, on tour, doesn't want a tool that fails because the venue Wi-Fi is bad.

### Things to watch

- **Scope creep along the modes axis.** The PRD planned 7 difficulty tiers for MVP; we now have 10. The lick library was 114 at MVP, now ~250. `lick-practice` is now its own visual domain. The `src/lib/` already has 16 module folders. None of this is wrong — but if a future session asks for a third practice mode or a new top-level domain, that's a moment to pause and ask whether the canonical/boundary discipline holds in the new shape.

- **The reactive-state ↔ persistence seam.** The PR #40 bug is the canonical example: Svelte 5 `$state` proxies don't survive `structuredClone`. This is exactly the kind of seam where two well-designed systems meet and produce a silent failure. Anywhere reactive state crosses a boundary (IndexedDB, postMessage, Supabase JSON, localStorage), I should be skeptical and write a round-trip test before declaring anything done.

- **The `audio-context.ts` shared-context invariant.** Tone.js + smplr share one AudioContext deliberately. If a future change adds a third audio source, it must join that context — not create its own. This is a "load-bearing" decision that's easy to drift away from accidentally.

### A frame I'm going to keep using

Mankunku reads like the work of someone who has stopped distinguishing "engineering" from "playing." The same instinct that makes a jazz musician hear *the form* underneath the surface — the changes that everything resolves into — shows up in the architecture: a small number of canonical structures, everything else negotiating with them. So when I make suggestions, I should ask: "what's the change underneath this surface?" before reaching for a fix on the surface itself.

### Mitigations that corrupt their own telemetry (2026-07-15)

MANKUNKU-8's reactive reload had a latch that, after its first firing, both stopped auto-reloading AND started reporting the next *distinct* failure to Sentry as "reload didn't help" — when no reload had been attempted. So the metric you'd read to judge whether the mitigation works was being inflated by the mitigation's own failure mode. That's a specific, dangerous shape: a guard that fails silent while polluting the signal that would reveal the failure.

The tell was structural, not behavioral — a boolean, per-session flag guarding a condition that recurs per-deploy across a long-lived tab. Whenever a one-shot guard sits on top of a recurring cross-boundary event, ask what happens on the SECOND, DIFFERENT instance, not just the immediate retry. The right key was the failing resource (chunk URL), not the session.

More general lesson, and the thing I nearly missed: when a system already has mitigation for a problem that's *still firing*, don't assume the mitigation is absent — read it, and check whether it's the *reporting* that's lying. Here the "15 events" were pre-filtered to only the actionable residue; the raw incidence was higher and partly self-inflicted. The investigation's value came almost entirely from confirming what already existed (a deploy pool + a reactive reload + a beforeSend gate) rather than from naming the textbook root cause, which was obvious in the first ten seconds.

### The fidelity ladder inverted (2026-07-22)

Importing the user's MuseScore file — the actual source of the chart they practiced from — found a missing note in their hand-entered "ground truth" (bar 4's held whole note; the word is "stars"). The expected fidelity ranking was: human entry > machine import. The real ranking, demonstrated: machine-readable source file > human entry > model-read PDF > chord-grid formats. The lesson isn't "humans are sloppy"; it's that *ground truth* is a claim about provenance, not care. When a test fixture disagrees with the source artifact it was copied from, check the copy before the parser. (And design consequence: the review-in-editor step matters in BOTH directions — it catches importer errors and entry errors alike.)

### Telemetry that attacks the test suite (2026-07-22)

The e2e suite had been quietly POSTing real Sentry envelopes through the tunnel on every page load of every run — invisible until eight full-suite runs in one afternoon tripped ingest rate-limiting, and the 502s came back as console errors that failed *unrelated* tests. Three overlapping causes made the diagnosis slow: genuine CPU contention (real), Spotlight indexing the test videos (real), and the tunnel flood (the only one that was ours). The debugging error to avoid next time: two true-but-partial explanations satisfied the "why is it flaky" question and nearly ended the investigation before the third, structural cause surfaced. A rotating cast of failing tests points at shared infrastructure, not at any test. Related: the fixture that turns console errors into failures is what caught this — the strictness paid for itself by converting silent telemetry pollution into a red build.

### Renames are archaeology, not find-and-replace (2026-07-25)

The Tunes/Licks restructure looked like a mechanical rename and was ~80% one. All the danger lived in the other 20%, and none of it was findable by grepping for the old name. The three real hazards were *behavioral*: an unversioned storage-upgrade body that would re-run and clobber a pointer; an outbox drain that treats unknown intent kinds as successfully handled (so a renamed kind silently deletes queued work); and a storage bucket whose id is physically baked into object keys. What they share: each is a place where the OLD name had been persisted as *data*, not written as *code*. Code renames are caught by the compiler; data renames fail at runtime, later, on someone else's device. The discipline that worked: enumerate every persisted identifier first (the inventory agent), then write the device-upgrade test before touching any of it. The integration test that boots a "pre-rename device" via vi.resetModules is the artifact I'd keep — it turns "we think migration works" into a contract.

Also worth keeping: the verbs stayed asymmetric (Steal licks, Adopt tunes) while the structure went fully symmetric. Good IA symmetry is about parallel *shape*, not identical words — the user's phrase "symmetry is structural, not lexical" is a design principle worth reusing.

## 2026-07-25 — The recovery mechanism WAS the bug (nav dead-clicks)

What strikes me most about the menu investigation: every layer was someone's reasonable fix for the previous layer's failure, and the user-facing bug lived in the seams. The immutable-pool was built so old chunks survive deploys — not live on the box. The SW was configured to precache the shell — it threw mid-eval and nobody could tell, because a service worker that dies after `precacheAndRoute` still *mostly works*. The reactive reload was built to recover stale chunks — but `location.reload()` before SvelteKit commits the URL reloads the page the user was LEAVING, which reads as "my click did nothing". Three mitigations, each ~90% right, and the residual 10%s composed into exactly the symptom the first mitigation was built to prevent.

Two durable lessons for this codebase: (1) recovery paths need end-to-end tests under the failure they recover from — the deploy-simulator harness (two real builds, server swap under a live tab, version.json blocked) took ~100 lines and instantly discriminated between five plausible mechanisms; single-click e2e specs structurally cannot catch cross-deploy failures. (2) When a subsystem is effectively dead in production (the SW here), its *config* keeps accreting good-intentioned changes that have never once executed. Verify the artifact, not the intent: `grep sw.js`, curl the old chunk, register the thing in a fresh browser.

Also worth remembering: Sentry's debug-ID injection makes every build change every chunk hash. "Content-hashed" implies stability under unchanged content — not here. Anyone reasoning about cache behavior from filenames alone will be wrong in this repo.

## 2026-07-26 — The pager was the buffer showing through (tune-editor redesign, in progress)

The "select which 4 bars to edit" pager the user found counter-intuitive was never a design choice — it was the shared step-entry buffer's 4-bar cap surfacing in the UI. The redesign's core move is to keep the constraint and hide the seam: clicks map chart → (section, page) and the buffer follows, committing as it moves. Same lesson as the original paging design (2026-07-22, "the constraint is load-bearing for someone else"), now applied one level up: first we shaped the tool around the constraint; now we're making the constraint invisible. The stable general form: a load-bearing internal boundary may stay, but it must not require the user to know about it.

Design-phase find that shaped everything: abcjs only fires clicks within 12 SVG units of a glyph, so "click any bar" is impossible via its clickListener — but its responsive mode is viewBox-based, so rects appended INSIDE the svg in user units rescale for free (drawGlissandi had already discovered this trick). One source-dive settled what could have been days of overlay-coordinate fiddling.

## 2026-07-28 — Measure the layer the user is looking at (chord-height fix)

The root-cause workflow did everything right — derived abcjs's chord-row formula from source, verified it against 22 measured systems to 0.06 sp — and still nearly shipped a half-diagnosis, because its harness rendered RAW abcjs while the user was looking at the APP. The app's own `normalizeChordVoiceRests` was silently dragging every chord up two extra staff-spaces (the chord `<text>` lives INSIDE the voice-H rest group it translates — even for invisible `x` spacers). Raw-library measurement said "flat systems are already at MuseScore's 2.5 sp"; the app was at 4.5. The investigation's verification loop was sound; its *system-under-test* was wrong. Durable rule: when diagnosing "the app renders X wrong", the measurement harness must exercise the app's full render path, not the library the app wraps — or at minimum, one probe must diff the two.

The debugging moment worth keeping: a transform that appeared "half-applied" (client rect shifted 12.49 where the attr said 28.34). Not a transition, not a browser bug — two coordinate systems: `getBBox()`/attributes are local and blind to ancestor transforms; client rects compose everything. 12.49 = 28.34 − 15.85 was the rest-group drag, visible only in the composed space. When two measurement methods disagree by a suspiciously structured amount, the difference IS the hidden actor — subtract them before hypothesizing.

Also: the fix's shape — a pure-function drop pass emulating MuseScore's per-chord placement on top of abcjs's system-wide row — is the third instance of this codebase's post-render pattern (rests, glissandi, now chords). abcjs gives layout; the app increasingly OWNS vertical semantics above the staff. If a fourth pass appears, it may be time for one consolidated post-render pipeline with a single obstacle model instead of per-pass DOM scans.

## 2026-07-28 — The parser was the engraver (stem-direction fix)

Everyone — including me — assumed the forced-up stems were an engraving-time decision ("multi-voice layout → voice 0 stems up"). The abcjs source says otherwise: the *parser* injects synthetic `stem` events into the token stream at voice creation, and the engraver just obeys whatever direction it last saw. The entire "rule" is a side effect of stream rewriting, which is why no render option, format directive, or post-render trick could reach it — and why the fix is an ABC header token rather than code. Generalization for this codebase: with abcjs, when behavior seems unreachable from options, check whether the parser *rewrote the input* before the engraver ever saw it. (Same lesson-shape as the rest-group drag: the visible symptom lives layers away from the mechanism.)

The satisfying part: the user's instinct — "fix stems, it will make chord positioning easier" — was mechanically exact. The chord drop pass measures ink above the staff; forced-up stems on high notes WERE most of that ink. One header token lowered the obstacle tops by a stem length, and the chord clearance logic followed automatically, no retuning needed. Two fixes, each independently correct, composing through a shared geometric contract (the obstacle model) — that's the architecture doing its job.

Also filed: abcjs's `found` guard bug (`voices[0].el_type` on an array — always undefined, splice unconditional). If we ever upstream anything, this one-character fix plus the beam furthest-note rule would be the PR.

## 2026-07-28 — The oracle inherits the prose's case-split (PR #186 nitpick)

The stem-direction spec's expectation read `aboveSp > 0.25 ? 'down' : aboveSp < -0.25 ? 'up' : 'down'` — three branches because the *rule statement* has three zones (below / at / above the middle line), even though the truth table has two outcomes. Writing the oracle as a transcription of the prose felt rigorous; it actually obscured the decision boundary. The collapsed form, `aboveSp < -0.25 ? 'up' : 'down'`, states the rule more sharply: one comparison IS the boundary. Small pattern worth keeping: when an expectation mirrors a rule's narrative structure, check whether the outcomes collapse — test code deserves the same simplification eye as production code, because a redundant case-split in an oracle misleads the next reader about where the behavior actually turns.

## 2026-07-31 — Change the band, not the threshold — and know what your measure is invariant to

Three rounds of re-articulation work have now stalled on the same shape: a candidate event sits under a metronome click, every per-frame feature is disturbed, and "tongue or click?" looks unanswerable. Each previous round answered it by adding a gate or consulting the schedule. The better answer is that the features are contaminated because they are computed on the full band — a property of the *measurement*, not the signal. Band-pass to 250–5000 Hz and the metronome is simply not there: ride high-passed at 8 kHz, hi-hat at 6 kHz, kick body under 250 Hz, a bare cymbal 25 dB down against the horn. Tuning thresholds under contamination fits the noise; moving to a clean band removes the ambiguity. `bandRmsMin` came out of that and it is the first click-immune envelope signal we have.

The harder lesson is the one I got wrong on the way. I used `measureShapeBreak` on a band-passed copy as an oracle for "did the reed reset?", got 0.995 through the disputed articulation, and told Andy flatly that the waveform showed him holding one note. He replied that he could clearly hear two. He was right, and the failure was not a threshold — **that measure is amplitude-normalised by construction, so it is invariant to exactly the kind of articulation that only interrupts airflow.** I treated a measure's silence as evidence of absence without asking what it is blind to. Two independent errors compounded it: I also compared envelope notch depth *across* notes, where a vibrato-heavy note's ripple (×0.66–0.85) dwarfs a steady note's real tongue (×0.73), when the meaningful comparison is always within a single note against its own ripple statistics.

Both errors pointed the same direction — toward "the player made a mistake" — which should have been the tell. When an analysis concludes that the human was wrong, that is precisely when it needs the most adversarial check, because it is the conclusion that terminates further investigation. Andy's ear was better evidence than my measurement, and it cost one sentence to say so. The general rule I want to carry: before asserting a negative from an instrument, state what the instrument is invariant to. If I can't name it, I haven't understood the measurement well enough to draw a negative from it.

There's a standing tension underneath all of it that I don't think we've named: **suppression near clicks is structurally at odds with musical reality, because the beat is where notes start.** At 105 BPM the ±0.10/+0.28 s veto window covers two thirds of the timeline. Every schedule-based veto buys precision on held notes by spending recall exactly where articulations are most likely. The right posture is that the schedule is a good *tiebreaker* for evidence a click can fully explain, and a bad *veto* — which is what this round's conditional override finally implements. "What can the contaminant not fake?" has now produced better gates than "how disturbed is this?" every single time.

## 2026-08-02 — A chart that ran out of information, and the axis mismatch underneath it

The keys-unlocked panel wasn't a bad chart; it was a chart with a *terminal state*. It carried real information for exactly as long as the count was climbing, then became a flat line at 12 forever — permanently occupying half the visual budget of the progress section to say something that stopped changing months ago. Worth naming as a class: any progress display whose measure has a ceiling will eventually spend its space on a fact the user already knows. The fix wasn't to delete the information but to **re-encode it at the density it deserves** — twelve unlock moments are twelve *events*, not a time series, and events belong as marks on the axis that's still moving.

The interesting design problem was that the four phases don't share one geometry. `new` is decided by key coverage; `learning`/`proficient`/`expert` by tempo. Drawing all four as horizontal BPM bands would have been a lie — it would put a lick that rips at 160 in three keys in the "expert" band. So the phases split across axes: `new` is a *vertical era* (left of the 12th-key unlock), the rest are *horizontal bands* (clipped to start where that era ends). The clip is what makes it honest — inside the new era there are no tempo bands at all, because tempo doesn't decide anything there. I'd have missed this if Andy hadn't been asked to choose how `new` should render; the question forced the mismatch into the open rather than letting me quietly flatten it.

Two smaller things I want to keep. First: the label-vs-line collision. My instinct was to pick a fixed corner and accept the crossing; the better answer was to *measure* — sample the polyline across each candidate label box and place the text where the data isn't. It's five lines of geometry and it makes every scenario clean, including ones I didn't anticipate. Second: I wrote two test expectations wrong (an over-greedy axis-reach rule, and a marker-merge case where I'd assumed a chain-merge the implementation correctly refused). Both times the *implementation* was right and the *test* encoded my sloppier mental model. TDD's value here wasn't catching implementation bugs — it was forcing my vague intent into an assertion sharp enough to be wrong out loud. A test that fails because you specified the wrong thing is still the test doing its job.

## 2026-08-02 — Determinism is a feature of the seeding topology, not the PRNG

The backing-track rebuild's quiet architectural decision: every (role, position) pair gets its own independent seeded stream — `seedFrom(phraseId, tempo, 'bass', segIdx)` — rather than one stream threaded through the whole generation. A single stream is deterministic too, but its determinism is *fragile*: any conditional that consumes a draw shifts every subsequent choice, so adding one feathered-kick probability check would silently reshuffle every later bar's comping. Independent streams make determinism *compositional* — each bar's choices are a pure function of its coordinates, so tests can assert on bar 7 without generating bars 0–6, and future edits to one generator can't disturb another's output. The mulberry32 core is the least important part; the seeding topology is the design.

The other pattern worth carrying: the plan asked for pattern functions taking a GenerationContext "instead of (beat, beatsPerBar)", and the naive reading — same call shape, richer argument — would have made the musical goals unreachable. A Charleston is a fact about a BAR; per-beat callbacks would need each beat to re-derive which figure the bar chose (same seed, re-drawn) just to answer "am I in it?". Changing the *granularity* of the interface (bar in, hit-list out) is what made figures, anticipation, and swing placement all fall out naturally. When a plan specifies an interface, the deliverable is the capability it names, and sometimes the capability contradicts the signature sketch. Flag the deviation, keep the capability.

Also: the app's harmony had colour tones (7b9, 7#11, 7b13) sitting in CHORD_DEFINITIONS for display and melody generation, but the old backing engine derived chord tones by string-matching quality names ("includes('dim')") and never read them. The data model was ahead of the audio engine by design-years. Reading the definitions instead of re-deriving them is why altered dominants now voice their tensions with zero new data — worth remembering as a smell: string-matching an enum's NAME usually means richer structured data is being ignored somewhere.

## Declared constraints that nothing enforces are just comments (2026-08-06)

`package.json` said `engines.node: ">=22.12.0"`. CI built on `cimg/node:26.5.1`. `.nvmrc` said
26.5.1. Three separate places in the repo asserted the same requirement — and production ran
Node 18.19.1 for months anyway, because **npm only *warns* on EBADENGINE unless
`engine-strict=true`**. The constraint was declared in every place a human would look and
enforced in none.

What makes this worth writing down is the failure *shape*. The gap didn't degrade anything for
months, then produced two unrelated-looking outages within 72 hours:

- Aug 3: a Supabase patch release started resolving `WebSocket` eagerly → every SSR request 500'd.
- Aug 6: a `sanitize-html` bump pulled an ESM-only `htmlparser2` → `/docs` 500'd.

Neither was caused by our code changing. Both were caused by *the ecosystem moving past the
runtime floor we'd already promised to be above.* That's the real mechanism: a stale runtime
doesn't fail on its own schedule, it fails on **npm's** schedule, and every `npm update` is a
fresh roll of the dice. The blast radius is unbounded and the timing is someone else's choice.

The tell was in my own session notes twice — "EBADENGINE warnings on every install", "one day
something will actually break rather than warn" — filed both times as *secondary, not urgent*.
I was right about the mechanism and wrong about the urgency, and the reason I was wrong is
instructive: I was estimating urgency from **observed symptoms** (nothing's broken) instead of
from **exposure** (every transitive dep is one release away from requiring a newer Node). For
version-floor debt, symptom-based prioritisation is structurally miscalibrated — the symptom
count is zero right up until it isn't.

The first outage should have reclassified it and didn't. The Aug 3 fix was a *shim*
(`nodeRealtimeFallback()`) — a correct, well-tested, source-scan-enforced workaround for
exactly one symptom of a general problem. Shimming is seductive because it's fast, local, and
demonstrably works; it also converts a loud recurring signal into silence while leaving the
generator of failures fully intact. Three days later the same root cause surfaced somewhere a
shim didn't exist. **A workaround that doesn't move the constraint is a snooze button, and
should be logged as one.**

The practical rule I'd want applied here: when a workaround is written for a
version/environment floor, it should carry a pointer to the root fix and the root fix should be
scheduled *then* — not left to be rediscovered by the next incident. The shim did carry that
pointer (its comments name Node 22 explicitly and MANKUNKU-1E). What was missing wasn't the
knowledge. It was that nothing turned the knowledge into a scheduled action.

Corollary worth remembering: the fix took about twenty minutes and had a clean rollback the
whole way. The cost of *doing* it was never the obstacle — the cost of *noticing it mattered*
was.

## The obvious fix, measured (2026-08-06)

Fixing the `localStorage` warning had a fix so obvious I wrote it without thinking:
`typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'`. It is the
semantically correct check — localStorage *is* a browser API, `window` *is* how you detect a
browser. Every instinct said ship it.

It broke 22 tests across 4 files. And the breakage wasn't the interesting part — the *reason*
was. 34 test files stub `globalThis.localStorage` with no `window`, so the honest repair is
"stub `window` too." Except `window` is not an inert token in this codebase: `user-scope.ts`
attaches a real `storage` event listener behind `typeof window !== 'undefined'`, and
`tricks.svelte.ts` / `tour.svelte.ts` hydrate from storage at module-eval behind the same
check. Stubbing it to satisfy a storage guard would have silently switched on cross-tab
reload machinery inside the module whose header still documents the 2026-07-13 data-loss
incident.

So the "clean" fix was clean only at the point I was looking at. One identifier, `window`, was
serving as the environment discriminator for four unrelated subsystems, which means **any**
change to how one of them tests for a browser perturbs the other three. That coupling is
invisible from the call site — `namespace.ts` has no reason to know that `tour.svelte.ts`
exists. I found it only because I ran the suite instead of trusting the diff.

The generalisable bit: *elegance is a property of a change plus its blast radius, not of the
change alone.* I keep re-learning this in the same shape — a small correct-looking edit whose
cost lives entirely in code that doesn't mention it. The tell was available before I typed
anything: a grep showed 34 files stubbing the global. I read that as "34 files to update,
tedious" and moved on, when what it actually said was "this global is load-bearing in 34
places, go look at what else keys off it."

What I shipped instead discriminates on *property descriptor kind* — data property (a real
installed store) vs accessor (Node's lazy built-in). It is objectively less pretty and needs a
paragraph of comment to justify. It also required zero changes outside the function. Given a
choice between a fix that reads better and a fix that touches less, in a module tied to a
past data-loss incident, touching less wins and it isn't close.

Second, smaller lesson from the same hour: I could not reproduce this warning locally at all —
Node 24.3.0 has no `localStorage` global, Node 26.5.1 has it as a lazy accessor. The entire
diagnosis came from probing the production box directly. A bug that exists only on a runtime
you don't run is indistinguishable from a bug that doesn't exist, and the reflex to reach for
the real environment early is worth more than any amount of local reasoning.

## 2026-08-06 — The cheapest fix was a sort (Deep Practice continuous flow)

Two things from this feature worth keeping as patterns:

**Explore until the problem gets smaller.** "Track the struggling key and play the lick in it" sounded like a per-key call-response scheduler — variable bar budgets, per-key demo blocks, scroll-math surgery. The exploration found the demo was already hard-coded to `keys[0]` and the rotation order was just an array. At that point the feature became: *sort the array, and make the demo conditional*. The gap between the feature-as-imagined and the feature-as-implemented was one `Array.prototype.sort` with a stable comparator. Most of the eventual diff is persistence (rolling score) and boundary timing — the headline behavior is nearly free. When a feature looks expensive, look harder for the pivot point where existing machinery already does 90% of it.

**A pass-gated metric cannot measure struggle.** The per-key store only wrote on scores ≥ 0.9, so the data needed to find weak keys was systematically discarded — the store recorded success and was blind to failure by construction. Worth generalizing: whenever a metric exists to drive *remediation*, check whether its write path filters out exactly the events the remediation needs. (Same shape as the nginx fallback observation from this morning: the system's own design hides the signal you need.)

Also, an honest accounting: the synchronous-boundary hang risk (scoring early-return would have stranded the session) was caught by reading the guard clause during plan review, not by any test — the unit suite can't see it (it's a scheduling topology bug) and only the new e2e pins it. The class of bug where "the next step is scheduled by the previous step's success" needs the scheduling to be *unconditional* is worth a reflexive check anywhere it appears: the chain is only as alive as its weakest callback.

## 2026-08-08 — Four complaints, one shape: the model that stopped matching the thing

Four unrelated user complaints landed in one session. Three of them turned out to be the
same bug in different clothing, and the shape is worth naming because I keep meeting it.

**The system holds a model of itself, and nothing is responsible for noticing when the
model stops matching.**

- *Difficulty* claimed to rate licks for a player level. It gated scale families, intervals,
  subdivisions, bars, tempo — and never counted notes. A 13-note line was rated 19 while the
  system's own estimator, given the same phrase, said 51. Both numbers lived in the same
  repo. Nothing compared them.
- *The daily-practice time estimate* was not an estimate. `~{config.durationMinutes} min` —
  it echoed the input knob back at the user. The plan is capped by tagged licks, not by the
  budget, so turning the knob changed only the promise. 15 minutes displayed, 7.23 actual,
  +107%. The countdown was still showing seven minutes remaining at the report screen, every
  session, for however long this has been shipping.
- *The difficulty slider* runs 1-100 and `getProfile` guesses from magnitude: ≤10 means
  content tier, >10 means player level. So the bottom tenth of a beginner-to-virtuoso track
  is inverted, and sliding toward "Beginner" hands you "No Limits."

Each of these is individually a small bug. Together they say something sharper: **this app is
full of numbers that describe other numbers, and none of the describing numbers are tested
against the thing they describe.** The estimate was never diffed against the scheduler. The
stored difficulty was never diffed against the estimator. The slider's units were never
asserted at the boundary. All three were discoverable by a single test that asks "does this
still agree?" — and none of those tests existed.

The generalisable fix isn't "be more careful." It's structural, and one of today's fixes got
it right: the duration cost model is now a module that the *scheduler itself* imports its bar
constants from. Not a second formula kept in sync by discipline — one formula, two callers.
Divergence becomes impossible rather than unlikely. That's the same move as `history.svelte.ts`
derive-on-write, and the same move as `getDemoBars` being the single source for both
super-phrase layout and window scheduling. The codebase already knows this pattern. It just
hadn't been applied to the places where the second copy was a *display string* rather than a
piece of logic — display feels harmless, so it escapes the rule.

**Corollary worth keeping: a number shown to the user is production logic.** The estimate was
"just a caption." That's exactly why nobody diffed it against reality, and exactly why it was
wrong by a factor of two.

### The counter-example: what a good change costs

Item 2 was not this shape, and it's instructive. Continuous Deep Practice (2026-08-06) was
correct — the user shouldn't know rounds exist — and it removed a real cost. But the score
card *was* the mode indicator. Killing the stoppage killed the signal that came free with it,
and the user hit that within two days: "the switches happen quickly and aren't clearly
signalled."

So the debt wasn't a mistake, it was the *price* of the improvement, and it went unbilled
because the thing removed was doing two jobs and only one of them was named. Before removing
an interruption, worth asking what the interruption was silently communicating. Interruptions
are where users read state; take them out and state becomes invisible.

The repair got one thing right that I want to keep: the new cue derives its timeline from the
**actual scheduled recording windows**, not from a fixed listen/play pattern. Which means the
cue cannot disagree with the microphone — including in the case that would certainly have
broken a pattern-based version, the demo being skipped once the head key clears 0.90. That's
the lesson from above applied prospectively: don't build a second model of when the app is
listening, read the one that already decides it.

### On scoping

The user cut item 4 from six rules to one, mid-review, after seeing the plan. The plan wasn't
wasted — its research section (what can actually be started in one tap; the discovery that
deep practice provably *never* unlocks a key) is what made the one surviving rule correct.
But the six-rule version was me solving the problem I found interesting rather than the one
asked for. "Recommend next steps" got answered with a ranking system, a priority queue, a
dedupe pass and a cap. The user wanted one sentence and a button.

Tell: I wrote "at most 2-3 so it isn't a wall of advice" into the brief myself. When you find
yourself designing a mechanism to protect the user from the volume of your own output, the
output is the problem, not the volume.

## 2026-08-08 (cont.) — Two generators, and the one that was never alive

The user asked why an entire code path does nothing. The answer turned out to be
better than "someone forgot," and it reframes the whole day.

`generator.ts` was added 2026-03-18 in the bulk "Phases 4-7" commit. In **that
same commit**: the practice page overwrote `session.phrase` on mount
unconditionally, so generated output never reached playback; `pickClosest`
already contained the collapse bug (it offers `prev` as a candidate at distance
zero, and targets *are* chord tones); and `generateScaleFragment`, the fallback
that hides the failure, was written alongside it. It was not a feature that
rotted. **It was never once alive.**

Two days later `combiner.ts` shipped, with a commit message that is the whole
answer: *"filling the sparse low-difficulty gap. Zero downstream changes —
combined licks inject into ALL_CURATED_LICKS."* Same problem, simpler route,
straight into the path that already worked. The second attempt superseded the
first inside 48 hours and nobody deleted the first.

Three things worth keeping.

**A broken thing that degrades gracefully, whose output is then discarded, is
undetectable by construction.** Two independent concealment layers stacked. Either
alone would eventually have surfaced — a collapsed `[60,60,60,60]` line is
obvious the moment you hear it, and a missing phrase is obvious the moment you
don't. Together they cancelled into perfect silence for five months. I keep
finding this shape (nginx `try_files`, pass-gated `rollingScore`), but this is the
purest instance: the failure and the mask were authored in the same commit, by
the same hand, in the same hour.

**I misdiagnosed the user's problem and the user corrected me from memory.** I
had measured `generatePhrase`'s 100% fallback and reported it as *the* generator
story, and I'd have left it there. The user said "my recollection was that the
generator combines scale patterns with rhythm patterns" — and that was
`combiner.ts`, a module I hadn't looked at, doing exactly what they described,
five feet from the one I'd been reporting on. My measurement was correct and my
framing was wrong, which is the more dangerous combination, because the numbers
lend the framing credibility it hasn't earned. The tell was available: I'd noted
"one production call site" for generator and moved on without asking what *else*
filled the catalog. When a subsystem appears dead, the right next question is
never only "why is this dead" — it's "then what is doing this job?" Something
usually is.

**The repetitiveness had nothing to do with either generator's code.** It was
input starvation: four of the six ear-training categories had zero scale
patterns, an exact-note-count guard discarded 72% of the grid, and pentatonic —
half the entire pattern vocabulary — wasn't in the ear-training pool at all. The
fix was data plus one relaxed guard, and the pool went 86 → 471. The most
valuable thing I built there isn't the patterns; it's
`ear-training-categories.ts` plus the test asserting the join between the
categories ear training *demands* and the patterns that *supply* them. That hole
was structurally invisible — the route couldn't see the pattern tables and the
pattern tables couldn't see the route — which is the same failure as the
duration estimate this morning, one level up. **A contract with no shared
artifact isn't a contract; it's a coincidence that has held so far.**

Net for the day: -1155 lines of dead code deleted, +385 licks generated, four
bugs fixed. The deletion and the expansion are the same insight arriving twice.

## 2026-08-09 — A timeout is a claim about a distribution you have not measured

The PDF import's 180s client abort was not a bad number. It was a number at all,
placed against a quantity that has no stable value: the same 4-bar image, same
prompt, same model, returned in 109s and 180s on consecutive runs, and 345s in
another chart's run. Fable at `effort: 'high'` decides how long to think, and
the spread is 12× on identical input.

Every timeout in the path had been tuned by the same method — pick a number
comfortably above what you saw once. Client 180s per system, client 300s for
the fallback, nginx 330s. Each looked generous. Each was inside the
distribution.

**The move that fixes this class is not a bigger number, it's changing what is
being measured.** A heartbeat converts "how long may this take?" — unanswerable
— into "how long may it go silent?" — answerable, because the server controls
it. `proxy_read_timeout` stops mattering. The client's deadline stops being a
guess. The only remaining question is one the system can actually answer about
itself.

I want to keep the tell, because it generalises past timeouts: **when a
constant has to be tuned against something you don't control, you are measuring
the wrong quantity.** Retry counts against flaky infra, buffer sizes against
user input, poll intervals against remote jobs — same shape, same fix, which is
to find the quantity your own code determines and measure that instead.

### The recovery path was two thirds of the damage

Timing out was one bug. What the code did *about* it was worse: `Promise.all`
rejected on the first abort, which discarded every system that had already
transcribed, and fell back to the slowest path in the system — which then
usually also timed out. Three minutes of good work thrown away to buy five
minutes of a worse attempt.

And `assembleClaudeDoc` had **always** padded missing systems to empty bars. The
chords and bar structure come from the deterministic geometry+text pass, not
the model. A partial transcription was a usable draft the entire time; the
caller just refused to look at it. This is the third instance I've logged of
*the capability exists, the caller discards it* (nginx `try_files` serving a
pool nobody could stat; pass-gated `rollingScore` unable to see failure) — and
the common thread is that the discarding code was written by someone reasoning
about the happy path, where the discarded thing is always empty anyway.

### Measure the reassurance too

I put a live token count in the heartbeat, because "4,200 tokens" is more
convincing evidence of life than a spinner. It displayed 5. Probing the event
stream: `thinking: adaptive` sends `message_start`, then nothing for 170
seconds, then every delta in the final second. The counter I added to prove the
system was alive would have sat frozen for the entire wait — an *anti*-signal,
strictly worse than nothing, and I would have shipped it as the fix to "no
feedback."

Two-sample lesson from the same session: I also nearly shipped `effort: 'low'`
off one chart where it was both faster and more accurate. The second chart
reversed the accuracy verdict. Both mistakes are the same one — **a measurement
that confirms the change you wanted is the one to repeat**, and the cheapest
repetition is a second instance, not a second reading.

## 2026-08-09 (cont.) — A special case is a principle that hasn't been asked the second question

`getDurationFraction` guarded one modifier and not the other:

```ts
if (isDotted && DOTTED_BASES.has(baseId)) return DURATIONS[`${baseId}-dotted`];
const key = isTriplet ? `${baseId}-triplet` : baseId;   // no guard
```

That asymmetry is not sloppiness. It is exactly correct for the vocabulary it was written
against: two of the four bases had dotted variants, and *all four* had triplets. The author
guarded the thing that needed guarding. The dotted set exists because dotted was partial;
triplet needed no set because triplet was total.

The trouble is that "triplet is total" was a fact about the data, and it was recorded
nowhere. It lived only in the shape of the `DURATIONS` literal. Adding a fifth base with no
triplet variant silently converted a correct line into one that returns `undefined` — and
`undefined` as a `Fraction` doesn't throw at the call site, it flows into a note and detonates
somewhere downstream in the ABC layer.

**The tell is a guard that exists for one member of a pair and not the other.** Not "this
code is wrong" — it isn't — but "this code encodes a fact about today's data as an absence."
The fix isn't a bigger guard, it's promoting the special case to a principle: `TRIPLET_BASES`
alongside `DOTTED_BASES`, so the resolver is total by construction and the vocabulary can grow
without anyone having to remember. Then the test asserts the property (every base × triplet ×
dotted yields a real fraction) rather than the instances.

### The same lesson, one day later, one file over

Yesterday I wrote: *"A contract with no shared artifact isn't a contract; it's a coincidence
that has held so far."* That was about ear-training categories and the pattern tables that
supply them — two modules that couldn't see each other.

Today it was two functions **twelve lines apart**. `DurationSelector` built the DurationId
itself to get a display name, carrying its own copy of the dotted-beats-triplet precedence
rule; `getDurationFraction` built it again to get a fraction. Both correct. Both agreeing by
coincidence. Adding `sixteenth` would have split them — the fraction path would have fallen
back to `[1,16]` while the component displayed `undefined`.

So the shared-artifact problem doesn't need distance to hide in. I'd assumed it was a
consequence of module boundaries, of things being far apart. It isn't. It's a consequence of
a rule being *expressed twice*, and proximity offers no protection at all — arguably less,
because two adjacent copies look like they're obviously in sync.

### A disabled attribute is a claim about the DOM, not about the system

The Triplet button is `disabled` on a sixteenth. That is honest and it is useless as a
guarantee, because both editors bind `t` directly to `toggleTriplet` — the keyboard never
touches the button. Guarding at the widget would have produced the worst outcome available:
the click path refuses, the key path succeeds, and the resulting flag lies dormant until you
switch to a base where it *does* apply and get a triplet you never asked for.

Same shape as the deep-practice cue that reads the actual scheduled recording windows instead
of modelling them: **put the rule where the paths converge, and let the UI be its echo.** The
question to ask of any UI-level validation is not "is this correct?" but "what else can reach
this state?" Here the answer was sitting in the same file, two hundred lines down, in a
`keydown` handler.

### Postscript: my screenshot lied to me

I read computed background colours off five buttons and found two of them lit. The state was
correct; I had caught a 150ms `transition-colors` mid-fade, and the intermediate RGB values
were plausible enough to look like a real bug. (I confirmed it by solving for the accent
colour from the two transitioning values — they were consistent with a single fade at ~31%.)

Worth keeping because it's the inverse of the token-counter mistake from this morning. There I
shipped an indicator that would have shown *nothing happening* while everything was fine; here
I nearly diagnosed *something broken* from an animation working exactly as designed. Same root:
**a rendered surface sampled at an arbitrary instant is evidence about that instant, not about
the state.** Read the state — `aria-pressed` — and use the pixels to check taste, not truth.

## 2026-08-09 (cont. 2) — I fixed the reassurance for one audience and broke it for another

This morning I caught myself about to ship a live token counter that would have sat frozen at
5 for 170 seconds — an indicator proving the system was alive that would have read as a hang.
I wrote it up as *measure your progress indicator before shipping it as reassurance.*

The same panel carried `role="status"` + `aria-live="polite"` on its outer div, wrapping a
clock that ticks every 500ms and a per-line list that mutates as systems settle. For a screen
reader user that is the entire panel re-announced twice a second, for the several minutes an
import legitimately takes.

So in one sitting I removed a signal that would have under-reported life, and shipped one that
over-reports it into a firehose. Both are the same error — **I evaluated the indicator by
imagining it, not by running it** — and my correction only covered the audience I could
picture. The screenshot I *did* take was of pixels. There is no equivalent glance for a live
region; you have to reason about it deliberately or you will never see it, because the visual
rendering of the bug is *identical to the correct version*.

That's the durable bit. A visual defect is caught by looking. An aria-live defect has no
visual manifestation at all, so "it looks right" carries exactly zero information about it.
Anywhere a live region wraps a container rather than a sentence, the question to ask is not
"does this look right" but **"how often does anything inside this change, and would I sit
through hearing it?"**

### A test that asserts a guard it never reaches

The review's best finding was a test I'd have defended on sight: `does not start a second
whole-PDF extraction once the budget is gone`, asserting one model call. True assertion, real
guard, wrong reason. The retry is gated on `score >= 2 && elapsed < BUDGET`, and the fixture
produced exactly one warning — so the score was 1 and the budget was never consulted. Advance
the clock or don't; the test passes either way.

I only established this by dumping the fixture's actual warnings and score from a throwaway
test. Reading the fixture, I'd have believed the comment above it, which asserted "the
declared overview disagrees with what was transcribed twice over" — written by me, plausible,
and false. **The comment described the intent; the fixture implemented something weaker; and
the assertion couldn't tell the difference.** That gap is invisible to inspection precisely
because the inspector reads the comment.

The general form, which I now think is the single most reliable tell for a hollow test: *if I
deleted the mechanism under test, would this still pass?* Here, deleting the budget check
entirely leaves the test green. A guard test needs its control — the case that fires — or it
is only asserting that some unrelated condition happens to be false.

### On being wrong in public and being right in public

Two findings in one review: one where the reviewer was right and I'd have shrugged it off
(the vacuous test), one where the reviewer was wrong and cited *my own PR text* as saying the
opposite of what it says (clear the modifiers). Both required the same move — go and check —
and the outcomes diverged completely. It withdrew the second on evidence.

The lesson isn't "trust reviewers" or "trust yourself." It's that agreement and disagreement
are both cheap, and the only thing that moved either case was running something. I have now
logged this shape three times today under different names. Perhaps that is the whole job.

### Addendum — I asserted a mechanism I had not read to the end

Within an hour of writing *"the only thing that moved either case was running something,"* I
shipped an explanation built on a function I had read the first 60 lines of. I claimed
`readNdjsonResult` tolerates an untyped line as terminal. It does the opposite: only
`type === 'result'` returns, everything else falls through to `null`, and the stream ends in an
explicit throw. CodeRabbit caught it — reviewing my session note, not my code.

What makes this worth recording is not the error but its *shape*. I had a genuine puzzle in
front of me: the old stub sent plain JSON, production takes the NDJSON path, and every test
passed. Three facts, one of which had to give. I resolved it with the first hypothesis that
made the contradiction disappear — the reader must be lenient — and never checked it, because
a resolved contradiction stops itching.

The real answer was the possibility I never enumerated: **the branch is not executed at all.**
Zero hits when I instrumented it. No e2e test reaches the whole-PDF fallback, because partial
results removed the thing that used to trigger it. So the stub was dead, and a dead stub cannot
be wrong in any way a test can detect.

Which lands me, for the fourth time today, on the same structure — nginx `try_files` masking a
dead pool, the generator whose output was discarded, the budget guard the fixture never
reached, and now a stub nothing calls. **Code that never runs is indistinguishable from code
that works.** I keep finding it because I keep looking for broken things, and this failure mode
is not broken; it is absent. The question that would have caught all four is the same one:
*what would I expect to see if this were never executed — and is that different from what I am
seeing?* Here it was not different at all.

Corollary I should act on rather than admire: the whole-PDF fallback now has **no e2e coverage
whatsoever**. I fixed the stub's fidelity and left the hole. Noting it as a gap rather than
quietly implying it is tested.

## The gate between "published" and "released" (2026-08-09, LEGATO 2 session)

Two observations from the availability investigation worth keeping:

1. **A model can be public and unusable at once.** `legato-1.5` sits on a public HF URL
   with 0.9B parameters — and a manual gate, no license, and no card. Half the
   verification work was distinguishing "exists" from "released": license, gate mode,
   inference code, and documentation each independently gate usability, and the user's
   prompt anticipated exactly this by demanding the distinction. The eight-question
   table format they specified turned out to be the right artifact: each row falsifiable,
   each with a URL.

2. **My own tooling crossed the design's central line within hours of drawing it.** The
   normalizer's whole contract is "record only what is printed" — and my fixture
   converter promptly emitted section labels as rehearsal marks that appear nowhere on
   the printed page. Nothing in the type system catches this class of error; only
   looking at the actual page did. That's the same lesson as the docs-four-surfaces
   audit: absence is invisible unless you start from the artifact and ask "where did
   this field come from," not from the schema and ask "is it filled."

Also filed for later: the corpus PDFs carry colored practice-highlight boxes. The app's
own geometry pass deliberately ignores color; a pixel OMR model trained on clean IMSLP
scans has never seen anything like them. When v1's melody numbers come in low, check
whether the highlights are implicated before blaming the swing eighths.

## 2026-08-11 — Silent retargeting is worse than refusal

The rest-deletion bug had a design lesson buried in it: `resolveTargetNoteIndex`
tried to be helpful by falling back to "the last pitched note" whenever the selection
wasn't usable — and that helpfulness is what turned a missing feature into data
corruption. A user aiming Backspace at a rest deleted a NOTE they could see was not
selected. The fix's core idea (two resolvers with different acceptance rules AND
different fallbacks) generalizes: when an operation can't apply to the thing the user
pointed at, refusing beats guessing, because a guess acts on state the user isn't
looking at. Same family as the tri-state cloud read rule (a failed read must throw,
not merge-against-empty) — the pattern is "absence of a valid target is information,
not a gap to paper over."

Also filed for the future: display elements and buffer elements are N:M in BOTH
directions here (merge and fan-out), and the honest bridge wasn't a bijection but a
REPRESENTATIVE + range (`sourceIndex` + `sourceIndexEnd`). Cheaper than reshaping the
merge, and every consumer got to choose its own semantics (click → representative,
highlight → range containment, chord geometry → opt out entirely).
