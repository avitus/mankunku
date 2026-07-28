import { describe, it, expect } from 'vitest';
import type { LayoutItem } from '$lib/notation/chart-geometry';
import type { BarAnchor, ChordSlotAnchor } from '$lib/music/tune-notation';
import type { PitchedNoteAnchor } from '$lib/music/notation';
import {
	systemsFromVisualObj,
	toSystemLayouts,
	findVoiceItem,
	overlayBoxPct,
	formShape,
	nextBarStart,
	prevBarStart,
	resolveChartClick,
	chordKeyAction,
	bandGeometry,
	barHitRect,
	chordHitRect,
	glissandoWave,
	type AdapterVisualObj,
	type AdapterVoiceItem
} from '$lib/notation/abcjs-adapter';

/** A rendered abcjs-shaped voice item (post-render: abselem carries x/w). */
function vi(
	el_type: string,
	startChar: number,
	endChar: number,
	x?: number,
	w?: number
): AdapterVoiceItem {
	const item: AdapterVoiceItem = { el_type, startChar, endChar };
	if (x !== undefined && w !== undefined) item.abselem = { x, w };
	return item;
}

/** Wrap per-system voice arrays into the lines/staff/voices nesting abcjs uses. */
function visualObj(...systems: AdapterVoiceItem[][][]): AdapterVisualObj {
	return {
		lines: systems.map((voices) => ({ staff: [{ voices }] }))
	};
}

describe('systemsFromVisualObj — abcjs lines → per-system layout items', () => {
	it('maps voice 0 to melody and voice 1 to harmony with x/w from abselem', () => {
		const obj = visualObj([
			[vi('note', 10, 12, 100, 8), vi('bar', 12, 13, 140, 2)],
			[vi('note', 20, 25, 100, 8)]
		]);
		const systems = systemsFromVisualObj(obj);
		expect(systems).toHaveLength(1);
		expect(systems[0].melody).toEqual<LayoutItem[]>([
			{ startChar: 10, endChar: 12, x: 100, w: 8, type: 'note' },
			{ startChar: 12, endChar: 13, x: 140, w: 2, type: 'bar' }
		]);
		expect(systems[0].harmony).toEqual<LayoutItem[]>([
			{ startChar: 20, endChar: 25, x: 100, w: 8, type: 'note' }
		]);
	});

	it('emits one system per music line, skipping non-music lines (no staff)', () => {
		const obj: AdapterVisualObj = {
			lines: [
				{ staff: [{ voices: [[vi('note', 0, 2, 10, 6)]] }] },
				{ subtitle: { startChar: 0, endChar: 0, text: 'x' } } as never,
				{ staff: [{ voices: [[vi('note', 4, 6, 10, 6)]] }] }
			]
		};
		const systems = systemsFromVisualObj(obj);
		expect(systems).toHaveLength(2);
		expect(systems[0].melody[0].startChar).toBe(0);
		expect(systems[1].melody[0].startChar).toBe(4);
	});

	it('skips items without abselem (unrendered) and non-note/bar el_types', () => {
		const obj = visualObj([
			[
				vi('clef', 0, 0, 5, 10),
				vi('key-signature', 0, 0, 15, 10),
				vi('note', 10, 12), // no abselem — never drawn
				vi('note', 12, 14, 100, 8),
				vi('part', 8, 9, 50, 12),
				vi('bar', 14, 15, 140, 2)
			]
		]);
		const [system] = systemsFromVisualObj(obj);
		expect(system.melody).toEqual([
			{ startChar: 12, endChar: 14, x: 100, w: 8, type: 'note' },
			{ startChar: 14, endChar: 15, x: 140, w: 2, type: 'bar' }
		]);
	});

	it('skips items missing numeric charspans or abselem coordinates', () => {
		const obj = visualObj([
			[
				{ el_type: 'note', abselem: { x: 10, w: 5 } }, // no charspan
				{ el_type: 'note', startChar: 3, endChar: 5, abselem: { w: 5 } }, // no x
				vi('note', 5, 7, 20, 6)
			]
		]);
		const [system] = systemsFromVisualObj(obj);
		expect(system.melody).toEqual([{ startChar: 5, endChar: 7, x: 20, w: 6, type: 'note' }]);
	});

	it('yields an empty harmony array when the staff has a single voice', () => {
		const obj = visualObj([[vi('note', 0, 2, 10, 6)]]);
		const [system] = systemsFromVisualObj(obj);
		expect(system.harmony).toEqual([]);
	});

	it('handles a missing/empty lines array', () => {
		expect(systemsFromVisualObj({})).toEqual([]);
		expect(systemsFromVisualObj({ lines: [] })).toEqual([]);
	});
});

