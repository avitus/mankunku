import { describe, it, expect } from 'vitest';
import {
	planEndingPlacements,
	endingAlignTransform,
	endingAlignMatrix,
	endingGlyphTranslateDx,
	endingGlyphTranslate,
	rigidGlyphScreenSpanAfterTranslate,
	endingChordGroupNudge,
	endingLabelHookNudge,
	endingChordVerticalMatchDy,
	meanFinite,
	planStackedEndingRigidGlyphs,
	ENDING_LABEL_CHORD_MIN_GAP,
	ENDING_LABEL_HOOK_MIN_GAP,
	placeEndingSection,
	advanceEndingLayout,
	initialEndingLayoutState
} from '$lib/music/ending-layout';

describe('planEndingPlacements', () => {
	it('flows [1] inline after a partial system and stacks [2] with align flag', () => {
		const plan = planEndingPlacements(
			[
				{ bars: 2 },
				{ bars: 1, ending: 1 },
				{ bars: 1, ending: 2 },
				{ bars: 2 }
			],
			4
		);
		expect(plan[0]).toMatchObject({ startsNewLine: true, startColumn: 0 });
		expect(plan[1]).toMatchObject({
			startsNewLine: false,
			startColumn: 2,
			alignUnderFirstEnding: false
		});
		expect(plan[2]).toMatchObject({
			startsNewLine: true,
			startColumn: 0,
			alignUnderFirstEnding: true,
			alignToColumn: 2
		});
		expect(plan[3]).toMatchObject({ startsNewLine: true, startColumn: 0 });
	});

	it('does not request align when [1] already starts at the left margin', () => {
		const plan = planEndingPlacements(
			[
				{ bars: 4 },
				{ bars: 1, ending: 1 },
				{ bars: 1, ending: 2 }
			],
			4
		);
		expect(plan[1].startColumn).toBe(0);
		expect(plan[1].startsNewLine).toBe(true);
		expect(plan[2].alignUnderFirstEnding).toBe(false);
	});

	it('never invents pad columns for [2] (startColumn always 0)', () => {
		const plan = planEndingPlacements(
			[
				{ bars: 2 },
				{ bars: 2, ending: 1 },
				{ bars: 2, ending: 2 }
			],
			4
		);
		expect(plan[2].startColumn).toBe(0);
		expect(plan[2].alignUnderFirstEnding).toBe(true);
	});
});

describe('endingAlignTransform', () => {
	it('maps a full-width [2] onto a compact [1] span', () => {
		const t = endingAlignTransform({ x: 300, width: 120 }, { x: 40, width: 500 })!;
		expect(t.sx).toBeCloseTo(120 / 500, 5);
		expect(t.sx * 40 + t.tx).toBeCloseTo(300, 5);
		expect(t.sx * (40 + 500) + t.tx).toBeCloseTo(300 + 120, 5);
	});

	it('returns null when already aligned and same width', () => {
		expect(
			endingAlignTransform({ x: 100, width: 80 }, { x: 100, width: 80 })
		).toBeNull();
	});

	it('emits a valid SVG matrix string', () => {
		const t = endingAlignTransform({ x: 200, width: 100 }, { x: 50, width: 200 })!;
		expect(endingAlignMatrix(t)).toMatch(/^matrix\([-\d.]+ 0 0 1 [-\d.]+ 0\)$/);
	});
});

describe('endingGlyphTranslate — no horizontal squash', () => {
	const first = { x: 300, width: 120 };
	const second = { x: 40, width: 500 };
	const xform = endingAlignTransform(first, second)!;

	it('maps centers under [1] without changing glyph size', () => {
		// A whole note at local cx=110 must land at sx*110+tx, width still 18.
		const localX = 100;
		const localW = 18;
		const cx = localX + localW / 2;
		const dx = endingGlyphTranslateDx(xform.sx, xform.tx, cx);
		const screenCx = cx + dx;
		expect(screenCx).toBeCloseTo(xform.sx * cx + xform.tx, 5);
		// Screen width == local width (pure translate, not scale).
		const span = rigidGlyphScreenSpanAfterTranslate(xform.sx, xform.tx, localX, localW);
		expect(span.right - span.left).toBeCloseTo(localW, 5);
		expect(span.right - span.left).toBeGreaterThan(xform.sx * localW * 2);
	});

	it('emits a translate(...) string or null', () => {
		expect(endingGlyphTranslate(1, 0, 100)).toBeNull();
		expect(endingGlyphTranslate(xform.sx, xform.tx, 200)).toMatch(/^translate\([-\d.]+,0\)$/);
	});
});

