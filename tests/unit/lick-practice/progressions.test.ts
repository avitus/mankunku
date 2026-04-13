import { describe, it, expect } from 'vitest';
import {
	PROGRESSION_TEMPLATES,
	transposeProgression,
	PROGRESSION_LICK_CATEGORIES,
	getLickAlignmentOffset,
	getChordRootAtOffset,
	isChordQualityCategory
} from '$lib/data/progressions.ts';
import type { ChordProgressionType } from '$lib/types/lick-practice.ts';
import { PITCH_CLASSES, type PitchClass } from '$lib/types/music.ts';
import { fractionToFloat } from '$lib/music/intervals.ts';

describe('PROGRESSION_TEMPLATES', () => {
	const types: ChordProgressionType[] = [
		'ii-V-I-major', 'ii-V-I-minor',
		'ii-V-I-major-long', 'ii-V-I-minor-long',
		'turnaround', 'blues'
	];

	it('defines all 6 progression types', () => {
		for (const type of types) {
			expect(PROGRESSION_TEMPLATES[type]).toBeDefined();
			expect(PROGRESSION_TEMPLATES[type].type).toBe(type);
		}
	});

	it('all progressions have valid harmony segments', () => {
		for (const type of types) {
			const template = PROGRESSION_TEMPLATES[type];
			expect(template.harmony.length).toBeGreaterThan(0);

			for (const seg of template.harmony) {
				expect(PITCH_CLASSES).toContain(seg.chord.root);
				expect(seg.chord.quality).toBeTruthy();
				expect(seg.scaleId).toBeTruthy();
				expect(fractionToFloat(seg.startOffset)).toBeGreaterThanOrEqual(0);
				expect(fractionToFloat(seg.duration)).toBeGreaterThan(0);
			}
		}
	});

	it('harmony segments do not overlap within each progression', () => {
		for (const type of types) {
			const template = PROGRESSION_TEMPLATES[type];
			for (let i = 1; i < template.harmony.length; i++) {
				const prevEnd = fractionToFloat(template.harmony[i - 1].startOffset)
					+ fractionToFloat(template.harmony[i - 1].duration);
				const currStart = fractionToFloat(template.harmony[i].startOffset);
				expect(currStart).toBeGreaterThanOrEqual(prevEnd - 0.001);
			}
		}
	});

	it('short ii-V-I major is 2 bars: Dm7 (2 beats) G7 (2 beats) Cmaj7 (4 beats)', () => {
		const t = PROGRESSION_TEMPLATES['ii-V-I-major'];
		expect(t.bars).toBe(2);
		expect(t.harmony).toHaveLength(3);
		expect(t.harmony[0].chord.root).toBe('D');
		expect(t.harmony[0].chord.quality).toBe('min7');
		expect(fractionToFloat(t.harmony[0].duration) * 4).toBe(2); // 2 beats
		expect(t.harmony[1].chord.root).toBe('G');
		expect(t.harmony[1].chord.quality).toBe('7');
		expect(fractionToFloat(t.harmony[1].duration) * 4).toBe(2); // 2 beats
		expect(t.harmony[2].chord.root).toBe('C');
		expect(t.harmony[2].chord.quality).toBe('maj7');
		expect(fractionToFloat(t.harmony[2].duration) * 4).toBe(4); // 4 beats (1 bar)
		const totalBeats = t.harmony.reduce((sum, seg) => sum + fractionToFloat(seg.duration) * 4, 0);
		expect(totalBeats).toBe(8); // 2 bars * 4 beats
	});

	it('blues has correct 12-bar structure (7 segments)', () => {
		const h = PROGRESSION_TEMPLATES['blues'].harmony;
		expect(h).toHaveLength(7);
		const totalBeats = h.reduce((sum, seg) => sum + fractionToFloat(seg.duration) * 4, 0);
		expect(totalBeats).toBe(48); // 12 bars * 4 beats
	});
});

describe('transposeProgression', () => {
	it('returns original harmony when target key is C', () => {
		const original = PROGRESSION_TEMPLATES['ii-V-I-major'].harmony;
		const transposed = transposeProgression(original, 'C');
		expect(transposed).toBe(original);
	});

	it('transposes ii-V-I major to F (Gm7 → C7 → Fmaj7)', () => {
		const original = PROGRESSION_TEMPLATES['ii-V-I-major'].harmony;
		const transposed = transposeProgression(original, 'F');
		expect(transposed[0].chord.root).toBe('G');
		expect(transposed[0].chord.quality).toBe('min7');
		expect(transposed[1].chord.root).toBe('C');
		expect(transposed[1].chord.quality).toBe('7');
		expect(transposed[2].chord.root).toBe('F');
		expect(transposed[2].chord.quality).toBe('maj7');
	});

	it('transposes to Bb (Cm7 → F7 → Bbmaj7)', () => {
		const original = PROGRESSION_TEMPLATES['ii-V-I-major'].harmony;
		const transposed = transposeProgression(original, 'Bb');
		expect(transposed[0].chord.root).toBe('C');
		expect(transposed[1].chord.root).toBe('F');
		expect(transposed[2].chord.root).toBe('Bb');
	});

	it('preserves segment durations and offsets', () => {
		const original = PROGRESSION_TEMPLATES['ii-V-I-major'].harmony;
		const transposed = transposeProgression(original, 'Ab');
		for (let i = 0; i < original.length; i++) {
			expect(transposed[i].startOffset).toEqual(original[i].startOffset);
			expect(transposed[i].duration).toEqual(original[i].duration);
			expect(transposed[i].scaleId).toBe(original[i].scaleId);
		}
	});

	it('transposes all 12 keys without error', () => {
		const original = PROGRESSION_TEMPLATES['turnaround'].harmony;
		for (const key of PITCH_CLASSES) {
			const transposed = transposeProgression(original, key);
			expect(transposed).toHaveLength(original.length);
		}
	});
});

