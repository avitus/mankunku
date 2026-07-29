import { describe, it, expect } from 'vitest';
import { progressionColor } from '$lib/music/progression-display';
import { PROGRESSION_TEMPLATES } from '$lib/data/progressions';
import type { ChordProgressionType } from '$lib/types/lick-practice';

describe('progressionColor', () => {
	// Every progression that exists in the templates must have an identity colour,
	// so a card / session header never renders a missing hue. Deriving the list
	// from PROGRESSION_TEMPLATES means a newly-added progression is covered here
	// automatically and fails loudly if its colour token was forgotten.
	const allTypes = Object.keys(PROGRESSION_TEMPLATES) as ChordProgressionType[];

	it('returns a colour for every progression in PROGRESSION_TEMPLATES', () => {
		for (const type of allTypes) {
			const color = progressionColor(type);
			expect(color, `missing colour for ${type}`).toMatch(/^var\(--/);
		}
	});

	it('maps each progression to its own --prog-<type> token', () => {
		for (const type of allTypes) {
			expect(progressionColor(type)).toBe(`var(--prog-${type})`);
		}
	});

	it('gives distinct colours to distinct progressions', () => {
		const colors = allTypes.map(progressionColor);
		expect(new Set(colors).size).toBe(allTypes.length);
	});

	it('falls back to the neutral accent for an unknown/legacy tag', () => {
		expect(progressionColor('legacy-unknown' as ChordProgressionType)).toBe('var(--color-accent)');
	});
});