describe('planStackedEndingRigidGlyphs — stacked [2] invariants', () => {
	// A Train–like: compact inline [1], full-staff [2], "2" hard against first chord.
	const first = { x: 300, width: 120 };
	const second = { x: 40, width: 500 };
	const xform = endingAlignTransform(first, second)!;

	it('computes a compress+translate align (not identity)', () => {
		expect(xform.sx).toBeLessThan(0.5);
		expect(xform.sx * second.x + xform.tx).toBeCloseTo(first.x, 5);
	});

	it('keeps notehead / barline screen width equal to local width', () => {
		const note = rigidGlyphScreenSpanAfterTranslate(xform.sx, xform.tx, 120, 18);
		const bar = rigidGlyphScreenSpanAfterTranslate(xform.sx, xform.tx, 520, 3);
		expect(note.right - note.left).toBeCloseTo(18, 5);
		expect(bar.right - bar.left).toBeCloseTo(3, 5);
	});

	it('nudges the volta "2" clear of the left hook after path compression', () => {
		// Path hook at local x=40; digit near the hook. After sx≈0.24 the
		// full-size digit overlaps the hook unless labelExtraDx is applied.
		const hookLocalX = 40;
		const label = { x: 45, width: 14 };
		const plan = planStackedEndingRigidGlyphs(xform, label, [], hookLocalX);

		expect(plan.labelExtraDx).toBeGreaterThan(0);
		expect(plan.hookScreenX).toBeCloseTo(xform.sx * hookLocalX + xform.tx, 5);
		expect(plan.labelScreen).not.toBeNull();
		const gap = plan.labelScreen!.left - plan.hookScreenX!;
		expect(gap).toBeGreaterThanOrEqual(ENDING_LABEL_HOOK_MIN_GAP - 0.01);
	});

	it('nudges chords so the volta "2" and first chord do not overlap', () => {
		const label = { x: 45, width: 12 };
		const chords = [
			{ x: 50, width: 36 }, // A7 — would collide with "2"
			{ x: 280, width: 28 } // D7
		];
		const plan = planStackedEndingRigidGlyphs(xform, label, chords, 40);

		expect(plan.chordExtraDx).toBeGreaterThan(0);
		expect(plan.labelScreen).not.toBeNull();
		const gap = plan.chordScreens[0].left - plan.labelScreen!.right;
		expect(gap).toBeGreaterThanOrEqual(ENDING_LABEL_CHORD_MIN_GAP - 0.01);

		// Uniform nudge preserves inter-chord spacing.
		const raw0 = rigidGlyphScreenSpanAfterTranslate(
			xform.sx,
			xform.tx,
			chords[0].x,
			chords[0].width
		);
		const raw1 = rigidGlyphScreenSpanAfterTranslate(
			xform.sx,
			xform.tx,
			chords[1].x,
			chords[1].width
		);
		expect(plan.chordScreens[1].left - plan.chordScreens[0].left).toBeCloseTo(
			raw1.left - raw0.left,
			5
		);
	});

	it('does not nudge when the first chord is already clear of the label', () => {
		const plan = planStackedEndingRigidGlyphs(
			xform,
			{ x: 45, width: 12 },
			[
				{ x: 200, width: 36 },
				{ x: 350, width: 28 }
			]
		);
		expect(plan.chordExtraDx).toBe(0);
	});
});

describe('endingLabelHookNudge', () => {
	it('returns 0 when the digit already clears the hook', () => {
		expect(endingLabelHookNudge(100, 110, 5)).toBe(0);
	});

	it('returns the deficit when the digit sits on the hook', () => {
		// Hook at 100; digit left at 98; need 100+5-98 = 7
		expect(endingLabelHookNudge(100, 98, 5)).toBe(7);
	});
});

describe('endingChordVerticalMatchDy', () => {
	it('drops [2] when it sits higher above the staff than [1]', () => {
		// [1] gap 20, [2] gap 32 → need +12 to drop [2]
		expect(endingChordVerticalMatchDy(20, 32)).toBe(12);
	});

	it('does not raise [2] when it is already lower than [1]', () => {
		expect(endingChordVerticalMatchDy(30, 20)).toBe(0);
	});

	it('ignores sub-pixel noise', () => {
		expect(endingChordVerticalMatchDy(20, 20.3)).toBe(0);
	});
});

describe('meanFinite', () => {
	it('averages finite values and skips non-finite', () => {
		expect(meanFinite([10, 20, Number.NaN])).toBe(15);
		expect(meanFinite([])).toBeNull();
	});
});

describe('endingChordGroupNudge', () => {
	it('returns 0 when chords already clear the label', () => {
		expect(
			endingChordGroupNudge({ left: 10, right: 20 }, [{ left: 30, right: 50 }], 6)
		).toBe(0);
	});

	it('returns the max deficit so the leftmost chord clears minGap', () => {
		expect(
			endingChordGroupNudge(
				{ left: 10, right: 20 },
				[
					{ left: 18, right: 50 },
					{ left: 80, right: 100 }
				],
				6
			)
		).toBe(8);
	});
});

describe('placeEndingSection / advanceEndingLayout state machine', () => {
	it('records endingOneColumn when [1] is inline', () => {
		let state = initialEndingLayoutState();
		let p = placeEndingSection({ bars: 2 }, null, state, 4);
		state = advanceEndingLayout({ bars: 2 }, p, state, 4);
		expect(state.prevEndColumn).toBe(2);

		p = placeEndingSection({ bars: 1, ending: 1 }, { bars: 2 }, state, 4);
		expect(p.startsNewLine).toBe(false);
		expect(p.startColumn).toBe(2);
		state = advanceEndingLayout({ bars: 1, ending: 1 }, p, state, 4);
		expect(state.endingOneColumn).toBe(2);

		p = placeEndingSection({ bars: 1, ending: 2 }, { bars: 1, ending: 1 }, state, 4);
		expect(p.alignUnderFirstEnding).toBe(true);
		expect(p.alignToColumn).toBe(2);
	});
});
