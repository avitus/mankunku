/**
 * Lick mode — the one place that decides whether a lick is read as major or
 * minor. `Phrase.mode` is explicit when stated; legacy/curated rows fall back
 * to the HARMONY (a tonic segment rooted on `key` with a minor-tonic quality),
 * never to the category: the user's existing minor-category licks were entered
 * with key = the relative MAJOR, and category inference would relabel them.
 */
import { describe, it, expect } from 'vitest';
import { lickMode, harmonyTonicMode, MINOR_TONIC_QUALITIES, MINOR_CATEGORIES } from '$lib/music/mode';
import type { HarmonicSegment, Phrase } from '$lib/types/music';

const seg = (root: HarmonicSegment['chord']['root'], quality: HarmonicSegment['chord']['quality'], start: number, dur: number): HarmonicSegment => ({
	chord: { root, quality },
	scaleId: 'major.ionian',
	startOffset: [start, 1],
	duration: [dur, 1]
});

const MINOR_II_V_I = [seg('D', 'min7b5', 0, 1), seg('G', '7alt', 1, 1), seg('C', 'min7', 2, 1)];
const MAJOR_II_V_I = [seg('D', 'min7', 0, 1), seg('G', '7', 1, 1), seg('C', 'maj7', 2, 1)];

function phrase(over: Partial<Phrase>): Pick<Phrase, 'key' | 'harmony' | 'mode'> {
	return { key: 'C', harmony: [], ...over };
}

describe('harmonyTonicMode', () => {
	it('reads minor from a minor-tonic segment rooted on the key', () => {
		expect(harmonyTonicMode(phrase({ harmony: MINOR_II_V_I }))).toBe('minor');
		expect(harmonyTonicMode(phrase({ harmony: [seg('C', 'min6', 0, 2)] }))).toBe('minor');
		expect(harmonyTonicMode(phrase({ harmony: [seg('C', 'minMaj7', 0, 2)] }))).toBe('minor');
	});

	it('reads major from any other quality on the key root', () => {
		expect(harmonyTonicMode(phrase({ harmony: MAJOR_II_V_I }))).toBe('major');
		// A ø on the key root is not a tonic (diminished-chord licks).
		expect(harmonyTonicMode(phrase({ harmony: [seg('C', 'min7b5', 0, 2)] }))).toBe('major');
	});

	it('uses the LAST segment rooted on the key — the resolution, not the opening', () => {
		expect(harmonyTonicMode(phrase({ harmony: [seg('C', 'maj7', 0, 1), seg('C', 'min7', 1, 1)] }))).toBe('minor');
	});

	it('abstains (null) when no segment is rooted on the key or there is no harmony', () => {
		// A ii-chord lick keyed C over Dm7 must not read as minor.
		expect(harmonyTonicMode(phrase({ harmony: [seg('D', 'min7', 0, 2)] }))).toBeNull();
		expect(harmonyTonicMode(phrase({ harmony: [] }))).toBeNull();
	});
});

describe('lickMode', () => {
	it('lets an explicit mode win over the harmony', () => {
		expect(lickMode(phrase({ harmony: MINOR_II_V_I, mode: 'major' }))).toBe('major');
		expect(lickMode(phrase({ harmony: MAJOR_II_V_I, mode: 'minor' }))).toBe('minor');
		expect(lickMode(phrase({ harmony: [], mode: 'minor' }))).toBe('minor');
	});

	it('falls back to the harmony, then to major', () => {
		expect(lickMode(phrase({ harmony: MINOR_II_V_I }))).toBe('minor');
		expect(lickMode(phrase({ harmony: [seg('D', 'min7', 0, 2)] }))).toBe('major');
		expect(lickMode(phrase({ harmony: [] }))).toBe('major');
	});

	it('never infers from the category (relative-major-entered legacy licks)', () => {
		const legacy = { ...phrase({ harmony: [] }), category: 'ii-V-I-minor' } as Pick<Phrase, 'key' | 'harmony' | 'mode'>;
		expect(lickMode(legacy)).toBe('major');
	});
});

describe('constants', () => {
	it('names the minor tonic qualities and the minor categories', () => {
		expect([...MINOR_TONIC_QUALITIES].sort()).toEqual(['min6', 'min7', 'minMaj7']);
		expect(MINOR_TONIC_QUALITIES.has('min7b5')).toBe(false);
		expect([...MINOR_CATEGORIES].sort()).toEqual(['ii-V-I-minor', 'minor-chord', 'short-ii-V-I-minor', 'V-I-minor'].sort());
	});
});
