import { describe, it, expect } from 'vitest';
import { difficultyBand, difficultyColor, difficultyDisplay } from '$lib/difficulty/display';

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
	it('band 1 difficulties (1-10) return #22c55e', () => {
		for (let d = 1; d <= 10; d++) {
			expect(difficultyColor(d)).toBe('#22c55e');
		}
	});

	it('band 10 difficulties (91-100) return #991b1b', () => {
		for (let d = 91; d <= 100; d++) {
			expect(difficultyColor(d)).toBe('#991b1b');
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

	it('every returned value matches /^#[0-9a-f]{6}$/', () => {
		for (let d = 1; d <= 100; d++) {
			expect(difficultyColor(d)).toMatch(/^#[0-9a-f]{6}$/);
		}
	});
});

describe('difficultyDisplay', () => {
	it('returns correct object for band 1', () => {
		expect(difficultyDisplay(5)).toEqual({
			band: 1,
			label: '1-10',
			color: '#22c55e',
			name: 'Beginner',
		});
	});

	it('returns correct object for band 5', () => {
		expect(difficultyDisplay(45)).toEqual({
			band: 5,
			label: '41-50',
			color: '#facc15',
			name: 'Intermediate',
		});
	});

	it('returns correct object for band 10', () => {
		expect(difficultyDisplay(95)).toEqual({
			band: 10,
			label: '91-100',
			color: '#991b1b',
			name: 'Virtuoso',
		});
	});

	it('all 10 bands have non-empty name', () => {
		for (let band = 1; band <= 10; band++) {
			const representative = (band - 1) * 10 + 5;
			const display = difficultyDisplay(representative);
			expect(display.name).toBeTruthy();
			expect(display.name.length).toBeGreaterThan(0);
		}
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
