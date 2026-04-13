import { describe, it, expect } from 'vitest';
import { getScale, getScalesByFamily, getScalesForChord } from '$lib/music/scales.ts';

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
