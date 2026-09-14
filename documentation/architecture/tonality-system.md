# The Daily Key

Open Mankunku on Tuesday and you might find yourself working in F Mixolydian. On Wednesday, A Dorian. On Thursday, Eb Major Pentatonic. Once you've unlocked enough tonalities the key rotates once per day (early on it holds steady for a few days at a time), and it's the same key on every device you use — it comes from the date and from what you've unlocked.

This page explains why the key rotates, how new keys and scales unlock as you improve, and how to override the daily pick when you need to.

## What "tonality" means here

A **tonality** is a key plus a scale type. So:

- **Bb Blues** is one tonality — the key is Bb, the scale is the blues scale.
- **Bb Major** is a different tonality — same key, different scale.
- **D Dorian** is another — different key, different scale.

Side A's practice session focuses on a single tonality at a time: every lick gets transposed to the active key, and only licks compatible with the active scale show up.

## Why the key changes daily

The short version: every jazz player you admire could play their vocabulary in any key. Coltrane famously drilled patterns in all 12 keys before recording *Giant Steps*. Practicing only in C — or only in the keys your instrument's home position favors — means your fingers have memorized a *shape*, not a *line*. The shape works in C; it doesn't transfer.

The daily rotation is a forcing function. You don't get to pick the key today. You get the key the app picks, which means over a week or two you cycle through the keys you'd otherwise avoid. Bb? Comfortable. Db? Less comfortable, but the only way to get comfortable with Db is to play in Db.

The same logic applies to the scale type. If you only ever practice in major and Dorian, your ear never internalizes Lydian color or Mixolydian color or Lydian Dominant. The rotation ensures you spend regular time in scales you don't naturally reach for.

## How the key gets picked

The pick is **deterministic**, but the key doesn't always change every day — at early levels a tonality persists for several days so you have time to internalize it before rotating. With 1–3 unlocked tonalities each one lasts 3 days; with 4–6, 2 days; with 7 or more, the key rotates daily.

Under the hood, when a tonality lasts a single day the app hashes the date string ("2026-05-09"); when it spans multiple days it hashes the multi-day block number the date falls into — and picks from your list of unlocked tonalities with that number. Either way, same date + same unlocks = same pick, on every device, without the app needing a server.

Two properties follow:

- The key is stable for the whole current block. You can practice in the morning, come back at night, and you're still in the same tonality — as long as nothing new has unlocked in between (see [Watching for unlocks](#watching-for-unlocks)).
- Once the block advances (or daily, at 7+ tonalities) you get a fresh, evenly distributed pick. There's no clustering — over time you'll touch all your unlocked tonalities roughly equally.

## Progressive unlocking

You don't start with all 12 keys × all the scale types unlocked. That would be too much surface area. The app starts you with a small set and unlocks more as your proficiency rises.

**Keys unlock in circle-of-fifths order.** This is the same order used by every classical training program and most jazz pedagogy:

C → G → F → D → Bb → A → Eb → E → Ab → B → Db → F#

That ladder is spelled in concert pitch, because it's the same for every instrument: everyone starts on concert C, which your screens show in your own written pitch (D on tenor or soprano sax and trumpet, A on alto). From there, fifth-related keys (G, then F) come next, then progressively more accidentals.

**Scale types unlock in pedagogical order:**

1. Major Pentatonic (free at start)
2. Minor Pentatonic (requires Major Pentatonic level 15)
3. Major (requires Major Pentatonic level 15)
4. Blues (requires Minor Pentatonic level 15)
5. Dorian (Minor Pentatonic 20)
6. Mixolydian (Major 20)
7. Minor (Aeolian) (Dorian 25)
8. Lydian (Major 25)
9. Melodic Minor (Major 30 *and* Minor 25)
10. Altered (Melodic Minor 40)
11. Lydian Dominant (Melodic Minor 40)
12. Bebop Dominant (Mixolydian 35)

Major Pentatonic is the only scale free at start. Minor Pentatonic, Major, and Blues unlock quickly once you reach level 15 in their pentatonic prerequisite — together they cover most of what a beginner needs. The modes follow once you have proficiency in the basics. Altered and Lydian Dominant are the workhorses of bebop reharmonization and unlock later.

**Unlocking is driven by proficiency.** Each key has its own per-key proficiency level — a rolling track of how well you've been performing in that key. Each scale type has its own per-scale proficiency level. New keys unlock when the neighbouring key you already have reaches level 10 (level 15 for the last five: E, Ab, B, Db, F#); new scales unlock when the prerequisite scale reaches the level listed above. The thresholds are tuned so that practicing consistently for two or three weeks tends to unlock the next item.

