import { describe, it, expect } from 'vitest';
import { SCALE_CATALOG, getScale, getScalesByFamily, getScalesForChord, MVP_SCALE_IDS, getMvpScales } from '$lib/music/scales.ts';

describe('SCALE_CATALOG', () => {
	it('has 33 scales', () => {
		expect(SCALE_CATALOG).toHaveLength(33);
	});

	it('every scale intervals sum to 12', () => {
		for (const scale of SCALE_CATALOG) {
			const sum = scale.intervals.reduce((a, b) => a + b, 0);
			expect(sum, `${scale.id} intervals sum to ${sum}`).toBe(12);
		}
	});

	it('every scale has matching degrees count', () => {
		for (const scale of SCALE_CATALOG) {
			expect(
				scale.degrees.length,
				`${scale.id}: ${scale.degrees.length} degrees vs ${scale.intervals.length} intervals`
			).toBe(scale.intervals.length);
		}
	});

	it('has unique IDs', () => {
		const ids = SCALE_CATALOG.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe('getScale', () => {
	it('finds by ID', () => {
		const dorian = getScale('major.dorian');
		expect(dorian).toBeDefined();
		expect(dorian!.name).toBe('Dorian');
	});

	it('returns undefined for missing ID', () => {
		expect(getScale('nonexistent')).toBeUndefined();
	});
});

describe('getScalesByFamily', () => {
	it('returns 7 major modes', () => {
		expect(getScalesByFamily('major')).toHaveLength(7);
	});

	it('returns 7 melodic minor modes', () => {
		expect(getScalesByFamily('melodic-minor')).toHaveLength(7);
	});

	it('returns 4 bebop scales', () => {
		expect(getScalesByFamily('bebop')).toHaveLength(4);
	});
});

describe('getScalesForChord', () => {
	it('finds scales for min7', () => {
		const scales = getScalesForChord('min7');
		const ids = scales.map((s) => s.id);
		expect(ids).toContain('major.dorian');
		expect(ids).toContain('pentatonic.minor');
	});

	it('finds scales for 7', () => {
		const scales = getScalesForChord('7');
		const ids = scales.map((s) => s.id);
		expect(ids).toContain('major.mixolydian');
		expect(ids).toContain('bebop.dominant');
	});
});

describe('MVP scales', () => {
	it('has 20 MVP scales', () => {
		expect(MVP_SCALE_IDS).toHaveLength(20);
	});

	it('getMvpScales returns all resolved definitions', () => {
		const mvp = getMvpScales();
		expect(mvp).toHaveLength(20);
		expect(mvp.every((s) => s !== undefined)).toBe(true);
	});
});
