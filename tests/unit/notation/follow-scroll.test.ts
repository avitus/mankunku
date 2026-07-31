import { describe, it, expect } from 'vitest';
import {
	followOffsetPx,
	targetContentY,
	buildFollowSystems,
	svgCssScale,
	type FollowSystem
} from '$lib/notation/follow-scroll';

/** Three systems of 4 bars each, 100px apart. */
function threeSystems(): FollowSystem[] {
	return [
		{ firstBar: 0, lastBarExclusive: 4, topPx: 0 },
		{ firstBar: 4, lastBarExclusive: 8, topPx: 100 },
		{ firstBar: 8, lastBarExclusive: 12, topPx: 200 }
	];
}

describe('targetContentY — continuous system lerp', () => {
	const systems = threeSystems();

	it('parks on the first system before the form starts', () => {
		expect(targetContentY(systems, -0.5)).toBe(0);
	});

	it('starts a system at that system top', () => {
		expect(targetContentY(systems, 0)).toBe(0);
		expect(targetContentY(systems, 4)).toBe(100);
		expect(targetContentY(systems, 8)).toBe(200);
	});

	it('lerps halfway through a system toward the next system top', () => {
		// Bars 0–4: mid-system at bar 2 → t = 0.5 → 50px
		expect(targetContentY(systems, 2)).toBe(50);
		// Bars 4–8: at bar 6 → t = 0.5 → 150px
		expect(targetContentY(systems, 6)).toBe(150);
	});

	it('includes fractional progress within a bar', () => {
		// bar 1.0 is 1/4 through system 0 → t = 0.25 → 25px
		expect(targetContentY(systems, 1)).toBe(25);
		// bar 1.5 is 1.5/4 → t = 0.375 → 37.5px
		expect(targetContentY(systems, 1.5)).toBe(37.5);
	});

	it('holds the last system top (no phantom next line)', () => {
		expect(targetContentY(systems, 8)).toBe(200);
		expect(targetContentY(systems, 10)).toBe(200);
		expect(targetContentY(systems, 12)).toBe(200);
		expect(targetContentY(systems, 20)).toBe(200);
	});

	it('returns 0 for empty geometry', () => {
		expect(targetContentY([], 3)).toBe(0);
	});
});

describe('followOffsetPx — reading line + clamp', () => {
	const systems = threeSystems();
	// Tall content so we can actually scroll.
	const contentPx = 400;
	const viewportPx = 200;
	const readingLine = 0.28; // reading line at 56px from viewport top

	it('returns 0 when content fits in the viewport', () => {
		expect(
			followOffsetPx({
				systems,
				barFraction: 6,
				viewportPx: 500,
				contentPx: 300,
				readingLine
			})
		).toBe(0);
	});

	it('returns 0 for empty systems', () => {
		expect(
			followOffsetPx({
				systems: [],
				barFraction: 3,
				viewportPx,
				contentPx,
				readingLine
			})
		).toBe(0);
	});

	it('returns 0 for non-finite bar fraction', () => {
		expect(
			followOffsetPx({
				systems,
				barFraction: Number.NaN,
				viewportPx,
				contentPx,
				readingLine
			})
		).toBe(0);
	});

	it('at form start, reading line sits at first system (no negative scroll)', () => {
		// targetY=0, readingLine offset wants 0 - 56 = -56 → clamp to 0 → translate 0
		expect(
			followOffsetPx({ systems, barFraction: 0, viewportPx, contentPx, readingLine })
		).toBe(0);
	});

	it('mid first system drifts so targetY sits on the reading line', () => {
		// bar 2 → targetY 50; offset = 50 - 56 = -6 → clamp 0 → still 0
		// (early form still above the reading line until content has scrolled enough)
		expect(
			followOffsetPx({ systems, barFraction: 2, viewportPx, contentPx, readingLine })
		).toBe(0);

		// bar 4 → targetY 100; offset = 100 - viewport*0.28 → translate ~-44
		expect(
			followOffsetPx({ systems, barFraction: 4, viewportPx, contentPx, readingLine })
		).toBeCloseTo(-(100 - viewportPx * readingLine), 10);
	});

	it('mid second system continues the continuous drift', () => {
		// bar 6 → targetY 150
		expect(
			followOffsetPx({ systems, barFraction: 6, viewportPx, contentPx, readingLine })
		).toBeCloseTo(-(150 - viewportPx * readingLine), 10);
	});

	it('never overscrolls past content end', () => {
		const maxScroll = contentPx - viewportPx; // 200
		// Even with a huge targetY the clamp holds maxScroll
		const deep = followOffsetPx({
			systems,
			barFraction: 11,
			viewportPx,
			contentPx,
			readingLine
		});
		expect(deep).toBeGreaterThanOrEqual(-maxScroll);
		expect(deep).toBeLessThanOrEqual(0);
	});

	it('uses default reading line 0.28 when omitted', () => {
		const a = followOffsetPx({ systems, barFraction: 4, viewportPx, contentPx });
		const b = followOffsetPx({
			systems,
			barFraction: 4,
			viewportPx,
			contentPx,
			readingLine: 0.28
		});
		expect(a).toBe(b);
	});
});