**Cross-product.** Once a new key unlocks, it joins the rotation paired with all your unlocked scale types. Unlock D and you immediately have D Major Pentatonic, D Major, and D Blues in the daily pool. Then when you unlock Dorian, you get D Dorian, G Dorian, and so on across all currently-unlocked keys. The pool grows quickly.

## Overriding the daily pick

The daily rotation is the default, but you don't have to use it. The tonality picker lives on the global **Settings** page, under *Ear Training* — not on the Ear Training screen itself, which is deliberately free of controls:

- A status line naming your current tonality and whether it's the daily pick or a **Custom override**.
- **Key Center** — a pad of all 12 keys in unlock order, labelled in your written pitch. Locked keys are visible but disabled, with a tooltip naming the proficiency level that unlocks them ("Requires C proficiency level 10").
- **Scale Type** — same idea. Locked scales are disabled and their tooltip names the prerequisite scale and level.
- **Reset to daily** — appears once you've overridden, and restores the automatic pick.
- A counter underneath: how many of the 12 keys and 12 scales you've unlocked so far.

The override persists in your settings. If you need to grind in F Lydian for a week, you can. The app will keep that override active until you reset.

Side B (Lick Practice) ignores the daily pick entirely — it uses its own per-lick key-unlocking system instead. A new lick starts with just its entry key and earns each additional key by alternating sharp- and flat-side neighbours on the circle of fifths as proficiency rises; only once a lick has earned all 12 keys does it cycle through the full set with staged variety. The daily key is purely a Side A concept.

## Scale-aware lick filtering

Once a tonality is active, the app filters the lick catalog to only licks that fit the active scale type. The compatibility rules are based on subset relationships:

- **Major pentatonic licks** fit major pentatonic, major, Lydian, and Mixolydian sessions (the pentatonic notes are a subset of all of those); **minor pentatonic licks** fit minor pentatonic, blues, Dorian, and minor sessions.
- **Blues licks** fit blues, minor pentatonic, Dorian, and minor sessions.
- **Major (7-note) licks** fit major, Lydian, Mixolydian, and Bebop Dominant sessions.
- **Dorian licks** fit Dorian and minor sessions; **natural minor (Aeolian) licks** fit minor and Dorian sessions.
- **Mixolydian licks** fit Mixolydian, major, and Bebop Dominant sessions.
- **Lydian licks** fit Lydian and major sessions.
- **Bebop Dominant licks** fit Bebop Dominant, Mixolydian, and major sessions.
- **Melodic minor licks** fit melodic minor, altered, and Lydian Dominant sessions (these scales share the melodic minor parent).

For multi-chord licks, compatibility is broader because the lick uses the full key context, not a single scale: major ii-V-Is (long and short) fit major, Dorian, Mixolydian and Lydian sessions; major V-Is fit major, Mixolydian and Lydian; rhythm changes fit major and Mixolydian. Minor cadence licks (ii-V-i, short ii-V-i, V-i minor) fit minor, Dorian and melodic-minor sessions. They're written from their tonic, so they move tonic → the session's root — a C-minor ii-V-i in a D Dorian session is played in D minor — and are never nudged note by note; they're no longer offered under Altered, a dominant-only context where the ii and i bars would sit outside the scale. Your own licks fit every session, unless you've filed one under any of these multi-chord categories — a ii-V-I, a V-I, rhythm changes or a minor cadence — in which case it follows that category's list like any other lick.

The reasoning: a 7-note major lick squashed into a 5-note pentatonic session would lose two of its notes and stop sounding like itself. Filtering ahead of time means the app never asks you to play something that's been mangled.

If filtering would leave you with fewer than three licks at your current difficulty, the app **widens** to all licks at that difficulty regardless of scale fit — better to practice with a slight mismatch than to have an empty session.

## Watching for unlocks

The tonality picker in Settings is where you watch for this. Locked keys and scales aren't hidden — they sit there greyed out, and hovering one tells you exactly what it costs ("Requires Minor Pentatonic level 15"). The running counter underneath tells you how far you've got overall.

When a new tonality unlocks, it joins the pool straight away. The ear-training page holds its key for as long as you have it open, so nothing changes under you mid-session — but because the pick is made from the whole list of unlocked tonalities, the next time you open the page after an unlock, today's key may have landed somewhere new.

Side B and Tricks have their own, separate key ladders (per lick and per trick variant), so unlocking a key here doesn't unlock it there and vice versa.
