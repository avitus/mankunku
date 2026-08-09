/**
 * Retention caps shared across the persistence layer.
 *
 * Every one of these bounds an array that is written locally AND merged on
 * cloud sync, in two different modules. When each module kept its own copy,
 * drift was silently lossy in one direction: if the merge cap were the
 * smaller of the pair, every cloud round-trip would truncate history the
 * local store had legitimately retained, and nothing would report it. Three
 * of the four copies carried a "keep in sync with…" comment, which is the
 * usual sign that a constant wants one home rather than a convention.
 *
 * This module is a leaf on purpose — it imports nothing. That keeps it free
 * of cycles and lets `state/progress.svelte.ts`, which lives outside
 * `persistence/`, read a cap without pulling in the Supabase-heavy `sync.ts`.
 *
 * `MAX_UNLOCKED_KEYS` deliberately does NOT live here: 12 is a fact about
 * music, not about storage, so it is exported from `music/key-ordering.ts`
 * alongside the code that walks the circle of fifths.
 */

/**
 * Retained progress-history points per lick and per trick variant.
 *
 * Applied at both ends of the same array: `appendTrickProgressPoint` /
 * `appendLickProgressPoint` on local write, and the trick-state / lick-metadata
 * merges on cloud read. Both keep the NEWEST points (`slice(length - cap)`).
 */
export const MAX_HISTORY_POINTS = 500;

/**
 * Retained practice sessions.
 *
 * Held in lockstep by `state/progress.svelte.ts` (the in-memory session list),
 * `lick-practice-sessions.ts` (the lick-practice log), and the sync payload
 * builder. `audio-store.ts` derives its recording cap from this so a stored
 * recording always has a session to belong to.
 */
export const MAX_SESSIONS = 100;
