import { describe, it, expect } from 'vitest';
import {
	getCompatibleScaleTypes,
	isLickCompatible
} from '$lib/tonality/scale-compatibility';
import type { Phrase } from '$lib/types/music';
import type { ScaleType } from '$lib/tonality/tonality';
import { SCALE_UNLOCK_ORDER, SCALE_TYPE_TO_SCALE_ID } from '$lib/tonality/tonality';
import { getScale } from '$lib/music/scales';

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

/** A progression-category lick whose harmony moves: first segment `scaleId`, then two more chords. */
function makeProgression(overrides: { scaleId?: string; category: Phrase['category'] }): Phrase {
	const lick = makeLick(overrides);
	const next = (root: 'G' | 'C', at: number): Phrase['harmony'][number] => ({
		chord: { root, quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [at, 1], duration: [1, 1]
	});
	return { ...lick, harmony: [...lick.harmony, next('G', 1), next('C', 2)] };
}

describe('progression category compatibility', () => {
	it('ii-V-I-major lick is compatible with major, dorian, mixolydian', () => {
		const lick = makeProgression({ scaleId: 'major.dorian', category: 'ii-V-I-major' });
		const compat = getCompatibleScaleTypes(lick);
		expect(compat).toContain('major');
		expect(compat).toContain('dorian');
		expect(compat).toContain('mixolydian');
		// Category overrides scaleId — so blues is not included
		expect(compat).not.toContain('blues');
	});

	/**
	 * 2026-10-07 (C Lydian played no F#): a progression lick reaches a modal
	 * session through the parent-key hop, which puts the session root on one of
	 * the progression's chords — Dorian is the ii, Mixolydian the V. Lydian is
	 * the IV, and a ii-V-I or V-I has no IV: C Lydian's lick played Am7 D7 Gmaj7
	 * in G major, and its only F# was G major's leading tone.
	 */
	it.each(['ii-V-I-major', 'short-ii-V-I-major', 'V-I-major'] as const)(
		'a %s lick is not offered in Lydian, where no chord of it sits on the session root',
		(category) => {
			expect(getCompatibleScaleTypes(makeProgression({ category }))).not.toContain('lydian');
		}
	);

	it('a lick filed under a progression category but declared over ONE chord follows its scale', () => {
		// The combiner's single-bar Cmaj7 phrases filed under ii-V-I-major.
		const ionian = makeLick({ scaleId: 'major.ionian', category: 'short-ii-V-I-major' });
		expect(getCompatibleScaleTypes(ionian)).toEqual(['major', 'lydian', 'mixolydian', 'bebop-dominant']);
		// And a single Cm7 bar filed under ii-V-I-minor: no melodic minor, whose
		// natural 6 and 7 the aeolian line contradicts.
		const aeolian = makeLick({ scaleId: 'major.aeolian', category: 'ii-V-I-minor' });
		expect(getCompatibleScaleTypes(aeolian)).toEqual(['minor', 'dorian']);
	});

	it('ii-V-I-minor lick is compatible with minor, dorian, melodic-minor — not altered', () => {
		const lick = makeProgression({ scaleId: 'major.dorian', category: 'ii-V-I-minor' });
		const compat = getCompatibleScaleTypes(lick);
		expect(compat).toContain('minor');
		expect(compat).toContain('dorian');
		expect(compat).toContain('melodic-minor');
		// Altered is a dominant-only context: with no snapping, a ii-V-i's ii and
		// i bars sit outside the advertised scale.
		expect(compat).not.toContain('altered');
		expect(getCompatibleScaleTypes(makeProgression({ scaleId: 'major.dorian', category: 'short-ii-V-I-minor' }))).not.toContain('altered');
	});

	it('V-I licks use category compatibility (not their altered first segment)', () => {
		expect(getCompatibleScaleTypes(makeProgression({ scaleId: 'melodic-minor.altered', category: 'V-I-minor' }))).toEqual(['minor', 'dorian', 'melodic-minor']);
		expect(getCompatibleScaleTypes(makeProgression({ scaleId: 'major.mixolydian', category: 'V-I-major' }))).toEqual(['major', 'mixolydian']);
	});

	it('rhythm-changes lick is compatible with major and mixolydian', () => {
		const lick = makeProgression({ scaleId: 'major.ionian', category: 'rhythm-changes' });
		const compat = getCompatibleScaleTypes(lick);
		expect(compat).toEqual(['major', 'mixolydian']);
	});
});

describe('user and unknown lick fallback', () => {
	it.each(['user-recorded', 'user-entered'])(
		'a %s lick (saved without harmony) outside a progression category fits every scale type',
		(source) => {
			const lick: Phrase = { ...makeLick({ category: 'user', source }), harmony: [] };
			expect(getCompatibleScaleTypes(lick)).toEqual(SCALE_UNLOCK_ORDER);
		}
	);

	it('a user lick filed under a progression category is gated like any other lick', () => {
		// No user-lick exemption: a major ii-V-I must not be offered in a
		// pentatonic session, where ear training would bend its notes to fit.
		const lick: Phrase = {
			...makeLick({ category: 'ii-V-I-major', source: 'user-entered' }),
			harmony: []
		};
		const compat = getCompatibleScaleTypes(lick);
		expect(compat).toEqual(['major', 'dorian', 'mixolydian']);
		expect(compat).not.toContain('major-pentatonic');
	});

	it('lick with unknown scaleId falls back to all scale types', () => {
		const lick = makeLick({ scaleId: 'exotic.wholetone', category: 'modal' });
		const compat = getCompatibleScaleTypes(lick);
		expect(compat).toEqual(SCALE_UNLOCK_ORDER);
	});

	it('a lick with no harmony at all falls back to all scale types', () => {
		const lick: Phrase = { ...makeLick({ category: 'modal' }), harmony: [] };
		expect(getCompatibleScaleTypes(lick)).toEqual(SCALE_UNLOCK_ORDER);
	});
});

describe('tonality scale ids', () => {
	it('every scale type names a real catalog scale', () => {
		// Ear training reads the active tonality's scale through this map; an
		// id the catalog lacks silently falls back to a 7-note default.
		for (const st of SCALE_UNLOCK_ORDER) {
			expect(getScale(SCALE_TYPE_TO_SCALE_ID[st]), st).toBeDefined();
		}
	});

	it('a curated lick written in a tonality\'s own scale is served in that tonality', () => {
		for (const st of SCALE_UNLOCK_ORDER) {
			const lick = makeLick({ scaleId: SCALE_TYPE_TO_SCALE_ID[st], category: 'modal' });
			expect(isLickCompatible(lick, st), st).toBe(true);
		}
	});
});
