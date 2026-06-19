# Independent Observations

Running notes from working on Mankunku. Newest at the top. Not deleted unless proven wrong — patterns only become visible over time, so keep the trail.

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
