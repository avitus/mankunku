# How to Practice

Mankunku is a call-and-response app. The app plays you a phrase; you play it back; it scores your accuracy and either moves you on or hands you a retry. Around that loop are two main practice modes (Side A and Side B), a **Tricks** room for practicing melodic devices rather than fixed lines, a surface where you apply all of it over a real tune, your books of licks and tunes, and a progress dashboard.

This page walks through the practice flow as it actually feels in the room — what to listen for, what to do with your horn in your hands, what each setting changes.

## The dashboard

When you open the app signed in, you land on the home page. It's the front cover of the LP. (Signed out, the same URL shows a descriptive landing page about the app instead — sign in and the dashboard below takes its place.) From here you can:

- Jump straight into **Side A** (Ear Training) or **Side B** (Lick Practice).
- See your **streak** — consecutive days you've practiced. Skip a day and it resets to 1; the longest streak you've ever held is preserved separately.
- See **today's key** — the key + scale rotating today. You can override this on the Settings page.
- See your current **level** (1–100) on the active scale, plus the count of licks you've **tagged** for Side B.

If today is your first day, you won't have a streak or a level yet. Hit Side A and start.

Everything else is in the top nav: **Licks**, **Tricks**, **Tunes**, **Progress**, **Docs**, **Settings**. (The dashboard's small link row skips Tricks — the nav is the way in.)

## Side A — Ear Training

This is the call-and-response loop.

### The flow, beat by beat

1. **Pick up your horn.** The page is deliberately bare — today's key and scale, one big button, and a score. Nothing to configure at the last second.
2. **Press the big button once.** That starts a *loop*, not a single phrase. The app plays a phrase through your speakers (or headphones) with a metronome ticking underneath, then hands the beat to you, then scores you, then goes straight into the next one. You press the button again (it becomes a stop icon) when you want out.
3. **Listen all the way through.** Don't start playing along. The phrase usually sits inside one or two bars; let the whole thing land in your ear before you reach for it. There is **no sheet music on this page** — that's the point. It's ear training, not reading.
4. **Play it back.** When the phrase finishes, the metronome keeps going so you have a beat to lean on. Play the phrase as you heard it. The app is already listening when your turn starts — so your first note's attack is always captured cleanly — and the take is trimmed back to just before your entrance, so taking a moment to come in costs you nothing.
5. **Stop playing.** After about two seconds of silence, the app decides you're done.
6. **Read the score.** Your overall percentage lands next to the button, coloured by its grade — Perfect, Great, Good, Fair, or Try Again — with **Pitch** and **Rhythm** broken out underneath it. It takes a beat to appear: the number you see is the *definitive* re-score of the actual recording, not a live estimate (or the live score, in the rare case the recording can't be replayed), and once it's up it never changes. A liner-note caption sits at the bottom of the screen quoting the giants ("right in the pocket," "cookin'," "take it again from the top," and so on). The score stays put until the next one replaces it.
7. **Move on, or retry.** Above 70% counts as a pass and the loop rolls on to a new phrase. Below that, the *same* phrase comes round again so you can take another swing — you don't have to do anything.

When your level moves, a small cue flashes under the status line: *↑ Blues · Lv 23*. That's the adaptive system telling you it's noticed.

### What you can change, and where

Ear Training has no in-page settings panel — everything it uses comes from the global **Settings** page, so you set it once and then just play. Under **Settings → Ear Training**:

| Setting | What it does |
|---|---|
| **Key Center** and **Scale Type** | Override today's automatic pick with any *unlocked* key + scale combination. Locked ones are visible but disabled, with a tooltip naming the proficiency they require. A **Reset to daily** link appears once you've overridden, and a counter underneath shows how many keys and scales you've unlocked so far. |
| **Tempo** | 60–200 BPM, in steps of 5. This is the starting tempo for new practice sessions. Most players start in the 80–110 range. |
| **Swing** | 0.50 (straight eighths) to 0.80 (heavy). 0.67 is the usual triplet swing; the app ships at 0.62, a moderate jazz swing. At exactly 0.50 the band stops following the knob and swings by tempo instead — slower tunes lope harder, fast ones straighten out. |
| **Metronome** | On/off, plus a level knob when it's on. |
| **Backing** | On/off, the comping voice (Piano or Organ), and a level knob. Despite living in this section, these apply to the *backing track* — Lick Practice and Tune Practice — not to Ear Training, which never plays one. |

What you **can't** set: the phrase pool. The app draws from the curated catalog plus your own and adopted licks, caps it at your proficiency level in the active scale, filters it for scale compatibility (see below), and shuffles. There's no category, difficulty, or bar-count dial — difficulty is the adaptive system's job. The tonality controls on the main Settings page are the ones that shape what you hear.

### What's on screen while you're playing

The screen is intentionally almost empty:

- **Today's key**, the scale name, and how many notes that scale has ("5 notes", "7 notes") — the palette you're drawing from.
- The **big button**: play when idle, stop when running, a spinner while the instrument samples load ("Tuning up…").
- The **score** from your last take, held until the next one lands.
- The **status text**, which is your metronome for the loop: *Listen…* while the phrase plays, *Your turn — play!* once it ends, *Listening…* once your first note hits.
- A discreet **practice timer** in the top-left corner, counting the time you've actually spent in the loop.

There's no pitch meter or input-level meter on this page. If you want to see what the detector is hearing — cents sharp or flat, clarity, the notes it segmented — that lives on the diagnostics page, not in the practice loop.

### Scale-aware filtering

Not every lick fits every scale. A 7-note major lick squashed into a 5-note pentatonic session would lose two of its notes and stop sounding like itself, so the app filters: in a pentatonic session you only see pentatonic licks; in a Lydian session you see Lydian-compatible licks; and so on. The note count for the active scale shows up in the header (e.g. "5 notes" for pentatonic, "7 notes" for major) so you know what palette you're drawing from.

If filtering would leave you with too few licks at your difficulty, the app widens to all licks at that difficulty — better to practice something than nothing.

## Side B — Lick Practice

This is the 12-key drill. It picks a lick from your **tagged** collection and runs it through every key over a backing track, scoring each pass.

### Setting it up

Before your first session, go to **Licks** and tap the star on a few licks you want to drill. Tagged licks become your Side B practice book. Each tagged lick also needs at least one **progression tag** — the *Practice over* pills on its detail page, which say which backing tracks it plays cleanly over. A tag gets seeded for you the first time you set a lick's category, when that category maps cleanly onto a progression (a ii-V-I lick gets ii-V-I major). That is a one-time write, not an ongoing guess: the app never infers a missing tag later, so a lick with no tag stays out of Side B, and a tag you delete stays deleted.

When you open Side B, you choose:

- **Progression type** — what the backing track plays underneath. Ten of them: minor, major, and dominant vamps; short ii-V-I in major and minor; long ii-V-I in major and minor; turnaround; iii-VI-ii-V-I; and blues. Each lick's category determines which progressions it lands cleanly on by default.
- **Substitutions** — toggle to introduce tritone subs and chromatic approaches. Same lick, harder harmony.
- **Backing style** — Swing, Bossa Nova, Ballad, or Straight. See [The band](#the-band) below for what each one actually plays.
- **Practice mode** — *Continuous* plays the lick once as a demo in the first key, then you play it through all 12 keys back-to-back over a non-stop backing track. *Call & Response* skips the upfront demo and instead, in every key, the app plays the lick first and you echo it on the next cycle, alternating through all 12 keys. Both modes score every key the user plays.
- **Tempo** — starting BPM for this lick. After each lick, the tempo adjusts based on your average score across that lick's keys: +2 BPM at 95%+, +1 BPM at 90%+, -1 BPM in the 75–89% yellow band, and -3 BPM below 75%. A single key scored below 75% blocks *any* upward adjustment, even if the average looks good. A session that unlocks a new key drops the tempo 10% instead of bumping it — rounded to a whole BPM and never below the 50 BPM floor — so the new key starts with headroom.

A single **Start** button sits at the bottom of the setup screen. Its label changes to match the **Session Type** you pick at the top of the screen, which offers four:

- **Daily Practice** (*Start Daily Practice*) ignores the picked progression and rotates across every progression you've tagged licks for, fitting the session into the same time budget. Each lick gets paired with whichever of its eligible progressions you've practiced least recently. Use it as your default daily warm-up so every line gets time on the clock.
- **Focused Session** (*Start Session*) runs licks tagged for the progression you picked above. It's the right choice when you want focused work on one harmonic context.
- **Deep Practice** (*Start Drill*) drills a single lick you pick here through its currently-unlocked keys. See [Single-Lick Deep Practice](#single-lick-deep-practice) below — it's also launchable from the Practice button on a lick's detail page.
- **Tricks** — *drill a melodic device*. Not a lick at all: a formula (enclosures, triad pairs) practiced for fluency rather than exact reproduction. It shares the same session engine, so it feels like Deep Practice with a regenerated phrase each round. See [Practicing Tricks](./tricks.md).

### The band

The rhythm section is generated, not looped: bass, comping (piano or organ, your pick in Settings), and drums, played fresh each time from a seeded engine. It doesn't repeat a two-bar sample at you.

| Style | Bass | Comping | Drums |
|---|---|---|---|
| **Swing** | Walking quarters with a shape — the line arcs up and down over four-bar groups and approaches each new chord by a chromatic, scalar, enclosure, or dominant lead-in. | Real figures rather than random stabs: Charleston, and-of-2, off-beat pairs, whole-bar pads, Red Garland two-bar shapes, and rests. Off-beat hits voice the *next* chord — the comping instrument anticipates the change. | Spang-a-lang ride, hi-hat foot on 2 and 4, feathered kick. The ride flavour changes bar to bar: plain quarters one bar, an extra skip the next, a broken pattern after that. |
| **Bossa Nova** | Not walking. Root on 1, fifth (or the new chord's root) on 3, with soft eighth pickups. It sits still. | Short syncopated chords tracking the same clave side as the rim-click. | Cross-stick clave, steady hi-hat eighths, a surdo-style kick on 1, the and-of-2, 3, and the and-of-4. The clave side is picked once and held for the whole phrase. |
| **Ballad** | Two-feel, permanently — half notes all night, no walking escape hatch. | Pads and space, and genuinely silent bars. Wider, more open voicings. | The whisper kit: soft ride quarters, hi-hat foot on 2 and 4, barely-there kick, and one piece of colour per bar at most. |
| **Straight** | Same walking planner as swing. | Same figures as swing, but resting more often — even eighths clutter faster than swung ones. | The swing vocabulary at even eighths, plus a cross-stick on beat 4 in about a third of bars. |

Two things about **swing feel** are worth knowing:

- The **Swing** knob in Settings applies to the **Swing** style only. Bossa Nova, Ballad and Straight each declare their own eighth-note feel — a bossa is straight whatever the knob says — and both you and the band are held to it, because a rhythm section can't be on a different grid from the soloist. So on those three styles the knob does nothing, and Ballad will lean very slightly (0.55) even with the knob at 0.50.
- With the knob at 0.50, Swing chooses its own ratio *from the tempo*, the way players actually do: deep and loping at slow tempos (about 3.5:1 up to 132 BPM), relaxing toward an even triplet feel by 200, and nearly straight above 240. This applies to the band only — what the scorer expects from you never changes with tempo.

**What the drummer does and doesn't do here.** In Lick Practice you'll hear the ride and snare conversation, the odd Philly Joe bomb (a lone accented kick off the grid) or a side-stick lean at four-bar boundaries, and the kick catching the piano's pushes. What you *won't* hear is the big stuff — crashes on section arrivals, setup fills, the long fill over a chorus turn. Those hang off a tune's form, so they only show up in [Tune Practice](./tune-practice.md), where the band also builds chorus over chorus.

### What happens during a session

The session opens with a **one-bar count-in** — a metronome bar with a thump on 1 and a hi-hat chick on 2 and 4 — and then the click stops and the band takes over. (Layering a synthetic click on top of a sampled kit was the loudest fake thing in the mix, so it goes away once there's a real drummer.) You see:

- A header with the current **lick name**, the **key** you're playing it in, its progression, and where you are in the rotation ("Key 3 of 7").
- A **scrolling stack of chord blocks** — one row per upcoming key, drifting upward at exactly one row per key so the row you're playing is always in the same place. The active row carries the beat, a recording ring while your window is open, a *Listen* tag while the app is demoing, and your score the moment the window closes.
- A **key progress ring** with your current tempo in the middle, colouring each key as you score it.
- A **session timer** with a progress bar (standard and daily sessions only — Deep Practice and Tricks have no time budget, so there's no countdown).
- An **End Session** button.

There's **no sheet music during a session**. You read the changes, not the line. If you need to look at the notation, do it on the lick's page before you start.

You play the lick once per key, with no retries. After all of that lick's keys play through, two things happen:

1. **Tempo adjusts** based on your average score for the lick: +2 BPM at 95%+, +1 BPM at 90%+, -1 BPM in the 75–89% yellow band, -3 BPM below 75%. Any single key under 75% blocks tempo *increases* but doesn't block decreases — you lose ground on a lick you can't hold together. The gain steps deliberately match the -1 loss step closely, so a lick hovering right at 90% holds its tempo instead of drifting upward on variance alone.
2. **The next key may unlock.** New keys earn their way into the rotation only when both your average score is at least 90% *and* the most-recently-added key has been passed cleanly three times (≥ 90% per attempt, one attempt per session). A floor failure (any key below 75%) blocks the unlock outright. Tempo can keep climbing without the rotation growing — so you'll often speed up on the keys you have before the next one appears.

When a key does unlock, the tempo **drops 10%** instead of taking that session's bump — rounded to a whole BPM, and never below the 50 BPM floor (a lick at 54 lands on 50, not 49). An unlock only ever follows a strong session, so without the drop the brand-new key would arrive *faster* than the tempo that earned it — instead it arrives with headroom, and you win the speed back as you consolidate the bigger rotation. On the lick's progress chart this reads as a sawtooth: climb, unlock, dip, climb again.

When the session ends, the report closes with a single **Next** card — one recommendation, or none. If you averaged under 75% over eight or more keys it tells you to call it for today (more reps now just rehearse the mistakes). Otherwise it names the single weakest key under 75% across the session — *Drill D on Bird Blues. It came in at 41%* — or, if no key tripped the floor, the weakest lick overall, and offers to start Deep Practice on it in one tap. When it names a key, that button launches the [focus drill](#single-lick-deep-practice): Deep Practice that opens on that key alone.

### The traffic-light tiers

The key progress ring and the post-session card both colour each key by how it scored:

- **Green (≥ 90%).** A clean pass. Green keys count toward unlocking the next key and toward tempo bumps. The "all clear" brass glow on the ring only fires when every key in the rotation is green.
- **Yellow (75–89%).** Passable but not consolidated. Yellow keys don't block anything from happening — they just don't earn it. You're still in the rotation; nothing decays.
- **Red (< 75%).** Below the floor. A single red key holds the brake on tempo increases and unlocks until you bring it back up. This is the app's way of saying *don't move on until you've actually got it.*

In a standard or Daily session, once you've cycled through every currently-unlocked key for the current lick, the finished lick holds on screen for one more bar — long enough for that last key's score dot to actually land, and, when every key came up green, for the all-clear brass glow to sit there a beat — before the chart flips to the next tagged lick. In that gap, with the backing track on, a quick two-chord **ii-V** comps you into the next lick's first key so your ear is set before its downbeat; the cue is mode-matched — a half-diminished ii into minor tonics, a plain ii-V otherwise. The next lick still starts on the same beat it always did. The session ends when the time budget runs out or every lick has had its turn.

### Single-Lick Deep Practice

Sometimes you don't want the rotation across your tagged book — you just want to *own* one specific line. Open a lick from your book, hit the **Practice** button on its detail page, and Side B launches in single-lick mode (also called Deep Practice in the session header).

**It does not stop.** This is the big difference from a standard session. There are no rest bars, no round-complete card, nothing to dismiss. The keys run back to back, and between one cycle and the next the band plays a **one-bar ii-V turnaround** into the key you're about to play. The music never breaks; you just keep going until you hit End.

How a cycle works:

- The rotation is the lick's own currently-unlocked keys — a brand-new lick starts at its entry key and grows as you earn it, exactly as in a standard session.
- **The worst key comes first.** Each cycle is re-sorted so the key you've been scoring lowest on over your whole history with this lick sits at the top. Keys you've never played sit ahead of everything.
- **The demo is conditional.** While that head key is still below 90%, the cycle opens with the app playing the lick to you in it — call and response on precisely the key that needs ear work. Once you're consistently at 90% or better in it, the demo is dropped and cycles run straight into each other. So the app stops talking as soon as you stop needing it to.
- Keys you score ≥ 95% on are **mastered** for the round and drop out of the rotation, so each cycle gets shorter and concentrates on what's left.
- When the last key clears, the round completes: tempo bumps by 1% of where it currently sits, rounded up to a whole BPM (adjustable on the setup screen), and the rotation refills with the full unlocked set.
- **The session starts 2% below the lick's saved tempo, and never changes it.** You usually arrive here from the report, on the lick that just graded worst — dropping straight back in at the tempo it failed at just repeats the failure, so the drill eases in and you earn the difference back over the first couple of clears. And however far you ramp during the drill, the lick's saved tempo is exactly where you left it when you next meet it in Daily Practice. That's deliberate: one lick with a demo and your worst key first is a different exercise from a dozen licks cold, and a tempo you can hold in the first shouldn't decide the second.
- The progression and substitution settings are **derived from the lick itself** — its own progression tags pick the backing harmony, so a major lick won't get stuck over a minor vamp because the setup screen happened to be set that way.

**The focus drill.** When the report's **Next** card says *Drill D on …* — one key came in under 75% — its **Start deep practice** button launches a different shape of the same drill. Instead of the whole rotation it opens on **that key alone**, 10% under the lick's saved tempo (the same dip a new key gets), and works it like a staircase: clear it at 95% and the tempo steps up by the bump percent; come in under 75% and it steps down by three times that; anything in between holds. The app keeps demoing the key every cycle until you're holding 90% in it. Once a clear lands back at the saved tempo — *up to speed*; a bump that would overshoot settles exactly on it — the other keys return **one per cleared rotation, weakest first, with the tempo held**, until the full unlocked set is back; from there it's ordinary Deep Practice. The header says where you are (*Focus · D · 87 → 100 BPM*, then *Rebuilding · 4 of 12 keys*), and the report tells the story: how low it went, which round got back up to speed, which round rebuilt the rotation. Deep Practice from the lick's page or the setup screen still starts on the full rotation. Same rule as ever: none of it touches the lick's saved tempo.

The end-of-session report is where the rounds show up: how many you completed, your final tempo and how far it moved, and a line per round listing which keys you mastered at which BPM.

### When a lick keeps beating you

Side B is happy to grow with you. It's less helpful when a single lick has slipped so far that its current state — the keys it's unlocked, the tempo it's anchored to — doesn't match where you are anymore.

For that, both the post-session report and the lick’s detail page in your book show a **↺ Reset progress** action when the lick has practice history. Reset wipes that lick's per-key scores, its unlock count (back to one key — its home key), and resets the tempo to 60 BPM. Your tags stay; the lick stays in your practice book; only the progress against it clears. Use it when you've been stuck for weeks on a line you should be able to drill at a kinder pace.

Use Deep Practice when there's a single line you want to drill into your fingers in one sitting. Use a standard Start Session when you want to spread time across everything you've tagged.

### Phases of expertise

Every lick you drill sits in one of four phases, and the progress chart on its detail page draws them as bands so you can see which one you're in and what the next one costs:

| Phase | You're there when |
| --- | --- |
| **new** | Fewer than 12 keys unlocked — however fast you're playing it |
| **learning** | All 12 keys, under 120 BPM |
| **proficient** | All 12 keys, 120–149 BPM |
| **expert** | All 12 keys, 150 BPM and up |

Coverage comes first: a lick you can rip at 160 in three keys is still **new**, because the point of the 12-key cycle is that you've actually heard the line everywhere. Once the twelfth key lands, the phase is purely a question of tempo, and reaching a threshold promotes you — a bump that lands exactly on 120 is the promotion it looks like.

Phases are a mirror, not a gate. Nothing about them changes what Side B schedules, how keys unlock, or how tempo moves.

### Why gradual unlocks

The 12-key cycle is the goal, not the start. A brand-new lick starts with just **one** key — its home key — and earns each next key in easiest-to-hardest order by accidental count, alternating sharps and flats from home. From C, that's: C, G (1♯), F (1♭), D (2♯), Bb (2♭), A (3♯), Eb (3♭), E (4♯), Ab (4♭), B (5♯), Db (5♭), F♯/G♭ (6). For other home keys, the same principle applies relative to the entry key.

This means new vocabulary stays musical from day one: you're consolidating the shapes that matter most before the rotation grows, and by the time you reach the trickiest keys you've already heard the line in every easier one.

### Why all 12 keys

The shortest answer: every jazz player you admire could play their vocabulary in any key. Coltrane drilled patterns through every key before recording *Giant Steps*. Practicing only in the comfortable keys means your fingers have memorized one shape; practicing in all 12 means you've actually heard the line.

The longer answer is in [The Daily Key](./architecture/tonality-system.md).

## Your licks

The **Licks** page is your practice book. It shows the licks *you* are working with — the ones you’ve written in the editor, recorded, stolen from the community, plus anything you've added to your practice set from the broader catalog. The hundreds of curated ear-training licks the app uses to feed Side A live behind the scenes; the Licks page is for your stuff.

### Three sections

The page is organised into three groups, in this order:

- **Needs setup** — licks you've tagged for practice that don't yet carry a progression tag. Side B can't schedule them yet. Open the lick and pick which progressions it should drill over (you can pick more than one).
- **Practice set** — fully-configured practice licks, sorted by least-recently-practiced so the most overdue line sits at the top.
- **Other licks** — everything else of yours that you haven't tagged for practice.

### Reading a lick card

The cards are compact on purpose — the point is to scan a book, not read one card. Each shows:

- The lick's **name**, and *by whom* if you adopted it from the community.
- A **category pill tinted in its progression's colour**. Every progression has an identity hue, and it follows the lick everywhere: the pill here, the dots beside it, the session header while you're drilling it, and the bands on a tune chart when it turns up as a suggestion. A ii-V looks like a ii-V wherever you meet it.
- **Colour dots** for any additional progressions the lick is tagged for.
- The lick's **current practice tempo** in BPM — where Side B has got you to on this line.
- Its free-text tags.
- A play button, top right.

### Search and filter

The search box filters across all three groups by name or tag. A **progression filter** narrows to licks carrying a given progression tag — the fast way to answer "what have I got for turnarounds?" The category and difficulty browse filters that used to live on this page have been retired; they belonged to the old "browse the whole catalog" page, and now that your book is the focus, search plus progression is enough.

### Lick detail

Tap a lick to see:

- Sheet music in your instrument's key.
- A **key selector** so you can preview the lick in any of the 12 keys before tagging it.
- Category, difficulty, bar count, and tags.
- A **progress chart** once you've drilled it — your tempo on this line over time, banded by [phase of expertise](#phases-of-expertise), with a small key marking every session that unlocked a new key. The x-axis is scaled by real elapsed time, so a three-month gap reads as a gap rather than as one step.
- A play button so you can hear it without dropping into a session.
- A **practice star** — tap to tag the lick for Side B.
- A **Practice** button to drop straight into single-lick Deep Practice.
- **Practice over** pills — the progression tags telling Side B which backing tracks this lick is eligible for. Tap to add or remove.
- An **Edit** button (step-entered, owned licks only) to reopen the lick in the staff editor.
- A **↺ Reset progress** action once you've actually drilled the lick — wipes scores and unlock count back to a fresh start. See [Side B above](#when-a-lick-keeps-beating-you).
- A **Delete** button for licks you authored. If the delete is blocked (a community copy of someone else's, for example), the page now tells you *why* inline instead of just hiding the button.

## Your tunes

The **Tunes** page is the other half of your library: whole song forms rather than one- and two-bar lines. Charts you wrote by hand, charts you imported (iReal Pro links, Band-in-a-Box songs, MuseScore scores, or a PDF the app reads for you), and charts you adopted from the community all shelve under *Your book*; the ones that ship with the app shelve under *Curated*.

Open a tune and you can read it in any written key, hear it with the rhythm section, and — the part that matters — **practice licks over it**. The app reads the changes, finds the ii-Vs and turnarounds and vamps hiding in them, and hands you those spots to fill from your own practice set.

Two pages cover this properly:

- **[Your Tunes](./tunes.md)** — the book, the five ways to add a tune, the editor, and sharing.
- **[Playing Over Tunes](./tune-practice.md)** — the scored session: modes, strictness, the head rule, and what the report tells you.

Tune-practice takes deliberately don't count toward your streak, your level, or your Side B unlocks. That's the applying-it room; the drilling rooms are Side A and Side B.

## Progress

The Progress page is the back cover. It tells you what's been happening over time.

- **Streak**, **Tonal Mastery**, and **Recent Sessions** as headline numbers, with a Beginner-to-Virtuoso band showing where your difficulty sits.
- **This Period** — how the current window compares with the one before it, so you can see whether you're actually putting more in.
- **Trend chart** — your Tonal Mastery (average proficiency across all 12 scales and 12 keys, with unattempted ones counting as zero; 0–100), plotted over the window.
- **Calendar heatmap** — every day you practiced, lit by session count. Skipped days are dim.
- **Scale Proficiency** — a breakdown per scale type, and the adaptive-difficulty detail behind your level.
- **By Key grid** — your average score in each key, so you can see which keys still need work.
- **Recent sessions** — last few attempts with phrase, key, tempo, score, and grade.

Tricks and Side B sessions count toward your streak and the calendar, but the Progress page has no per-trick view — that lives on each trick's own page.

## Settings

The global Settings page controls things that aren't specific to a single session.

| Setting | What it does |
|---|---|
| **Instrument** | Concert pitch (C), soprano sax, tenor sax, alto sax, or trumpet. Affects transposition (sheet music in your key), playback timbre, and the pitch range the detector expects. |
| **Highest** | Caps how high licks can transpose. Set this to your real high note so the app doesn't push phrases above your range. |
| **Master** | Overall output level; playback, metronome, and backing track are all relative to it. |
| **Theme** | Dark (default) or light. |
| **Key Center** / **Scale Type** | Override the daily tonality, or leave it alone. Locked keys and scales are visible but disabled with their unlock requirement in a tooltip; a **Reset to daily** link appears once you've overridden. |
| **Tempo** | 60–200 BPM. The starting tempo for new practice sessions. |
| **Swing** | 0.50 (straight) to 0.80 (heavy). 0.67 is the usual triplet swing. Applies to the **Swing** backing style — you and the band both play it. Bossa Nova, Ballad and Straight set their own feel and ignore this. |
| **Metronome** + **Metro Vol** | The click on or off, and its level. |
| **Backing** + **Instrument** + **Backing Vol** | The rhythm section on or off, piano or organ for the comping voice, and how loud it sits under you. These live under the Ear Training heading but apply to Lick Practice and Tune Practice — Ear Training never plays a backing track. |
| **Tours & Help** | Replay any guided tour, or reset your tour history so the first-run prompts come back. |
| **Reset All Progress** | Destructive — erases all progress, scores, and session history, with a confirmation step. |
| **Delete account** | Removes your cloud account and its data (shown when you're signed in). |

Session settings that belong to a *session* aren't here: progression, backing style, practice mode, and session tempo are set on the Lick Practice page, and mode / strictness / key / tempo / backing style on the tune-practice setup screen. Settings links you across rather than duplicating them.

The settings page is laid out as a studio console — knobs, rocker switches, and selector pads rather than form fields. Every control has the same keyboard and screen-reader behaviour as the plain input it replaces.

## Adding your own licks

Two ways in.

- **The editor** (`/licks/editor`) — note by note, like writing on staff paper. Pick a duration, pick a pitch (sharp, flat, or natural), and the cursor moves on. Fumbled a note four beats back? Click its notehead — or step to it with ←/→ — to select it, then fix it in place: nudge the pitch with ↑/↓, delete it with Backspace/Delete, or flip its spelling with `\`, all without retyping the rest. Rests are selectable and deletable the same way (MuseScore-style); pitch operations on a rest simply do nothing. Add rests, set the bar count, save the phrase, and tag it for practice if you want to drill it.
- **Record** (`/licks/record`) — play a phrase on your horn, the app transcribes the notes from the recording. Useful for capturing something you just figured out. Set the tempo first, then press record: you get a **two-bar count-in** of woodblock tocks with a cue pill counting you down (*Count in*, then *Play in 4…3…2…1*), and the full jazz kit takes over exactly where the tocks stop — that texture change is your entrance, so **come in on that downbeat**. Play the lick, then stop with the button or just go quiet for a couple of seconds. The transcription understands jazz time: swung eighths come out written as straight eighths (the convention on every lead sheet), and a genuine triplet is still recognised beat by beat, so one bar can hold both. On the review screen, playback re-applies your Swing setting so the take sounds the way you played it, not the way it's spelled.

Either way, your lick joins your book alongside your other licks — ones you recorded, wrote, or adopted from the community — and behaves the same way: it can be tagged for Side B, transposed to any key, played back, and scored.

### Editing a step-entered lick

Editor-written licks are editable after the fact. Open the lick from your book and an **Edit** button shows up (only for licks you authored in the editor — recorded-from-mic licks aren't editable in the staff editor). Editing reopens the lick in the same editor flow with all your notes pre-loaded. Change anything you want — durations, pitches, name, category, bar count — and hit Update. The same lick id is preserved (so your practice history sticks with it), and changing the category re-seeds the progression tags so the lick lines up with the new harmonic context.

## Tips that keep showing up

- **Start slow.** A clean Good at 80 BPM teaches your ear more than a stumbled Try Again at 140.
- **Listen, don't shadow.** Wait for the phrase to land before reaching for your horn — half of ear training is *receiving* the phrase, not playing it.
- **Use the metronome.** Rhythm is 40% of your score. The click is your friend.
- **Repeat the hard ones.** Try Again is a feature, not a punishment. The same phrase will replay until you pass.
- **All 12 keys.** Your book lets you transpose any lick to any key — work through the cycle of fifths, even on Side A.
- **Watch your tuning.** The pitch meter shows you flat or sharp in real time. Fix the room temperature, fix the embouchure, fix your reed; the score will rise on its own.
- **Put the vocabulary in a tune.** A lick you can play in 12 keys and can't find on a real form isn't finished. Chart or import a standard and run [Tune Practice](./tune-practice.md) over it — the app will show you exactly where your lines fit.
- **Drill the devices, not just the lines.** A lick is one solution; a [trick](./tricks.md) is the machine that generates a hundred of them. Ten minutes of enclosures or triad pairs will show up in your playing faster than a new lick will.
- **Take the tour.** Most main pages have a guided walk-through — the home page, Ear Training, Lick Practice, Licks, Tunes, and tune practice. They run once automatically, and Settings → *Tours & Help* replays any of them whenever you want.