describe('PROGRESSION_LICK_CATEGORIES', () => {
	it('every progression type has at least one compatible lick category', () => {
		const allTypes: ChordProgressionType[] = [
			'ii-V-I-major', 'ii-V-I-minor',
			'ii-V-I-major-long', 'ii-V-I-minor-long',
			'turnaround', 'blues'
		];
		for (const type of allTypes) {
			expect(PROGRESSION_LICK_CATEGORIES[type], `${type} should be defined`).toBeDefined();
			expect(PROGRESSION_LICK_CATEGORIES[type].length, `${type} should have compatible categories`).toBeGreaterThan(0);
		}
	});

	it('every entry has a category and a fraction offset', () => {
		for (const entries of Object.values(PROGRESSION_LICK_CATEGORIES)) {
			for (const entry of entries) {
				expect(entry.category).toBeTruthy();
				expect(Array.isArray(entry.offset)).toBe(true);
				expect(entry.offset.length).toBe(2);
			}
		}
	});
});

describe('getLickAlignmentOffset', () => {
	it('returns [0,1] for unknown category (safe default)', () => {
		expect(getLickAlignmentOffset('ii-V-I-major-long', 'pentatonic')).toEqual([0, 1]);
	});

	it('aligns V-I-major at bar 1 of long ii-V-I major', () => {
		expect(getLickAlignmentOffset('ii-V-I-major-long', 'V-I-major')).toEqual([1, 1]);
	});

	it('aligns V-I-minor at bar 1 of long ii-V-I minor', () => {
		expect(getLickAlignmentOffset('ii-V-I-minor-long', 'V-I-minor')).toEqual([1, 1]);
	});

	it('aligns chord-quality licks correctly in long ii-V-I major', () => {
		expect(getLickAlignmentOffset('ii-V-I-major-long', 'minor-chord')).toEqual([0, 1]);
		expect(getLickAlignmentOffset('ii-V-I-major-long', 'dominant-chord')).toEqual([1, 1]);
		expect(getLickAlignmentOffset('ii-V-I-major-long', 'major-chord')).toEqual([2, 1]);
	});

	it('aligns chord-quality licks correctly in long ii-V-I minor', () => {
		expect(getLickAlignmentOffset('ii-V-I-minor-long', 'diminished-chord')).toEqual([0, 1]);
		expect(getLickAlignmentOffset('ii-V-I-minor-long', 'dominant-chord')).toEqual([1, 1]);
		expect(getLickAlignmentOffset('ii-V-I-minor-long', 'minor-chord')).toEqual([2, 1]);
	});

	it('aligns major-chord at bar 1 in short ii-V-I major (I chord)', () => {
		expect(getLickAlignmentOffset('ii-V-I-major', 'major-chord')).toEqual([1, 1]);
	});

	it('aligns minor-chord at bar 1 in short ii-V-I minor (I chord)', () => {
		expect(getLickAlignmentOffset('ii-V-I-minor', 'minor-chord')).toEqual([1, 1]);
	});
});

describe('getChordRootAtOffset', () => {
	it('returns ii root for bar 0 of long ii-V-I major in C', () => {
		expect(getChordRootAtOffset('ii-V-I-major-long', 'C', [0, 1])).toBe('D');
	});

	it('returns V root for bar 1 of long ii-V-I major in F', () => {
		// In F: ii=Gm7, V=C7, I=Fmaj7
		expect(getChordRootAtOffset('ii-V-I-major-long', 'F', [1, 1])).toBe('C');
	});

	it('returns I root for bar 2 of long ii-V-I major in F', () => {
		expect(getChordRootAtOffset('ii-V-I-major-long', 'F', [2, 1])).toBe('F');
	});

	it('returns null when no segment starts at the offset', () => {
		expect(getChordRootAtOffset('ii-V-I-major-long', 'C', [7, 8])).toBeNull();
	});
});

describe('isChordQualityCategory', () => {
	it('flags chord-quality categories', () => {
		expect(isChordQualityCategory('major-chord')).toBe(true);
		expect(isChordQualityCategory('dominant-chord')).toBe(true);
		expect(isChordQualityCategory('minor-chord')).toBe(true);
		expect(isChordQualityCategory('diminished-chord')).toBe(true);
	});

	it('does not flag sub-progression or full-progression categories', () => {
		expect(isChordQualityCategory('V-I-major')).toBe(false);
		expect(isChordQualityCategory('ii-V-I-major')).toBe(false);
		expect(isChordQualityCategory('pentatonic')).toBe(false);
	});
});
