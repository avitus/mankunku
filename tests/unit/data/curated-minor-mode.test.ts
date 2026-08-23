/**
 * Curated convention: minor licks are keyed by their TONIC minor (`key: 'C'`
 * = C minor) and say so — either by an explicit `mode: 'minor'` on the
 * literal or by a minor-tonic harmony segment. Every curated lick in a minor
 * category must resolve minor; the cadence/minor-chord files carry the field
 * explicitly because short-ii-V licks have no tonic segment to infer from.
 */
import { describe, it, expect } from 'vitest';
import { ALL_CURATED_LICKS } from '$lib/data/licks';
import { lickMode, MINOR_CATEGORIES } from '$lib/music/mode';

describe('curated minor licks', () => {
	const minorLicks = ALL_CURATED_LICKS.filter((l) => MINOR_CATEGORIES.has(l.category));

	it('exist in every minor category', () => {
		for (const cat of MINOR_CATEGORIES) {
			expect(minorLicks.some((l) => l.category === cat), cat).toBe(true);
		}
	});

	it('every minor-category lick resolves to minor', () => {
		for (const l of minorLicks) {
			expect(lickMode(l), `${l.id} (${l.category})`).toBe('minor');
		}
	});

	it('the hand-written cadence and minor-chord files state the mode explicitly', () => {
		// Combiner-generated entries (source 'generated') rely on their Cm7
		// context harmony; the curated literals carry the field.
		for (const l of minorLicks.filter((x) => x.source === 'curated')) {
			expect(l.mode, `${l.id} (${l.category})`).toBe('minor');
		}
	});

	it('major cadence licks stay major', () => {
		for (const l of ALL_CURATED_LICKS.filter((x) => x.category === 'ii-V-I-major' || x.category === 'short-ii-V-I-major' || x.category === 'V-I-major')) {
			expect(lickMode(l), l.id).toBe('major');
		}
	});
});
