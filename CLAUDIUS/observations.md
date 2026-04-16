# Independent Observations

Running notes from working on Mankunku. Newest at the top. Not deleted unless proven wrong — patterns only become visible over time, so keep the trail.

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
