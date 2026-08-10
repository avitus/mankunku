import type { PhraseCategory } from '$lib/types/music';

/**
 * The categories ear training draws from when the user asks for a random
 * phrase. Excludes long variants, niche categories and 'user'.
 *
 * This lives here rather than inline in the route because it is the demand
 * side of a contract the supply side has no other way to see: the
 * combinatorial generator's pattern tables are what fill these categories,
 * and a category listed here with no scale patterns produces a session that
 * silently falls through to the widened difficulty pool. That hole is
 * invisible from either file alone, so `combinatorial-coverage.test.ts`
 * asserts the join.
 */
export const EAR_TRAINING_CATEGORIES: PhraseCategory[] = [
	'ii-V-I-major',
	'ii-V-I-minor',
	'short-ii-V-I-major',
	'short-ii-V-I-minor',
	'blues',
	'bebop-lines',
	'pentatonic'
];
