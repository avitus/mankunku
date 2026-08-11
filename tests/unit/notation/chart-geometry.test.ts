import { describe, it, expect } from 'vitest';
import type { Tune } from '$lib/types/tune';
import type { NoteAnchor } from '$lib/music/notation';
import { seg, section, sheet, simpleSheet } from '../../helpers/tune-fixtures';
import { tuneToAbcWithMap, type BarAnchor, type ChordSlotAnchor } from '$lib/music/tune-notation';
import {
	matchLayoutItem,
	barZones,
	beatEdges,
	chordZones,
	nextBeatPos,
	prevBeatPos,
	type LayoutItem,
	type SystemLayout,
	type BarZone
} from '$lib/notation/chart-geometry';

function item(startChar: number, endChar: number, x: number, w: number, type: 'note' | 'bar' = 'note'): LayoutItem {
	return { startChar, endChar, x, w, type };
}

describe('matchLayoutItem — anchor ↔ layout by charspan', () => {
	const items: LayoutItem[] = [
		item(10, 12, 100, 8),
		item(12, 15, 120, 10),
		item(15, 16, 150, 2, 'bar')
	];

	it('returns the item whose start exactly equals the anchor char', () => {
		expect(matchLayoutItem(items, 12)).toBe(items[1]);
	});

	it('returns the item whose [startChar, endChar) contains the anchor char', () => {
		expect(matchLayoutItem(items, 13)).toBe(items[1]);
	});

	it('returns null when no item contains the anchor char', () => {
		expect(matchLayoutItem(items, 40)).toBeNull();
	});
});

/**
 * Synthetic 2-system chart: 4 bars each, one note + closing barline per bar.
 * System 1's x values restart near the left edge (a fresh line).
 */
function twoSystemLayout(): { systems: SystemLayout[]; barAnchors: BarAnchor[] } {
	const systems: SystemLayout[] = [];
	const barAnchors: BarAnchor[] = [];
	// x layout per system: note 10, bar 40, note 50, bar 80, note 90, bar 120, note 130, bar 160.
	const noteXs = [10, 50, 90, 130];
	const barXs = [40, 80, 120, 160];
	for (let sys = 0; sys < 2; sys++) {
		const items: LayoutItem[] = [];
		const base = sys * 16;
		for (let b = 0; b < 4; b++) {
			const noteStart = base + b * 4;
			items.push(item(noteStart, noteStart + 2, noteXs[b], 8, 'note'));
			items.push(item(noteStart + 2, noteStart + 4, barXs[b], 2, 'bar'));
			barAnchors.push({ startChar: noteStart, endChar: noteStart + 4, sectionIdx: sys, bar: b });
		}
		systems.push({ items });
	}
	return { systems, barAnchors };
}

describe('barZones — bar x-spans per system', () => {
	it('bounds each interior bar by its flanking barlines (adjacent zones share the barline x)', () => {
		const { systems, barAnchors } = twoSystemLayout();
		const zones = barZones(systems, barAnchors);
		expect(zones).toHaveLength(8);
		const bar1 = zones.find((z) => z.systemIdx === 0 && z.bar === 1)!;
		expect(bar1).toMatchObject({ x0: 40, x1: 80 });
		const bar2 = zones.find((z) => z.systemIdx === 0 && z.bar === 2)!;
		expect(bar2).toMatchObject({ x0: 80, x1: 120 });
	});

	it('uses the system left edge for a bar that opens the system', () => {
		const { systems, barAnchors } = twoSystemLayout();
		const zones = barZones(systems, barAnchors);
		const bar0 = zones.find((z) => z.systemIdx === 0 && z.bar === 0)!;
		expect(bar0).toMatchObject({ x0: 10, x1: 40 });
		// Bar 0 of system 1 also opens its system: left edge, not the prior line's barline.
		const sys1bar0 = zones.find((z) => z.systemIdx === 1 && z.bar === 0)!;
		expect(sys1bar0).toMatchObject({ x0: 10, x1: 40 });
	});

	it('assigns each bar to the system that rendered it', () => {
		const { systems, barAnchors } = twoSystemLayout();
		const zones = barZones(systems, barAnchors);
		expect(zones.filter((z) => z.systemIdx === 0)).toHaveLength(4);
		expect(zones.filter((z) => z.systemIdx === 1)).toHaveLength(4);
	});
});

