import { describe, it, expect } from 'vitest';
import { difficultyBand, difficultyColor, difficultyDisplay, masteryDisplay } from '$lib/difficulty/display';
import { getProfileForLevel } from '$lib/difficulty/params';

describe('difficultyBand', () => {
	it('maps 1 → 1 (lower bound of band 1)', () => {
		expect(difficultyBand(1)).toBe(1);
	});

	it('maps 10 → 1 (upper bound of band 1)', () => {
		expect(difficultyBand(10)).toBe(1);
	});

	it('maps 11 → 2 (lower bound of band 2)', () => {
		expect(difficultyBand(11)).toBe(2);
	});

	it('maps 20 → 2 (upper bound of band 2)', () => {
		expect(difficultyBand(20)).toBe(2);
	});

	it('maps every 10th boundary: 30→3, 40→4, 50→5, 60→6, 70→7, 80→8, 90→9, 100→10', () => {
		expect(difficultyBand(30)).toBe(3);
		expect(difficultyBand(40)).toBe(4);
		expect(difficultyBand(50)).toBe(5);
		expect(difficultyBand(60)).toBe(6);
		expect(difficultyBand(70)).toBe(7);
		expect(difficultyBand(80)).toBe(8);
		expect(difficultyBand(90)).toBe(9);
		expect(difficultyBand(100)).toBe(10);
	});

	it('maps every lower bound: 21→3, 31→4, 41→5, 51→6, 61→7, 71→8, 81→9, 91→10', () => {
		expect(difficultyBand(21)).toBe(3);
		expect(difficultyBand(31)).toBe(4);
		expect(difficultyBand(41)).toBe(5);
		expect(difficultyBand(51)).toBe(6);
		expect(difficultyBand(61)).toBe(7);
		expect(difficultyBand(71)).toBe(8);
		expect(difficultyBand(81)).toBe(9);
		expect(difficultyBand(91)).toBe(10);
	});

	it('clamps 0 → 1', () => {
		expect(difficultyBand(0)).toBe(1);
	});

	it('clamps -5 → 1', () => {
		expect(difficultyBand(-5)).toBe(1);
	});

	it('clamps 101 → 10', () => {
		expect(difficultyBand(101)).toBe(10);
	});

	it('clamps 999 → 10', () => {
		expect(difficultyBand(999)).toBe(10);
	});
});

describe('difficultyColor', () => {
	it('band 1 difficulties (1-10) return the band-1 token', () => {
		for (let d = 1; d <= 10; d++) {
			expect(difficultyColor(d)).toBe('var(--difficulty-1)');
		}
	});

	it('band 10 difficulties (91-100) return the band-10 token', () => {
		for (let d = 91; d <= 100; d++) {
			expect(difficultyColor(d)).toBe('var(--difficulty-10)');
		}
	});

	it('all 10 bands return distinct colors', () => {
		const colors = new Set<string>();
		for (let band = 1; band <= 10; band++) {
			const representative = (band - 1) * 10 + 5;
			colors.add(difficultyColor(representative));
		}
		expect(colors.size).toBe(10);
	});

});

describe('difficultyDisplay', () => {
	it('returns correct object for band 1', () => {
		expect(difficultyDisplay(5)).toEqual({
			band: 1,
			label: '1-10',
			color: 'var(--difficulty-1)',
			name: 'Beginner',
		});
	});

	it('returns correct object for band 5', () => {
		expect(difficultyDisplay(45)).toEqual({
			band: 5,
			label: '41-50',
			color: 'var(--difficulty-5)',
			name: 'Intermediate',
		});
	});

	it('returns correct object for band 10', () => {
		expect(difficultyDisplay(95)).toEqual({
			band: 10,
			label: '91-100',
			color: 'var(--difficulty-10)',
			name: 'Virtuoso',
		});
	});

	it('all 10 bands have correct label format', () => {
		for (let band = 1; band <= 10; band++) {
			const representative = (band - 1) * 10 + 5;
			const display = difficultyDisplay(representative);
			const lo = (band - 1) * 10 + 1;
			const hi = band * 10;
			expect(display.label).toBe(`${lo}-${hi}`);
		}
	});

	it('all 10 BAND_NAMES are present', () => {
		const expectedNames = [
			'Beginner',
			'Elementary',
			'Easy',
			'Moderate',
			'Intermediate',
			'Challenging',
			'Advanced',
			'Expert',
			'Master',
			'Virtuoso',
		];
		const values = [5, 15, 25, 35, 45, 55, 65, 75, 85, 95];
		const names = values.map((d: number): string => difficultyDisplay(d).name);
		expect(names).toEqual(expectedNames);
	});
});

describe('masteryDisplay', () => {
	it('returns the teal→brass CSS var for the band, not a difficulty hex', () => {
		expect(masteryDisplay(5)).toEqual({
			band: 1,
			label: '1-10',
			color: 'var(--mastery-1)',
			name: 'Beginner',
		});
		expect(masteryDisplay(95)).toEqual({
			band: 10,
			label: '91-100',
			color: 'var(--mastery-10)',
			name: 'Virtuoso',
		});
	});

	it('maps every band to its own --mastery var (theme-aware, no literal hex)', () => {
		for (let band = 1; band <= 10; band++) {
			const rep = (band - 1) * 10 + 5;
			const disp = masteryDisplay(rep);
			expect(disp.band).toBe(band);
			expect(disp.color).toBe(`var(--mastery-${band})`);
		}
	});

	it('clamps out-of-range values like difficultyBand does', () => {
		expect(masteryDisplay(0).color).toBe('var(--mastery-1)');
		expect(masteryDisplay(999).color).toBe('var(--mastery-10)');
	});
});

/**
 * The ear-training settings slider shows difficultyDisplay(value).name beside
 * the value while generatePhrase() selects content with
 * getProfileForLevel(value). Those are two different 10-step ramps over the
 * same 1-100 input, so nothing structural keeps them honest — and when
 * getProfile() still inferred its scale from the argument's magnitude they
 * disagreed wildly: at value 10 the label read "Beginner" while the generator
 * selected tier 10, "No Limits". Pin them together.
 */
describe('displayed difficulty name matches the content it selects', () => {
	it('never diverges from the selected content tier by more than one step', () => {
		for (let level = 1; level <= 100; level++) {
			const band = difficultyDisplay(level).band;
			const tier = getProfileForLevel(level).level;
			expect(Math.abs(band - tier), `level ${level}: band ${band} vs tier ${tier}`).toBeLessThanOrEqual(1);
		}
	});

	it('the Beginner end of the slider selects beginner content', () => {
		expect(difficultyDisplay(10).name).toBe('Beginner');
		expect(getProfileForLevel(10).name).toBe('Full Pentatonic');
		expect(getProfileForLevel(10).name).not.toBe('No Limits');
	});

	it('the Virtuoso end of the slider selects the top tier', () => {
		expect(difficultyDisplay(100).name).toBe('Virtuoso');
		expect(getProfileForLevel(100).name).toBe('No Limits');
	});

	it('both ramps rise together across the slider', () => {
		let prevBand = 0;
		let prevTier = 0;
		for (let level = 1; level <= 100; level++) {
			const band = difficultyDisplay(level).band;
			const tier = getProfileForLevel(level).level;
			expect(band).toBeGreaterThanOrEqual(prevBand);
			expect(tier).toBeGreaterThanOrEqual(prevTier);
			prevBand = band;
			prevTier = tier;
		}
	});
});
