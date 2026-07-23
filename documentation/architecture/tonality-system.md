# The Daily Key

Open Mankunku on Tuesday and you might find yourself working in F Mixolydian. On Wednesday, A Dorian. On Thursday, Eb Major Pentatonic. Once you've unlocked enough tonalities the key rotates once per day (early on it holds steady for a few days at a time), and it's the same key for every player who opens the app on the same date.

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

Under the hood, when a tonality lasts a single day the app hashes the date string ("2026-05-09"); when it spans multiple days it hashes the multi-day block number the date falls into. Either way, same inputs = same pick, on every device, without the app needing a server.

Two properties follow:

- The key is stable for the whole current block. You can practice in the morning, come back at night, and you're still in the same tonality.
- Once the block advances (or daily, at 7+ tonalities) you get a fresh, evenly distributed pick. There's no clustering — over time you'll touch all your unlocked tonalities roughly equally.

## Progressive unlocking

You don't start with all 12 keys × all the scale types unlocked. That would be too much surface area. The app starts you with a small set and unlocks more as your proficiency rises.

**Keys unlock in circle-of-fifths order.** This is the same order used by every classical training program and most jazz pedagogy:

C → G → F → D → Bb → A → Eb → E → Ab → B → Db → F#

Concert C is the universal start. From there, fifth-related keys (G, then F) come next, then progressively more accidentals.

**Scale types unlock in pedagogical order:**

1. Major Pentatonic (free at start)
2. Minor Pentatonic (requires Major Pentatonic level 15)
3. Major (requires Major Pentatonic level 15)
4. Blues (requires Minor Pentatonic level 15)
5. Dorian
6. Mixolydian
7. Minor (Aeolian)
8. Lydian
9. Melodic Minor
10. Altered
11. Lydian Dominant
12. Bebop Dominant

Major Pentatonic is the only scale free at start. Minor Pentatonic, Major, and Blues unlock quickly once you reach level 15 in their pentatonic prerequisite — together they cover most of what a beginner needs. The modes follow once you have proficiency in the basics. Altered and Lydian Dominant are the workhorses of bebop reharmonization and unlock later.

**Unlocking is driven by proficiency.** Each key has its own per-key proficiency level — a rolling track of how well you've been performing in that key. Each scale type has its own per-scale proficiency level. New keys unlock when your proficiency in already-unlocked keys reaches a threshold; new scales unlock when your scale-by-scale proficiency reaches its threshold. The exact thresholds are tuned so that practicing consistently for two or three weeks tends to unlock the next item.

**Cross-product.** Once a new key unlocks, it joins the rotation paired with all your unlocked scale types. Unlock D and you immediately have D Major Pentatonic, D Major, and D Blues in the daily pool. Then when you unlock Dorian, you get D Dorian, G Dorian, and so on across all currently-unlocked keys. The pool grows quickly.

## Overriding the daily pick

The daily rotation is the default, but you don't have to use it. Side A's settings have a tonality picker:

- **Key selector** in a circle-of-fifths layout. Locked keys show a lock icon and a tooltip explaining what proficiency level unlocks them. Pick any unlocked key.
- **Scale type selector**. Same idea — locked scales are visible but disabled, with their unlock requirements shown.
- **Reset to daily** — restores the automatic pick.

The override persists in your settings. If you need to grind in F Lydian for a week, you can. The app will keep that override active until you reset.

Side B (Lick Practice) ignores the daily pick entirely — it uses its own per-lick key-unlocking system instead. A new lick starts with just its entry key and earns each additional key by alternating sharp- and flat-side neighbours on the circle of fifths as proficiency rises; only once a lick has earned all 12 keys does it cycle through the full set with staged variety. The daily key is purely a Side A concept.

## Scale-aware lick filtering

Once a tonality is active, the app filters the lick library to only licks that fit the active scale type. The compatibility rules are based on subset relationships:

- **Pentatonic licks** fit pentatonic, major, Lydian, and Mixolydian sessions (the pentatonic notes are a subset of all of those).
- **Blues licks** fit blues, minor pentatonic, Dorian, and minor sessions.
- **Major (7-note) licks** fit major, Lydian, Mixolydian, and Bebop Dominant sessions.
- **Dorian licks** fit Dorian and minor sessions.
- **Lydian licks** fit Lydian and major sessions.
- **Bebop Dominant licks** fit Bebop Dominant, Mixolydian, and major sessions.
- **Melodic minor licks** fit melodic minor, altered, and Lydian Dominant sessions (these scales share the melodic minor parent).

For multi-chord licks (ii-V-I patterns, turnarounds, rhythm changes), compatibility is broader because the lick uses the full key context, not a single scale.

The reasoning: a 7-note major lick squashed into a 5-note pentatonic session would lose two of its notes and stop sounding like itself. Filtering ahead of time means the app never asks you to play something that's been mangled.

If filtering would leave you with too few licks at your current difficulty, the app **widens** to all licks at that difficulty regardless of scale fit — better to practice with a slight mismatch than to have an empty session.

## Watching for unlocks

The Settings page and the daily-tonality picker both show your current proficiency on each key and each scale, along with the threshold needed for the next unlock. If you've been working hard on Mixolydian and you're getting close, you can see how close from the proficiency bar.

When a new tonality unlocks, the app surfaces it the next time you open Side A. New tonalities don't displace today's pick — the rotation continues, but the new tonality joins the pool starting tomorrow.