const ZONE: BarZone = { sectionIdx: 0, bar: 0, systemIdx: 0, x0: 0, x1: 100 };

function nonDecreasing(xs: number[]): boolean {
	return xs.every((x, i) => i === 0 || x >= xs[i - 1]);
}

describe('beatEdges — piecewise-linear beat interpolation', () => {
	it('divides the bar evenly when there are no interior samples', () => {
		expect(beatEdges(ZONE, [], 4)).toEqual([0, 25, 50, 75, 100]);
	});

	it('interpolates between the bar edges through a single sample', () => {
		const edges = beatEdges(ZONE, [{ beat: 2, x: 30 }], 4);
		expect(edges).toEqual([0, 15, 30, 65, 100]);
	});

	it('passes through front-loaded samples and stays monotonic', () => {
		const samples = [
			{ beat: 0.5, x: 10 },
			{ beat: 1, x: 20 },
			{ beat: 1.5, x: 28 },
			{ beat: 2, x: 35 }
		];
		const edges = beatEdges(ZONE, samples, 4);
		expect(edges).toHaveLength(5);
		expect(nonDecreasing(edges)).toBe(true);
		// Edges land exactly on samples that sit on integer beats.
		expect(edges[1]).toBe(20);
		expect(edges[2]).toBe(35);
		// Forced bar endpoints.
		expect(edges[0]).toBe(0);
		expect(edges[4]).toBe(100);
	});

	it('clamps samples to the bar span so edges never escape it', () => {
		const edges = beatEdges(ZONE, [{ beat: 2, x: 500 }], 4);
		expect(nonDecreasing(edges)).toBe(true);
		expect(Math.max(...edges)).toBeLessThanOrEqual(100);
		expect(Math.min(...edges)).toBeGreaterThanOrEqual(0);
	});

	it('honours a 3-beat bar (length beatsPerBar + 1)', () => {
		const edges = beatEdges(ZONE, [], 3);
		expect(edges).toHaveLength(4);
		[0, 100 / 3, 200 / 3, 100].forEach((expected, i) => expect(edges[i]).toBeCloseTo(expected, 9));
	});
});

