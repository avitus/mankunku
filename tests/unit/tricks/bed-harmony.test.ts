import { describe, it, expect } from 'vitest';
import { getTrickById, trickBedHarmony, trickContextFor } from '$lib/tricks';
import { ENCLOSURE_TYPES } from '$lib/tricks/devices/enclosures';
import { TRIAD_PAIR_FAMILIES } from '$lib/tricks/devices/triad-pairs';
import { PROGRESSION_TEMPLATES } from '$lib/data/progressions';

/**
 * The trick page's notation preview and the practice drill must agree on the
 * harmony a variant lives over.
 *
 * They used not to: the preview hardcoded maj7 / major.ionian on the premise
 * that "both tricks are maj7-compatible". Five of the eight triad-pair
 * families exclude maj7 outright, so the whole-tone pair was drawn as
 * "C+·D+ over Cmaj7" — and because example-generator builds its pitch pool
 * from scaleId, the altered notes also fell out of pool onto the chromatic
 * fallback placement path, so the preview's NOTES differed from the drill's,
 * not just its chord label.
 */

const triadPairs = getTrickById('triad-pairs')!;
const enclosures = getTrickById('enclosures')!;

describe('trickBedHarmony', () => {
	it('gives every triad-pair family the harmony its own bed declares', () => {
		for (const family of TRIAD_PAIR_FAMILIES) {
			const bed = PROGRESSION_TEMPLATES[family.bed].harmony[0];
			expect(trickBedHarmony(triadPairs, { pair: family.value })).toEqual({
				chordQuality: bed.chord.quality,
				scaleId: bed.scaleId
			});
		}
	});

	it('never reports maj7 for a family that excludes it', () => {
		const nonMaj7 = TRIAD_PAIR_FAMILIES.filter((f) => !f.qualities.includes('maj7'));
		// Guards the premise of the old bug: this set must not be empty, or the
		// "all tricks are maj7-compatible" shortcut would have been harmless.
		expect(nonMaj7.length).toBeGreaterThan(0);
		for (const family of nonMaj7) {
			expect(trickBedHarmony(triadPairs, { pair: family.value }).chordQuality).not.toBe('maj7');
		}
	});

	it('falls back to the major vamp for a device with no practiceBed', () => {
		// No real device lacks the hook anymore (enclosures gained one with the
		// type parameter), so pin the fallback with a synthetic hook-less trick.
		const hookless = { ...enclosures, practiceBed: undefined };
		const bed = PROGRESSION_TEMPLATES['major-vamp'].harmony[0];
		expect(trickBedHarmony(hookless, { targetTone: 'third' })).toEqual({
			chordQuality: bed.chord.quality,
			scaleId: bed.scaleId
		});
	});

	it('gives each enclosure type the harmony its own vamp declares', () => {
		for (const family of ENCLOSURE_TYPES) {
			const bed = PROGRESSION_TEMPLATES[family.bed].harmony[0];
			expect(trickBedHarmony(enclosures, { type: family.value })).toEqual({
				chordQuality: bed.chord.quality,
				scaleId: bed.scaleId
			});
		}
		// Typeless params default to the major chain's bed.
		const major = PROGRESSION_TEMPLATES['major-vamp'].harmony[0];
		expect(trickBedHarmony(enclosures, {})).toEqual({
			chordQuality: major.chord.quality,
			scaleId: major.scaleId
		});
	});
});

describe('trickContextFor', () => {
	it('roots the context at the requested key while keeping the bed harmony', () => {
		for (const family of TRIAD_PAIR_FAMILIES) {
			const ctx = trickContextFor(triadPairs, { pair: family.value }, 'E', 132);
			expect(ctx.chordRoot).toBe('E');
			expect(ctx.key).toBe('E');
			expect(ctx.tempo).toBe(132);
			expect(ctx).toMatchObject(trickBedHarmony(triadPairs, { pair: family.value }));
		}
	});

	it('is the same derivation the drill uses, so preview and drill cannot drift', () => {
		// The session builds its C-rooted context through this exact call.
		for (const family of TRIAD_PAIR_FAMILIES) {
			const params = { pair: family.value };
			const drill = trickContextFor(triadPairs, params, 'C', 120);
			const preview = trickContextFor(triadPairs, params, 'C', 120);
			expect(preview).toEqual(drill);
		}
	});

	it('produces an example whose harmony matches the context', () => {
		for (const family of TRIAD_PAIR_FAMILIES) {
			const ctx = trickContextFor(triadPairs, { pair: family.value }, 'C', 120);
			const phrase = triadPairs.generateExample({ pair: family.value }, ctx);
			expect(phrase).not.toBeNull();
			expect(phrase!.harmony[0].chord.quality).toBe(ctx.chordQuality);
			expect(phrase!.harmony[0].scaleId).toBe(ctx.scaleId);
		}
	});
});