describe('buildFollowSystems', () => {
	it('aggregates absolute bars per system and pairs tops', () => {
		const zones = [
			{ absBar: 0, systemIdx: 0 },
			{ absBar: 1, systemIdx: 0 },
			{ absBar: 2, systemIdx: 0 },
			{ absBar: 3, systemIdx: 0 },
			{ absBar: 4, systemIdx: 1 },
			{ absBar: 5, systemIdx: 1 }
		];
		const systems = buildFollowSystems(zones, [0, 120]);
		expect(systems).toEqual([
			{ firstBar: 0, lastBarExclusive: 4, topPx: 0 },
			{ firstBar: 4, lastBarExclusive: 6, topPx: 120 }
		]);
	});

	it('skips systems with missing tops and returns empty for empty input', () => {
		expect(buildFollowSystems([], [0])).toEqual([]);
		expect(buildFollowSystems([{ absBar: 0, systemIdx: 0 }], [])).toEqual([]);
		// systemIdx 1 has no top entry
		expect(
			buildFollowSystems(
				[
					{ absBar: 0, systemIdx: 0 },
					{ absBar: 4, systemIdx: 1 }
				],
				[10] // only system 0
			)
		).toEqual([{ firstBar: 0, lastBarExclusive: 1, topPx: 10 }]);
	});

	it('ignores non-finite absBar entries so bad zones cannot invent a phantom system', () => {
		const systems = buildFollowSystems(
			[
				{ absBar: 0, systemIdx: 0 },
				{ absBar: Number.NaN, systemIdx: 0 },
				{ absBar: 4, systemIdx: 1 }
			],
			[0, 100]
		);
		expect(systems).toEqual([
			{ firstBar: 0, lastBarExclusive: 1, topPx: 0 },
			{ firstBar: 4, lastBarExclusive: 5, topPx: 100 }
		]);
	});
});

describe('svgCssScale — transform-independent scale', () => {
	it('returns cssWidth / viewBoxWidth for positive inputs', () => {
		expect(svgCssScale(800, 400)).toBe(2);
		expect(svgCssScale(600, 600)).toBe(1);
	});

	it('returns 0 for non-positive or non-finite inputs', () => {
		expect(svgCssScale(0, 400)).toBe(0);
		expect(svgCssScale(800, 0)).toBe(0);
		expect(svgCssScale(-10, 400)).toBe(0);
		expect(svgCssScale(Number.NaN, 400)).toBe(0);
		expect(svgCssScale(800, Infinity)).toBe(0);
	});
});

describe('followOffsetPx — non-finite guards', () => {
	const systems = threeSystems();

	it('returns 0 when viewport or content is non-positive', () => {
		expect(
			followOffsetPx({ systems, barFraction: 6, viewportPx: 0, contentPx: 400 })
		).toBe(0);
		expect(
			followOffsetPx({ systems, barFraction: 6, viewportPx: 200, contentPx: 0 })
		).toBe(0);
	});

	it('returns 0 when a system top is non-finite (targetY collapses)', () => {
		const bad: FollowSystem[] = [
			{ firstBar: 0, lastBarExclusive: 4, topPx: Number.NaN },
			{ firstBar: 4, lastBarExclusive: 8, topPx: 100 }
		];
		expect(
			followOffsetPx({ systems: bad, barFraction: 1, viewportPx: 200, contentPx: 400 })
		).toBe(0);
	});
});