describe('chordZones — one cell per (system × bar × beat)', () => {
	it('emits beatsPerBar cells per bar with the right identities and tiled x-ranges', () => {
		const { systems, barAnchors } = twoSystemLayout();
		const zones = chordZones({
			systems,
			barAnchors,
			noteAnchors: [],
			chordSlotAnchors: [],
			beatsPerBar: 4,
			barDurationWholeNotes: 1
		});
		expect(zones).toHaveLength(32); // 8 bars × 4 beats
		const bar0 = zones.filter((z) => z.systemIdx === 0 && z.sectionIdx === 0 && z.bar === 0);
		expect(bar0.map((z) => z.beat)).toEqual([0, 1, 2, 3]);
		// Even division tiles the bar span [10, 40] contiguously.
		expect(bar0[0].x0).toBe(10);
		expect(bar0[3].x1).toBe(40);
		for (let b = 1; b < 4; b++) expect(bar0[b].x0).toBeCloseTo(bar0[b - 1].x1, 9);
	});

	it('drives beat boundaries from chord-slot samples matched by charspan', () => {
		const systems: SystemLayout[] = [
			{
				items: [
					item(0, 2, 10, 6, 'note'),
					item(2, 4, 30, 6, 'note'),
					item(4, 6, 100, 2, 'bar')
				]
			}
		];
		const barAnchors: BarAnchor[] = [{ startChar: 0, endChar: 6, sectionIdx: 0, bar: 0 }];
		const chordSlotAnchors: ChordSlotAnchor[] = [
			{ startChar: 0, endChar: 2, sectionIdx: 0, bar: 0, beat: 0, chord: 'C' },
			{ startChar: 2, endChar: 4, sectionIdx: 0, bar: 0, beat: 2, chord: 'G' }
		];
		const zones = chordZones({
			systems,
			barAnchors,
			noteAnchors: [],
			chordSlotAnchors,
			beatsPerBar: 4,
			barDurationWholeNotes: 1
		});
		const beat2 = zones.find((z) => z.beat === 2)!;
		// The beat-2 boundary snaps to the matched chord x (30), not even quarters.
		expect(beat2.x0).toBe(30);
	});

	it('derives beat positions from note-anchor whole-note offsets', () => {
		const systems: SystemLayout[] = [
			{
				items: [
					item(0, 2, 10, 6, 'note'),
					item(2, 4, 30, 6, 'note'),
					item(4, 6, 100, 2, 'bar')
				]
			}
		];
		const barAnchors: BarAnchor[] = [{ startChar: 0, endChar: 6, sectionIdx: 0, bar: 0 }];
		// offset 0.5 whole-notes in 4/4 → beat 2.
		const noteAnchors: NoteAnchor[] = [
			{ startChar: 0, endChar: 2, sourceIndex: 0, offset: 0 },
			{ startChar: 2, endChar: 4, sourceIndex: 1, offset: 0.5 }
		];
		const zones = chordZones({
			systems,
			barAnchors,
			noteAnchors,
			chordSlotAnchors: [],
			beatsPerBar: 4,
			barDurationWholeNotes: 1
		});
		expect(zones.find((z) => z.beat === 2)!.x0).toBe(30);
	});

	it('emits 3 cells per bar for a 3/4 form', () => {
		const systems: SystemLayout[] = [
			{ items: [item(0, 2, 10, 6, 'note'), item(2, 4, 100, 2, 'bar')] }
		];
		const barAnchors: BarAnchor[] = [{ startChar: 0, endChar: 4, sectionIdx: 0, bar: 0 }];
		const zones = chordZones({
			systems,
			barAnchors,
			noteAnchors: [],
			chordSlotAnchors: [],
			beatsPerBar: 3,
			barDurationWholeNotes: 0.75
		});
		expect(zones).toHaveLength(3);
		expect(zones.map((z) => z.beat)).toEqual([0, 1, 2]);
	});
});

describe('nextBeatPos / prevBeatPos — beat advance across the form', () => {
	// Section 0 has 2 bars, section 1 has 1 bar; 4 beats per bar.
	const form = { sections: [{ bars: 2 }, { bars: 1 }], beatsPerBar: 4 };

	it('advances within a bar', () => {
		expect(nextBeatPos({ sectionIdx: 0, bar: 0, beat: 0 }, form)).toEqual({
			sectionIdx: 0,
			bar: 0,
			beat: 1
		});
	});

	it('wraps to the next bar past the last beat', () => {
		expect(nextBeatPos({ sectionIdx: 0, bar: 0, beat: 3 }, form)).toEqual({
			sectionIdx: 0,
			bar: 1,
			beat: 0
		});
	});

	it('wraps to the next section past the last bar', () => {
		expect(nextBeatPos({ sectionIdx: 0, bar: 1, beat: 3 }, form)).toEqual({
			sectionIdx: 1,
			bar: 0,
			beat: 0
		});
	});

	it('returns null past the final beat of the final bar', () => {
		expect(nextBeatPos({ sectionIdx: 1, bar: 0, beat: 3 }, form)).toBeNull();
	});

	it('steps back within a bar', () => {
		expect(prevBeatPos({ sectionIdx: 0, bar: 0, beat: 1 }, form)).toEqual({
			sectionIdx: 0,
			bar: 0,
			beat: 0
		});
	});

	it('wraps back to the previous bar before beat 0', () => {
		expect(prevBeatPos({ sectionIdx: 0, bar: 1, beat: 0 }, form)).toEqual({
			sectionIdx: 0,
			bar: 0,
			beat: 3
		});
	});

	it('wraps back to the previous section before bar 0', () => {
		expect(prevBeatPos({ sectionIdx: 1, bar: 0, beat: 0 }, form)).toEqual({
			sectionIdx: 0,
			bar: 1,
			beat: 3
		});
	});

	it('returns null before beat 0 of bar 0 of section 0', () => {
		expect(prevBeatPos({ sectionIdx: 0, bar: 0, beat: 0 }, form)).toBeNull();
	});

	it('handles a 3-beat form of 1-bar sections', () => {
		const f = { sections: [{ bars: 1 }], beatsPerBar: 3 };
		expect(nextBeatPos({ sectionIdx: 0, bar: 0, beat: 1 }, f)).toEqual({
			sectionIdx: 0,
			bar: 0,
			beat: 2
		});
		expect(nextBeatPos({ sectionIdx: 0, bar: 0, beat: 2 }, f)).toBeNull();
		expect(prevBeatPos({ sectionIdx: 0, bar: 0, beat: 0 }, f)).toBeNull();
	});
});

