import { describe, it, expect } from 'vitest';
import { articulationAbcPrefix, noteArticulationPrefix } from '$lib/music/articulation-abc';

describe('articulationAbcPrefix', () => {
	it('maps accent and staccato to abcjs decorations', () => {
		expect(articulationAbcPrefix('accent')).toBe('!>!');
		expect(articulationAbcPrefix('staccato')).toBe('.');
	});

	it('returns empty for normal, legato, and undefined', () => {
		expect(articulationAbcPrefix('normal')).toBe('');
		expect(articulationAbcPrefix('legato')).toBe('');
		expect(articulationAbcPrefix(undefined)).toBe('');
	});

	it('maps ghost and bend-up to soft cues', () => {
		expect(articulationAbcPrefix('ghost')).toBe('!pp!');
		expect(articulationAbcPrefix('bend-up')).toBe('!slide!');
	});
});

describe('noteArticulationPrefix', () => {
	it('reads articulation off a Note', () => {
		expect(
			noteArticulationPrefix({ pitch: 60, duration: [1, 4], offset: [0, 1], articulation: 'accent' })
		).toBe('!>!');
	});
});