describe('toSystemLayouts — chart-geometry input shape', () => {
	it('merges melody and harmony items into one items array per system', () => {
		const obj = visualObj([
			[vi('note', 0, 2, 10, 6), vi('bar', 2, 3, 40, 2)],
			[vi('note', 10, 14, 12, 6)]
		]);
		const layouts = toSystemLayouts(systemsFromVisualObj(obj));
		expect(layouts).toHaveLength(1);
		expect(layouts[0].items.map((it) => it.startChar)).toEqual([0, 2, 10]);
	});
});

describe('findVoiceItem — charspan → melody voice item across systems', () => {
	const obj = visualObj(
		[
			[vi('note', 10, 12, 100, 8), vi('bar', 12, 13, 140, 2), vi('note', 13, 16, 150, 8)],
			[vi('note', 30, 34, 100, 8)]
		],
		[[vi('note', 40, 44, 10, 8)]]
	);

	it('finds by exact startChar in the first system', () => {
		const item = findVoiceItem(obj, 13);
		expect(item?.startChar).toBe(13);
		expect(item?.el_type).toBe('note');
	});

	it('finds by exact startChar in a later system', () => {
		expect(findVoiceItem(obj, 40)?.startChar).toBe(40);
	});

	it('falls back to charspan containment', () => {
		expect(findVoiceItem(obj, 11)?.startChar).toBe(10);
	});

	it('searches only the melody voice (voice 0), never harmony', () => {
		// 30 lives in system 0's HARMONY voice only.
		expect(findVoiceItem(obj, 30)).toBeNull();
	});

	it('ignores bar items (a barline charspan resolves to null)', () => {
		expect(findVoiceItem(obj, 12)).toBeNull();
	});

	it('returns null when nothing matches', () => {
		expect(findVoiceItem(obj, 999)).toBeNull();
	});
});

describe('overlayBoxPct — chord-input positioning as viewBox percentages', () => {
	const viewBox = { width: 800, height: 200 };

	it('maps a zone and y band straight to percentages', () => {
		const box = overlayBoxPct({ x0: 200, x1: 400 }, viewBox, 50);
		expect(box).toEqual({ leftPct: 25, topPct: 25, widthPct: 25 });
	});

	it('widens a too-narrow zone to the minimum width, keeping the left edge', () => {
		const box = overlayBoxPct({ x0: 200, x1: 210 }, viewBox, 0, { minWidth: 80 });
		expect(box.leftPct).toBe(25);
		expect(box.widthPct).toBe(10); // 80 / 800
	});

	it('shifts a widened zone left so it never overflows the right edge', () => {
		const box = overlayBoxPct({ x0: 780, x1: 790 }, viewBox, 0, { minWidth: 80 });
		expect(box.widthPct).toBe(10);
		expect(box.leftPct + box.widthPct).toBeLessThanOrEqual(100);
		expect(box.leftPct).toBe(90);
	});

	it('clamps the width to the viewBox and pins left at 0 when oversized', () => {
		const box = overlayBoxPct({ x0: 0, x1: 10 }, viewBox, 0, { minWidth: 2000 });
		expect(box.leftPct).toBe(0);
		expect(box.widthPct).toBe(100);
	});

	it('clamps a negative band top to 0', () => {
		expect(overlayBoxPct({ x0: 0, x1: 100 }, viewBox, -30).topPct).toBe(0);
	});

	it('returns a zero box for a degenerate viewBox', () => {
		expect(overlayBoxPct({ x0: 0, x1: 10 }, { width: 0, height: 0 }, 0)).toEqual({
			leftPct: 0,
			topPct: 0,
			widthPct: 0
		});
	});
});

describe('formShape — tune → beat-advance form', () => {
	it('derives section bars and beatsPerBar from the meter numerator', () => {
		const form = formShape({
			sections: [{ bars: 8 }, { bars: 4 }],
			timeSignature: [3, 4]
		});
		expect(form).toEqual({ sections: [{ bars: 8 }, { bars: 4 }], beatsPerBar: 3 });
	});
});

