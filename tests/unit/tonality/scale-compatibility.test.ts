import { describe, it, expect } from 'vitest';
import {
	getCompatibleScaleTypes,
	isLickCompatible
} from '$lib/tonality/scale-compatibility.ts';
import type { Phrase } from '$lib/types/music.ts';
import type { ScaleType } from '$lib/tonality/tonality.ts';
import { SCALE_UNLOCK_ORDER } from '$lib/tonality/tonality.ts';

/** Minimal lick stub for testing */
function makeLick(overrides: {
	scaleId?: string;
	category?: Phrase['category'];
	source?: string;
}): Phrase {
	return {
		id: 'test',
		name: 'Test Lick',
		timeSignature: [4, 4],
		key: 'C',
		notes: [],
		harmony: [{
			chord: { root: 'C', quality: 'maj7' },
			scaleId: overrides.scaleId ?? 'major.ionian',
			startOffset: [0, 1],
			duration: [1, 1]
		}],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: overrides.category ?? 'pentatonic',
		tags: [],
		source: overrides.source ?? 'curated'
	};
}

describe('getCompatibleScaleTypes', () => {
	it('major pentatonic lick is compatible with pentatonic, major, lydian, mixolydian', () => {
		const lick = makeLick({ scaleId: 'pentatonic.major' });
		const compat = getCompatibleScaleTypes(lick);
		expect(compat).toContain('major-pentatonic');
		expect(compat).toContain('major');
		expect(compat).toContain('lydian');
		expect(compat).toContain('mixolydian');
	});

	it('major pentatonic lick is NOT compatible with blues, minor, dorian', () => {
		const lick = makeLick({ scaleId: 'pentatonic.major' });
		expect(isLickCompatible(lick, 'blues')).toBe(false);
		expect(isLickCompatible(lick, 'minor')).toBe(false);
		expect(isLickCompatible(lick, 'dorian')).toBe(false);
	});

	it('minor pentatonic lick is compatible with minor-pentatonic, blues, minor, and dorian', () => {
		const lick = makeLick({ scaleId: 'pentatonic.minor' });
		const compat = getCompatibleScaleTypes(lick);
		expect(compat).toContain('minor-pentatonic');
		expect(compat).toContain('blues');
		expect(compat).toContain('minor');
		expect(compat).toContain('dorian');
		expect(compat).not.toContain('major-pentatonic');
		expect(compat).not.toContain('major');
	});

	it('blues lick is compatible with blues, minor-pentatonic, dorian, minor', () => {
		const lick = makeLick({ scaleId: 'blues.minor', category: 'blues' });
		const compat = getCompatibleScaleTypes(lick);
		expect(compat).toContain('blues');
		expect(compat).toContain('minor-pentatonic');
		expect(compat).toContain('dorian');
		expect(compat).toContain('minor');
		expect(compat).not.toContain('major-pentatonic');
	});

	it('7-note major ionian lick is NOT compatible with pentatonics or blues', () => {
		const lick = makeLick({ scaleId: 'major.ionian', category: 'bebop-lines' });
		expect(isLickCompatible(lick, 'major-pentatonic')).toBe(false);
		expect(isLickCompatible(lick, 'minor-pentatonic')).toBe(false);
		expect(isLickCompatible(lick, 'blues')).toBe(false);
		expect(isLickCompatible(lick, 'major')).toBe(true);
	});

	it('dorian lick is compatible with dorian and minor', () => {
		const lick = makeLick({ scaleId: 'major.dorian', category: 'modal' });
		const compat = getCompatibleScaleTypes(lick);
		expect(compat).toContain('dorian');
		expect(compat).toContain('minor');
		expect(compat).not.toContain('major');
	});

	it('bebop dominant lick is compatible with bebop-dominant, mixolydian, major', () => {
		const lick = makeLick({ scaleId: 'bebop.dominant', category: 'bebop-lines' });
		const compat = getCompatibleScaleTypes(lick);
		expect(compat).toContain('bebop-dominant');
		expect(compat).toContain('mixolydian');
		expect(compat).toContain('major');
	});

	it('melodic minor lick is compatible with melodic-minor, altered, lydian-dominant', () => {
		const lick = makeLick({ scaleId: 'melodic-minor.melodic-minor', category: 'modal' });
		const compat = getCompatibleScaleTypes(lick);
		expect(compat).toContain('melodic-minor');
		expect(compat).toContain('altered');
		expect(compat).toContain('lydian-dominant');
	});
});

describe('progression category compatibility', () => {
	it('ii-V-I-major lick is compatible with major, dorian, mixolydian, lydian', () => {
		const lick = makeLick({ scaleId: 'major.dorian', category: 'ii-V-I-major' });
		const compat = getCompatibleScaleTypes(lick);
		expect(compat).toContain('major');
		expect(compat).toContain('dorian');
		expect(compat).toContain('mixolydian');
		expect(compat).toContain('lydian');
		// Category overrides scaleId — so blues is not included
		expect(compat).not.toContain('blues');
	});

	it('ii-V-I-minor lick is compatible with minor, dorian, melodic-minor, altered', () => {
		const lick = makeLick({ scaleId: 'major.dorian', category: 'ii-V-I-minor' });
		const compat = getCompatibleScaleTypes(lick);
		expect(compat).toContain('minor');
		expect(compat).toContain('dorian');
		expect(compat).toContain('melodic-minor');
		expect(compat).toContain('altered');
	});

	it('turnarounds lick is compatible with major and mixolydian', () => {
		const lick = makeLick({ scaleId: 'major.ionian', category: 'turnarounds' });
		const compat = getCompatibleScaleTypes(lick);
		expect(compat).toEqual(['major', 'mixolydian']);
	});

	it('rhythm-changes lick is compatible with major and mixolydian', () => {
		const lick = makeLick({ scaleId: 'major.ionian', category: 'rhythm-changes' });
		const compat = getCompatibleScaleTypes(lick);
		expect(compat).toEqual(['major', 'mixolydian']);
	});
});

describe('user and unknown lick fallback', () => {
	it('user lick is compatible with all scale types', () => {
		const lick = makeLick({ scaleId: 'pentatonic.major', source: 'user' });
		const compat = getCompatibleScaleTypes(lick);
		expect(compat).toEqual(SCALE_UNLOCK_ORDER);
	});

	it('lick with unknown scaleId falls back to all scale types', () => {
		const lick = makeLick({ scaleId: 'exotic.wholetone', category: 'modal' });
		const compat = getCompatibleScaleTypes(lick);
		expect(compat).toEqual(SCALE_UNLOCK_ORDER);
	});
});

describe('isLickCompatible', () => {
	it('returns true for compatible pair', () => {
		const lick = makeLick({ scaleId: 'pentatonic.major' });
		expect(isLickCompatible(lick, 'major')).toBe(true);
	});

	it('returns false for incompatible pair', () => {
		const lick = makeLick({ scaleId: 'major.ionian', category: 'bebop-lines' });
		expect(isLickCompatible(lick, 'major-pentatonic')).toBe(false);
	});

	it('user lick is always compatible', () => {
		const lick = makeLick({ source: 'user' });
		for (const st of SCALE_UNLOCK_ORDER) {
			expect(isLickCompatible(lick, st)).toBe(true);
		}
	});
});
