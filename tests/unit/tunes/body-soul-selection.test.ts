import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flattenTune } from '$lib/tunes/flatten';
import { detectProgressions, selectNonOverlapping } from '$lib/tunes/progression-detector';
import { buildSessionPlan } from '$lib/state/tune-practice-plan';
import type { Tune } from '$lib/types/tune';
import { clipBarSpanX } from '$lib/notation/chart-geometry';

/**
 * Body & Soul A-section turnaround (fixture bars 5–7, 0-based):
 *   bar 5: Cø7 F7  →  bar 6: Bbm7 | Ebm7 Ab7  →  bar 7: Db6 …
 * Detector finds both a minor ii-V-I into Bb ending mid-bar 6 and a major
 * ii-V-I into Db starting the same half-bar. They share no segments and must
 * BOTH be kept as abutted practice windows; chart bands clip so the shared
 * bar is split, not double-washed.
 */
const raw = JSON.parse(
	readFileSync(
		resolve('tests/fixtures/leadsheets/pdf-vs-musescore/body-and-soul.musescore-import.json'),
		'utf8'
	)
) as Tune;
const sheet: Tune = { ...raw, id: raw.id || 'body-and-soul', source: 'user' };

describe('Body & Soul — mid-bar abutted cadences', () => {
	it('keeps both chained cadences that meet mid-bar (segment-disjoint)', () => {
		const flat = flattenTune(sheet);
		const selected = selectNonOverlapping(detectProgressions(flat, sheet));
		const near = selected.filter((d) => d.startBar <= 7 && d.endBarExclusive > 5);
		expect(near.map((d) => [d.type, d.startBar, d.endBarExclusive, d.localKey])).toEqual([
			['ii-V-I-minor', 5, 7, 'Bb'],
			['ii-V-I-major', 6, 8, 'Db']
		]);
		const [a, b] = near;
		expect(a.segmentIndices.some((i) => b.segmentIndices.includes(i))).toBe(false);
	});

	it('session plan carries both windows with non-overlapping time spans', () => {
		// Notation-order flatten (no expand) — one A-section pass, two abutted windows.
		const flat = flattenTune(sheet);
		const plan = buildSessionPlan({
			flat,
			notationFlat: flat,
			timeSignature: sheet.timeSignature,
			ppq: 480,
			detect: (f) => selectNonOverlapping(detectProgressions(f, sheet)),
			match: () => ({ suggestions: [], uncategorized: [] })
		});
		// The mid-bar pair at the A turnaround (not the earlier ii-V-I into Db at b1).
		const minor = plan.find(
			(ip) =>
				ip.progressionType === 'ii-V-I-minor' &&
				ip.localKey === 'Bb' &&
				ip.notationBarRange.start === 5
		);
		const major = plan.find(
			(ip) =>
				ip.progressionType === 'ii-V-I-major' &&
				ip.localKey === 'Db' &&
				ip.notationBarRange.start === 6
		);
		expect(minor).toBeDefined();
		expect(major).toBeDefined();
		// Time spans abut mid-bar (6.5) — sequential windows, not simultaneous.
		expect(minor!.notationTimeRange.end).toBeCloseTo(6.5, 9);
		expect(major!.notationTimeRange.start).toBeCloseTo(6.5, 9);
		expect(minor!.notationTimeRange.end).toBeLessThanOrEqual(
			major!.notationTimeRange.start + 1e-9
		);
	});

	it('clipBarSpanX splits a contested bar between the two spans', () => {
		// bar 6 is whole-note [6, 7); minor ends at 6.5, major starts at 6.5
		const barX0 = 100;
		const barX1 = 200;
		const minor = clipBarSpanX(barX0, barX1, 6, 1, 5, 6.5);
		const major = clipBarSpanX(barX0, barX1, 6, 1, 6.5, 7.5);
		expect(minor).toEqual({ x0: 100, x1: 150 });
		expect(major).toEqual({ x0: 150, x1: 200 });
		// No overlap of the clipped spans
		expect(minor!.x1).toBeLessThanOrEqual(major!.x0 + 1e-9);
	});
});
