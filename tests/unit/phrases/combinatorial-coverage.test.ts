/**
 * Coverage invariants for the combinatorial lick generator.
 *
 * The generator's whole job is to multiply a small pattern vocabulary into a
 * large lick pool, so the failure mode that matters is not "produces a wrong
 * lick" but "produces nothing for a category the user actually practises".
 * That kind of hole is invisible from the generator's own tests — every
 * combination it emits is valid, there are just no combinations to emit — so
 * these assertions are stated against the categories ear training draws from
 * rather than against the pattern tables.
 */
import { describe, it, expect } from 'vitest';
import { combine, generateAllCombinations } from '$lib/phrases/combiner';
import { SCALE_PATTERNS, RHYTHM_PATTERNS } from '$lib/data/patterns/index';
import { EAR_TRAINING_CATEGORIES } from '$lib/data/ear-training-categories';
import { fractionToFloat } from '$lib/music/intervals';
import type { HarmonicSegment } from '$lib/types/music';

const CMAJ_HARMONY: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [1, 1] }
];

describe('rhythm pattern table', () => {
	it('covers every note count from 3 to 8', () => {
		const counts = new Set(RHYTHM_PATTERNS.map((rp) => rp.noteCount));
		for (const n of [3, 4, 5, 6, 7, 8]) {
			expect(counts, `no rhythm pattern with ${n} notes`).toContain(n);
		}
	});

	it('gives every note count at least two rhythmic treatments', () => {
		const byCount = new Map<number, number>();
		for (const rp of RHYTHM_PATTERNS) byCount.set(rp.noteCount, (byCount.get(rp.noteCount) ?? 0) + 1);
		for (const [count, n] of byCount) {
			expect(n, `only ${n} rhythm pattern(s) at ${count} notes`).toBeGreaterThanOrEqual(2);
		}
	});

	it('never runs past the end of its bar', () => {
		// Patterns may finish early — a three-quarter cell leaving beat 4 open is
		// a rest, not a defect — but nothing may spill into the next bar, since
		// the combiner emits these as a whole phrase of `bars` length.
		for (const rp of RHYTHM_PATTERNS) {
			const last = rp.slots[rp.slots.length - 1];
			const end = fractionToFloat(last.offset) + fractionToFloat(last.duration);
			const barLength = (rp.bars * rp.timeSignature[0]) / rp.timeSignature[1];
			expect(end, `${rp.id} ends at ${end}, past ${barLength}`).toBeLessThanOrEqual(barLength + 1e-9);
		}
	});

	it('declares a slot count matching its noteCount', () => {
		for (const rp of RHYTHM_PATTERNS) {
			expect(rp.slots.length, `${rp.id}`).toBe(rp.noteCount);
		}
	});

	it('orders slots by offset, with no overlap', () => {
		// Gaps are allowed (syncopated cells rest on the downbeat); overlaps are
		// not — two pitches sounding at once is not a single-line jazz phrase.
		for (const rp of RHYTHM_PATTERNS) {
			for (let i = 1; i < rp.slots.length; i++) {
				const prevEnd = fractionToFloat(rp.slots[i - 1].offset) + fractionToFloat(rp.slots[i - 1].duration);
				const thisStart = fractionToFloat(rp.slots[i].offset);
				expect(thisStart, `${rp.id} slot ${i} overlaps slot ${i - 1}`).toBeGreaterThanOrEqual(prevEnd - 1e-9);
			}
		}
	});
});

describe('scale pattern coverage', () => {
	it('gives every ear-training category at least three melodic shapes', () => {
		for (const category of EAR_TRAINING_CATEGORIES) {
			const shapes = SCALE_PATTERNS.filter((sp) => sp.category === category);
			expect(shapes.length, `category '${category}' has ${shapes.length} scale pattern(s)`).toBeGreaterThanOrEqual(3);
		}
	});
});

describe('generated pool', () => {
	const phrases = generateAllCombinations();

	it('produces licks for every ear-training category', () => {
		for (const category of EAR_TRAINING_CATEGORIES) {
			const inCat = phrases.filter((p) => p.category === category);
			expect(inCat.length, `category '${category}' generated ${inCat.length} licks`).toBeGreaterThanOrEqual(10);
		}
	});

	it('produces meaningfully more licks than the exact-match grid alone', () => {
		let exactOnly = 0;
		for (const sp of SCALE_PATTERNS) {
			for (const rp of RHYTHM_PATTERNS) if (sp.degrees.length === rp.noteCount) exactOnly++;
		}
		expect(phrases.length).toBeGreaterThan(exactOnly);
	});

	it('keeps every id unique', () => {
		const ids = phrases.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe('combine — filling a longer rhythm by repetition', () => {
	const sp3 = SCALE_PATTERNS.find((p) => p.degrees.length === 3 && p.category === 'ii-V-I-major')!;
	const rp6 = RHYTHM_PATTERNS.find((p) => p.noteCount === 6)!;
	const rp4 = RHYTHM_PATTERNS.find((p) => p.noteCount === 4)!;

	it('repeats a 3-note shape across a 6-note rhythm', () => {
		const phrase = combine(sp3, rp6, 'major.ionian', 'C', CMAJ_HARMONY, { repeat: 2, step: 0 });
		expect(phrase).not.toBeNull();
		expect(phrase!.notes).toHaveLength(6);
		// Literal repeat: the second cell is the same three pitches as the first.
		const pitches = phrase!.notes.map((n) => n.pitch);
		expect(pitches.slice(3)).toEqual(pitches.slice(0, 3));
	});

	it('walks the shape up the scale when a sequence step is given', () => {
		const phrase = combine(sp3, rp6, 'major.ionian', 'C', CMAJ_HARMONY, { repeat: 2, step: 1 });
		expect(phrase).not.toBeNull();
		const pitches = phrase!.notes.map((n) => n.pitch) as number[];
		// Each note of the second cell sits one scale step above its counterpart.
		expect(pitches.slice(3)).not.toEqual(pitches.slice(0, 3));
		for (let i = 0; i < 3; i++) expect(pitches[3 + i]).toBeGreaterThan(pitches[i]);
	});

	it('still refuses a rhythm whose note count is not a whole multiple', () => {
		// 3 into 4 is not a repetition — it would either truncate the melodic
		// idea or pad it arbitrarily, and both are worse than emitting nothing.
		expect(combine(sp3, rp4, 'major.ionian', 'C', CMAJ_HARMONY)).toBeNull();
		expect(combine(sp3, rp4, 'major.ionian', 'C', CMAJ_HARMONY, { repeat: 2, step: 0 })).toBeNull();
	});

	it('gives a repeated combination a different id from the exact one', () => {
		const rp3 = RHYTHM_PATTERNS.find((p) => p.noteCount === 3)!;
		const exact = combine(sp3, rp3, 'major.ionian', 'C', CMAJ_HARMONY)!;
		const repeated = combine(sp3, rp6, 'major.ionian', 'C', CMAJ_HARMONY, { repeat: 2, step: 0 })!;
		const sequenced = combine(sp3, rp6, 'major.ionian', 'C', CMAJ_HARMONY, { repeat: 2, step: 1 })!;
		expect(new Set([exact.id, repeated.id, sequenced.id]).size).toBe(3);
	});

	it('returns null when a sequence walks off the end of the pool', () => {
		const wide = { ...sp3, degrees: [0, 2, 40] };
		expect(combine(wide, rp6, 'major.ionian', 'C', CMAJ_HARMONY, { repeat: 2, step: 30 })).toBeNull();
	});
});