describe('nextBarStart / prevBarStart — Tab targets at bar granularity', () => {
	const form = { sections: [{ bars: 2 }, { bars: 1 }], beatsPerBar: 4 };

	it('advances to the next bar at beat 0 regardless of the current beat', () => {
		expect(nextBarStart({ sectionIdx: 0, bar: 0, beat: 2 }, form)).toEqual({
			sectionIdx: 0,
			bar: 1,
			beat: 0
		});
	});

	it('crosses into the next section past the last bar', () => {
		expect(nextBarStart({ sectionIdx: 0, bar: 1, beat: 3 }, form)).toEqual({
			sectionIdx: 1,
			bar: 0,
			beat: 0
		});
	});

	it('returns null past the final bar', () => {
		expect(nextBarStart({ sectionIdx: 1, bar: 0, beat: 0 }, form)).toBeNull();
	});

	it('steps back to the previous bar at beat 0', () => {
		expect(prevBarStart({ sectionIdx: 0, bar: 1, beat: 3 }, form)).toEqual({
			sectionIdx: 0,
			bar: 0,
			beat: 0
		});
	});

	it('crosses back into the previous section before bar 0', () => {
		expect(prevBarStart({ sectionIdx: 1, bar: 0, beat: 1 }, form)).toEqual({
			sectionIdx: 0,
			bar: 1,
			beat: 0
		});
	});

	it('returns null before the first bar', () => {
		expect(prevBarStart({ sectionIdx: 0, bar: 0, beat: 0 }, form)).toBeNull();
	});
});

describe('resolveChartClick — clicked charspan → note select or bar target', () => {
	const noteAnchors: PitchedNoteAnchor[] = [
		{ startChar: 100, endChar: 103, sourceIndex: 7 },
		{ startChar: 103, endChar: 106, sourceIndex: 8 }
	];
	const chordSlotAnchors: ChordSlotAnchor[] = [
		{ startChar: 200, endChar: 208, sectionIdx: 1, bar: 2, beat: 0, chord: 'F7' }
	];
	const barAnchors: BarAnchor[] = [
		{ startChar: 96, endChar: 110, sectionIdx: 0, bar: 3 },
		{ startChar: 110, endChar: 124, sectionIdx: 0, bar: 4 }
	];

	it('resolves a note anchor first, by exact start', () => {
		expect(resolveChartClick(103, noteAnchors, chordSlotAnchors, barAnchors)).toEqual({
			kind: 'note',
			sourceIndex: 8
		});
	});

	it('resolves a note anchor by charspan containment', () => {
		expect(resolveChartClick(101, noteAnchors, chordSlotAnchors, barAnchors)).toEqual({
			kind: 'note',
			sourceIndex: 7
		});
	});

	it('resolves a chord-voice charspan to its bar', () => {
		expect(resolveChartClick(204, noteAnchors, chordSlotAnchors, barAnchors)).toEqual({
			kind: 'bar',
			pos: { sectionIdx: 1, bar: 2 }
		});
	});

	it('resolves an unmatched melody charspan (a rest) to its bar anchor', () => {
		expect(resolveChartClick(108, noteAnchors, chordSlotAnchors, barAnchors)).toEqual({
			kind: 'bar',
			pos: { sectionIdx: 0, bar: 3 }
		});
	});

	it('prefers the chord slot when spans overlap a bar anchor', () => {
		const overlappingSlot: ChordSlotAnchor[] = [
			{ startChar: 96, endChar: 110, sectionIdx: 9, bar: 9, beat: 0, chord: null }
		];
		expect(resolveChartClick(108, noteAnchors, overlappingSlot, barAnchors)).toEqual({
			kind: 'bar',
			pos: { sectionIdx: 9, bar: 9 }
		});
	});

	it('returns null when nothing matches', () => {
		expect(resolveChartClick(500, noteAnchors, chordSlotAnchors, barAnchors)).toBeNull();
	});
});

