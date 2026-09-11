import type { PhraseCategory } from '$lib/types/music';

/**
 * NOT consumed by the app. This was the random-category pool of the
 * /ear-training/settings page, removed 2026-08-09; /ear-training now draws
 * from the whole lick library (`getAllLicks()`, difficulty-gated), every
 * category. Its only reader is `combinatorial-coverage.test.ts`, which asserts
 * each category listed here has at least three combiner scale patterns and
 * ten combined licks. (Excludes long variants, niche categories and 'user'.)
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
