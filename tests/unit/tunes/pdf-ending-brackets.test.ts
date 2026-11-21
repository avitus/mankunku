import { describe, expect, it } from 'vitest';
import { hasDashedEndingDirection, readOpenEndingBracket } from '$lib/tunes/import/pdf-ending-brackets';

describe('handwritten open voltas', () => {
	const roof = (x: number, y: number) => x >= 50 && x <= 135 && y >= 42 && y <= 44;
	const left = (x: number, y: number) => x >= 50 && x <= 52 && y >= 42 && y <= 89;
	const right = (x: number, y: number) => x >= 133 && x <= 135 && y >= 42 && y <= 89;
	it('measures the roof and hook of a short open bracket in staff spaces', () => {
		expect(readOpenEndingBracket((x, y) => roof(x, y) || left(x, y), 50, 300, 120, 10, 0))
			.toEqual({ width: 8.6, height: 4.8 });
	});
	it('requires the opening hook, the open end, and the barline underneath', () => {
		expect(readOpenEndingBracket(roof, 50, 300, 120, 10, 0)).toBeUndefined();
		expect(readOpenEndingBracket((x, y) => roof(x, y) || left(x, y) || right(x, y), 50, 300, 120, 10, 0)).toBeUndefined();
		expect(readOpenEndingBracket((x, y) => roof(x, y) || left(x, y), 72, 300, 120, 10, 0)).toBeUndefined();
	});
});

it('reads a dashed continuation only when its final stroke lines up with the barline', () => {
	const dashes = (x: number, y: number) => y === 52 && x >= 200 && x <= 285 && (x - 200) % 20 < 12;
	const stop = (x: number, y: number) => x === 290 && Math.abs(y - 52) <= 7;
	expect(hasDashedEndingDirection((x, y) => dashes(x, y) || stop(x, y), 30, 295, 90, 10, 0)).toBe(true);
	expect(hasDashedEndingDirection(dashes, 30, 295, 90, 10, 0)).toBe(false);
	expect(hasDashedEndingDirection((x, y) => dashes(x, y) || stop(x, y), 30, 330, 90, 10, 0)).toBe(false);
});
