import { describe, it, expect } from 'vitest';
import {
	getTrickById,
	normalizeTrickPracticeParameters,
	resolveTrickPracticeBed,
	trickBedHarmony,
	trickPracticeBed
} from '$lib/tricks';
import { resolveEnclosurePracticeBed } from '$lib/tricks/enclosure-practice';
import type { Trick } from '$lib/types/tricks';

/**
 * Which progression a trick variant drills over. The enclosure setup lets the
 * player pick a bed (`config.trickProgressionType`), but only from the
 * enclosure catalog; anything else falls back to the variant's own vamp, and
 * the stored variant is re-keyed to the family that bed implies so progress
 * lands on the variant actually practiced.
 */

const enclosures = getTrickById('enclosures')!;
const triadPairs = getTrickById('triad-pairs')!;

describe('resolveEnclosurePracticeBed', () => {
	it.each([
		['major', 'major-vamp'],
		['minor', 'minor-vamp'],
		['dominant', 'dominant-vamp']
	] as const)('defaults a %s enclosure to its own vamp', (type, bed) => {
		expect(resolveEnclosurePracticeBed({ type })).toBe(bed);
	});

	it('defaults a legacy no-type enclosure to the major vamp', () => {
		expect(resolveEnclosurePracticeBed({})).toBe('major-vamp');
	});

	it('honours a requested bed from the enclosure catalog, including the long ii-V-Is', () => {
		expect(resolveEnclosurePracticeBed({ type: 'major' }, 'ii-V-I-minor-long')).toBe('ii-V-I-minor-long');
		expect(resolveEnclosurePracticeBed({ type: 'minor' }, 'ii-V-I-major-long')).toBe('ii-V-I-major-long');
		expect(resolveEnclosurePracticeBed({ type: 'major' }, 'dominant-vamp')).toBe('dominant-vamp');
	});

	it('ignores a requested bed outside the enclosure catalog', () => {
		// The short ii-V-I is a real progression but not an enclosure bed.
		expect(resolveEnclosurePracticeBed({ type: 'minor' }, 'ii-V-I-major')).toBe('minor-vamp');
	});
});

describe('resolveTrickPracticeBed', () => {
	it('lets an enclosure take the requested bed', () => {
		expect(resolveTrickPracticeBed(enclosures, { type: 'major' }, 'ii-V-I-major-long')).toBe(
			'ii-V-I-major-long'
		);
	});

	it('keeps a triad pair on its family bed whatever is requested', () => {
		// Altered pairs drill over the dominant vamp; a stale enclosure choice
		// in config must not move them onto a maj7 backing.
		expect(resolveTrickPracticeBed(triadPairs, { pair: 'major-tritone' }, 'major-vamp')).toBe(
			'dominant-vamp'
		);
		expect(resolveTrickPracticeBed(triadPairs, { pair: 'aug-major' })).toBe('minor-vamp');
	});
});

describe('normalizeTrickPracticeParameters', () => {
	it.each([
		['dominant-vamp', 'dominant'],
		['minor-vamp', 'minor'],
		['ii-V-I-minor-long', 'minor'],
		['major-vamp', 'major'],
		['ii-V-I-major-long', 'major']
	] as const)('re-keys an enclosure drilled over %s to type=%s', (bed, type) => {
		const params = { type: 'major', approaches: 'double' };
		expect(normalizeTrickPracticeParameters(enclosures, params, bed)).toEqual({
			approaches: 'double',
			type
		});
	});

	it('leaves triad-pair parameters alone, as a copy', () => {
		const params = { pair: 'minor-b9' };
		const out = normalizeTrickPracticeParameters(triadPairs, params, 'minor-vamp');
		expect(out).toEqual(params);
		expect(out).not.toBe(params);
	});
});

describe('trickPracticeBed — the one fallback for a device with no bed', () => {
	it("falls back to 'major-vamp' and drills over its Cmaj7", () => {
		const bedless: Trick = { ...enclosures, practiceBed: undefined };
		expect(trickPracticeBed(bedless, { type: 'dominant' })).toBe('major-vamp');
		expect(trickBedHarmony(bedless, { type: 'dominant' }).chordQuality).toBe('maj7');
	});

	it("uses a device's declared bed for the preview harmony", () => {
		expect(trickBedHarmony(enclosures, { type: 'dominant' }).chordQuality).toBe('7');
	});
});
