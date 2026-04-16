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

### Display written pitch in the UI — never concert
Every key, note, pitch class, or tonality label rendered in the UI must be in the user's written pitch. This applies everywhere: home page tonality labels, practice/scales headers, key selectors, chord charts, progress displays, session reports, lick card tags, diagnostics. No exceptions.

**Why:** The user is a transposing-instrument player. Concert pitch is canonical internally; the user never wants to see concert pitch on screen. This error has recurred many times.

**How to apply:** Before displaying ANY key or pitch, call `concertKeyToWritten(key, getInstrument())` or `displayRoot()`. When reviewing or writing template code, flag any raw `PitchClass` rendered without going through that conversion.

### Metronome beat 1 must use kick drum (all branches)
Beat 1 must always use the kick (`MembraneSynth`), not ride cymbal. Both the finite metronome and the infinite-loop branch (used during recording) must do this — the infinite-loop branch has previously regressed to ride-only.

**Why:** Without a distinct downbeat, the bar boundary is hard to feel while recording.

**How to apply:** When touching `scheduleMetronome()` or adding new metronome patterns, verify ALL branches use kick on beat 0.

### Always follow the design system
The Mankunku app has a written design system at `documentation/architecture/design-system.md`. Read it before any cosmetic, color, layout, typography, or styling change.

Key principles to keep in working memory without re-reading every time:

- **Three color domains**, all controlled by a single `--color-accent` CSS variable, switched via a `[data-domain]` attribute on the layout root:
  - **Ear Training** (blue, `#3b82f6` / `#2563eb`) — `/practice`, `/practice/settings`, `/scales`, `/record`, `/progress`
  - **Lick Practice** (green, `#22c55e` / `#16a34a`) — `/lick-practice`, `/lick-practice/session`
  - **Neutral** (slate, `#94a3b8` / `#475569`) — `/`, `/library`, `/add-licks`, `/entry`, `/settings`, `/auth`, `/diagnostics`
- **Single-variable theming**: don't hardcode hex values, Tailwind color classes (e.g. `text-blue-500`, `bg-green-500`), or new CSS variables for accent purposes. Use `var(--color-accent)` / `var(--color-accent-hover)` and let the data-domain override do the work.
- **Subtle, not decorative**: backgrounds, text colors, layout, spacing, typography, and component shapes stay constant across domains. Only the accent variable changes.
- **The `practice` tag's green star icon on `LickCard` stays green** even on neutral library pages — it identifies a lick tagged for lick practice, not page chrome. (One intentional exception.)
- **Light + dark parity**: every override needs both `:root [data-domain='…']` and `:root.light [data-domain='…']` rules.

**Why:** The user defined this system on 2026-04-09 to make Ear Training and Lick Practice visually distinct without making them feel like two unrelated apps. Drift undermines the whole point.

**How to apply:** If a request would deviate from the spec, push back and propose a spec amendment instead of silently ad-hoc-ing it.

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

### Skip redundant git checks; chain add/commit/push
When changes are already known from the current conversation, skip `git diff` / `git log` and chain `add` + `commit` + `push` in a single Bash call.

**Why:** The bottleneck is model inference time between tool calls, not git itself. Fewer calls = fewer inference rounds = dramatically faster. A trivial commit+push once took 8 minutes because of unnecessary sequencing.

**How to apply:** `git add <files> && git commit -m "..." && git push` in one shot. Parallelize independent reconnaissance calls. Chain dependent ones.

### CodeRabbit autofix — fetch all comment sources
The GraphQL `reviewThreads` query only returns inline diff comments. CodeRabbit also posts:

- PR review bodies (`reviews` endpoint)
- Outside-diff comments
- Top-level PR comments

**Why:** Missed valid CodeRabbit findings on PR #28 because only inline review threads were queried.

**How to apply:** Use multiple API calls covering all comment locations, or ask the user to paste any missed comments.

### Proactively autofix CodeRabbit comments after every push
After any `git push` to a PR branch, automatically wait for CodeRabbit's review to complete (~2-5 min), then fetch ALL comments and fix valid ones. Don't wait for the user to ask.

**Why:** The user doesn't want to manually trigger autofix every time.

**How to apply:** Poll for CodeRabbit review completion after every push, run the autofix flow, check all comment sources.

---

## Reference map

- **Design system spec**: `documentation/architecture/design-system.md`
- **Architecture overview** (with module dependency diagram): `documentation/architecture/overview.md`
- **All architecture docs**: `documentation/architecture/` (audio-pipeline, data-model, scoring-algorithm, state-management, tech-stack, tonality-system, adaptive-difficulty, phrase-system)
- **PRD**: `PRD.md`
- **Project conventions**: `CLAUDE.md`
- **Independent observations**: `CLAUDIUS/observations.md`
- **Sessions log**: `CLAUDIUS/SESSIONS.md`