describe('chordKeyAction — inline chord input key bindings', () => {
	// Section 0 has 2 bars, section 1 has 1 bar; 4 beats per bar.
	const form = { sections: [{ bars: 2 }, { bars: 1 }], beatsPerBar: 4 };
	const pos = { sectionIdx: 0, bar: 1, beat: 1 };

	it('Enter commits and closes without swallowing the default', () => {
		expect(chordKeyAction('Enter', false, pos, form)).toEqual({
			type: 'commit-close',
			preventDefault: false
		});
	});

	it('Escape closes without committing', () => {
		expect(chordKeyAction('Escape', false, pos, form)).toEqual({
			type: 'close',
			preventDefault: false
		});
	});

	it('Space commits and advances one beat, suppressing the typed space', () => {
		expect(chordKeyAction(' ', false, pos, form)).toEqual({
			type: 'commit-advance',
			target: { sectionIdx: 0, bar: 1, beat: 2 },
			preventDefault: true
		});
	});

	it('Shift+Space commits and steps back one beat', () => {
		expect(chordKeyAction(' ', true, pos, form)).toEqual({
			type: 'commit-advance',
			target: { sectionIdx: 0, bar: 1, beat: 0 },
			preventDefault: true
		});
	});

	it('Tab commits and jumps to the next bar at beat 0, suppressing focus travel', () => {
		expect(chordKeyAction('Tab', false, pos, form)).toEqual({
			type: 'commit-advance',
			target: { sectionIdx: 1, bar: 0, beat: 0 },
			preventDefault: true
		});
	});

	it('Shift+Tab commits and jumps to the previous bar at beat 0', () => {
		expect(chordKeyAction('Tab', true, pos, form)).toEqual({
			type: 'commit-advance',
			target: { sectionIdx: 0, bar: 0, beat: 0 },
			preventDefault: true
		});
	});

	it('advance past either end yields a null target (close after commit)', () => {
		expect(chordKeyAction(' ', false, { sectionIdx: 1, bar: 0, beat: 3 }, form)!).toMatchObject({
			target: null
		});
		expect(chordKeyAction('Tab', true, { sectionIdx: 0, bar: 0, beat: 0 }, form)!).toMatchObject({
			target: null
		});
	});

	it('ignores ordinary typing keys', () => {
		expect(chordKeyAction('a', false, pos, form)).toBeNull();
		expect(chordKeyAction('7', false, pos, form)).toBeNull();
	});
});

describe('band + hit-rect geometry', () => {
	it('derives spacing, staff edges, and a chord band top with 3 spacings of room', () => {
		// Staff at y=100, height 40 → spacing 10; wrapper starts at y=95 which is
		// LESS room than staffTop − 3·spacing = 70, so the band opens up to 70.
		expect(bandGeometry(95, 100, 40)).toEqual({
			top: 70,
			staffTop: 100,
			staffBottom: 140,
			spacing: 10
		});
	});

	it('uses the wrapper top when it already clears 3 spacings', () => {
		expect(bandGeometry(30, 100, 40).top).toBe(30);
	});

	it('bar hit rect spans the staff expanded by 2 spacings each way', () => {
		const band = bandGeometry(30, 100, 40);
		expect(barHitRect({ x0: 20, x1: 60 }, band)).toEqual({ x: 20, y: 80, w: 40, h: 80 });
	});

	it('chord hit rect covers band top down to the staff top', () => {
		const band = bandGeometry(30, 100, 40);
		expect(chordHitRect({ x0: 20, x1: 60 }, band)).toEqual({ x: 20, y: 30, w: 40, h: 70 });
	});
});

describe('glissandoWave — wavy connector path between notehead boxes', () => {
	const headA = { x: 0, y: 10, width: 10, height: 6 };
	const headB = { x: 100, y: 10, width: 10, height: 6 };

	it('returns null when the gap is too short to fit a wave', () => {
		expect(glissandoWave(headA, { ...headB, x: 12 }, 10)).toBeNull();
	});

	it('starts at the padded source edge and ends at the padded target edge', () => {
		const wave = glissandoWave(headA, headB, 10)!;
		expect(wave.d.startsWith('M 12.50 13.00')).toBe(true);
		expect(wave.d.endsWith('97.50 13.00')).toBe(true);
	});

	it('emits ~one half-wave per 0.8 spacings with alternating amplitude', () => {
		const wave = glissandoWave(headA, headB, 10)!;
		// len = 85 → waves = round(85 / 8) = 11 quadratic segments.
		expect(wave.d.split(' Q ')).toHaveLength(12);
		// Control points alternate ±2.2 around the connector (y = 13).
		expect(wave.d).toContain('15.20');
		expect(wave.d).toContain('10.80');
	});

	it('scales stroke width with staff spacing, with a 1px floor', () => {
		expect(glissandoWave(headA, headB, 10)!.strokeWidth).toBe('1.30');
		expect(glissandoWave(headA, headB, 1)!.strokeWidth).toBe('1.00');
	});
});
