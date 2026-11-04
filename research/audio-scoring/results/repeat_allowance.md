# Assuming a missed articulation on a repeated note

Andy's idea (2026-11-03): when the articulation across two repeated notes is very subtle but the rest of the lick lines up perfectly, assume it was played and missed.

**Decision (Andy, 2026-11-03): leave scoring as is.** Neither credit rule below was built.

## Which takes qualify

A take qualifies when all of these hold:

- A written repeat's second note is unpaired, and the first note's detected span reaches at least halfway through the second note's slot.
- Every other written note is paired on the right pitch.
- No extras are charged.
- Every other note's rhythm score is at least 0.8. The Through the Blue to the Root take that prompted this scores 0.839.

## Production rows

2839 rows in `session_results`, 2026-07-13 to 2026-11-04, from 5 players.

| | Takes |
|---|---|
| All rows | 2839 |
| On a lick with a written repeat | 283 |
| All notes right | 73 |
| Qualify | 23 (0.8% of all rows) |

- **Players:** all 283 repeat rows and all 23 qualifying takes are Andy's. The other four players have no rows on a lick with a written repeat.
- **Source:** all 23 are ear training.
- **Reproduction:** recomputing pitch 60% + rhythm 40% matches every saved overall within 0.000001.

| Rule | Median overall | Perfect | Great | Good | Fair | Try again | ≥ 0.90 |
|---|---|---|---|---|---|---|---|
| Today | 0.724 | 0 | 0 | 12 | 8 | 3 | 0 |
| Full credit (pitch, plus the take's mean rhythm) | 0.982 | 23 | 0 | 0 | 0 | 0 | 23 |
| Pitch credit only (rhythm 0 for that note) | 0.874 | 0 | 20 | 3 | 0 | 0 | 4 |

## What the qualifying takes actually were

18 takes with audio meet the same rule: corpus fixtures, Andy's exports, the Firefox set and one recording fetched from storage. Some predate the production table. Each was replayed through today's detector.

| Outcome | Takes | Would full credit be right? |
|---|---|---|
| Today's detector finds both notes | 14 | Not needed, because detection already pays it |
| 2026-10-03 Four to Five: the final A was never sounded (pinned in its fixture test) | 1 | No: a note not played would score about 0.98, perfect |
| 2026-09-12 Four to Five: C held through the second C's slot (2026-10-07 audit, unsettled) | 1 | Probably not |
| 2026-11-04 Through the Blue to the Root: the slight tongue Andy heard | 1 | Yes |
| 2026-11-04 Up to the Seventh: unflagged, replayed with no click grid, truth unknown | 1 | Unknown |

So of the four merges today's detector still leaves, one is a tongue confirmed by ear, one is a note not played, one is probably a held note and one is unknown.

The level dip doesn't separate them. The smallest 2-cycle level ratio across the repeat is 0.25–0.91 (median 0.71) on tongues the detector finds today, and 0.82 on the slight tongue. In the sustain survey of 142 notes from the corpus, ordinary held notes have a median of 0.84.

## Limits

- One player, on ear training only, with few takes behind the outcome table.
- Audio exists mainly for takes Andy flagged, so the 14 of 18 is not an unbiased estimate of what today's detector would do on production. Only 3 of the 23 qualifying production takes still have a recording in storage, and 11 have a local export.
- Saved rows were scored by the detector of their day.
- No take is a deliberately slurred control. The 2026-10-03 take is the closest thing, and it qualifies.