// ── Shared fixture helpers (tests/helpers/tune-fixtures.ts) ───────────────────

describe('integration — real tuneToAbcWithMap anchors → zones', () => {
	// Fabricate layout items from the anchors, x monotonic in char order (no
	// rendering). This proves the anchor plumbing fits the geometry contract.
	function layoutFromAnchors(t: Tune): { systems: SystemLayout[]; result: ReturnType<typeof tuneToAbcWithMap> } {
		const result = tuneToAbcWithMap(t);
		const items: LayoutItem[] = [];
		for (const na of result.noteAnchors) {
			items.push(item(na.startChar, na.endChar, na.startChar, na.endChar - na.startChar, 'note'));
		}
		for (const cs of result.chordSlotAnchors) {
			items.push(item(cs.startChar, cs.endChar, cs.startChar, cs.endChar - cs.startChar, 'note'));
		}
		for (const ba of result.barAnchors) {
			items.push(item(ba.endChar - 1, ba.endChar, ba.endChar, 1, 'bar'));
		}
		return { systems: [{ items }], result };
	}

	it('produces one bar zone per bar with correct identities', () => {
		const { systems, result } = layoutFromAnchors(simpleSheet());
		const zones = barZones(systems, result.barAnchors);
		expect(zones).toHaveLength(2);
		expect(zones.map((z) => ({ sectionIdx: z.sectionIdx, bar: z.bar }))).toEqual([
			{ sectionIdx: 0, bar: 0 },
			{ sectionIdx: 0, bar: 1 }
		]);
		// Bars are contiguous: bar 1's left edge is bar 0's closing barline.
		expect(zones[1].x0).toBe(zones[0].x1);
		for (const z of zones) expect(z.x0).toBeLessThan(z.x1);
	});

	it('produces one chord zone per bar × beat with correct identities and tiled x', () => {
		const { systems, result } = layoutFromAnchors(simpleSheet());
		const zones = chordZones({
			systems,
			barAnchors: result.barAnchors,
			noteAnchors: result.noteAnchors,
			chordSlotAnchors: result.chordSlotAnchors,
			beatsPerBar: 4,
			barDurationWholeNotes: 1
		});
		expect(zones).toHaveLength(8); // 2 bars × 4 beats
		expect(zones.filter((z) => z.bar === 0).map((z) => z.beat)).toEqual([0, 1, 2, 3]);
		expect(zones.filter((z) => z.bar === 1).map((z) => z.beat)).toEqual([0, 1, 2, 3]);
		expect(zones.every((z) => z.sectionIdx === 0 && z.systemIdx === 0)).toBe(true);
		// Each bar's beat cells tile its span left→right without gaps or overlaps.
		for (const bar of [0, 1]) {
			const cells = zones.filter((z) => z.bar === bar);
			for (let b = 1; b < cells.length; b++) expect(cells[b].x0).toBeCloseTo(cells[b - 1].x1, 9);
			expect(cells.every((c) => c.x0 <= c.x1)).toBe(true);
		}
	});
});
