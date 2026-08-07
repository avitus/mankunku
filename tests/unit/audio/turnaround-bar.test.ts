/**
 * The deep-practice turnaround bar: one bar of rhythm-section music (ii-V
 * into the next cycle's head key) generated as plain data. It cannot ride
 * the phrase-harmony backing parts — scheduleNextPhrase's deferred
 * disposeBackingParts() would destroy not-yet-fired Part events at exactly
 * the moment the turnaround should sound — so the session page schedules
 * these events itself and triggers instruments near-now.
 */

import { describe, it, expect } from 'vitest';
import {
	turnaroundHarmony,
	buildTurnaroundBarEvents,
	type TurnaroundEvent
} from '$lib/audio/turnaround-bar';
import { fractionToFloat } from '$lib/music/intervals';

const PPQ = 480;

function build(overrides: Partial<Parameters<typeof buildTurnaroundBarEvents>[0]> = {}) {
	return buildTurnaroundBarEvents({
		progressionType: 'ii-V-I-major',
		targetKey: 'F',
		backingStyle: 'swing',
		tempo: 120,
		swing: 0.62,
		ppq: PPQ,
		beatsPerBar: 4,
		...overrides
	});
}

describe('turnaroundHarmony', () => {
	it('builds a half-bar ii then half-bar V into a major target', () => {
		const segs = turnaroundHarmony('ii-V-I-major', 'C', 4);
		expect(segs).toHaveLength(2);
		expect(segs[0].chord).toMatchObject({ root: 'D', quality: 'min7' });
		expect(segs[1].chord).toMatchObject({ root: 'G', quality: '7' });
		expect(fractionToFloat(segs[0].startOffset)).toBe(0);
		expect(fractionToFloat(segs[0].duration)).toBeCloseTo(0.5, 10); // half a 4/4 bar
		expect(fractionToFloat(segs[1].startOffset)).toBeCloseTo(0.5, 10);
		expect(fractionToFloat(segs[1].duration)).toBeCloseTo(0.5, 10);
	});

	it('uses the minor cadence (half-diminished ii, altered V) for a minor target', () => {
		const segs = turnaroundHarmony('ii-V-I-minor', 'A', 4);
		expect(segs[0].chord).toMatchObject({ root: 'B', quality: 'min7b5' });
		expect(segs[1].chord).toMatchObject({ root: 'E', quality: '7alt' });
	});

	it('spans exactly one bar in any meter', () => {
		const segs = turnaroundHarmony('ii-V-I-major', 'C', 3);
		const end =
			fractionToFloat(segs[1].startOffset) + fractionToFloat(segs[1].duration);
		expect(end).toBeCloseTo(3 / 4, 10); // 3 beats in whole-note units
	});
});

describe('buildTurnaroundBarEvents', () => {
	it('keeps every event inside the single turnaround bar', () => {
		const events = build();
		const barTicks = 4 * PPQ;
		expect(events.length).toBeGreaterThan(0);
		for (const ev of events) {
			expect(ev.tickOffset).toBeGreaterThanOrEqual(0);
			expect(ev.tickOffset).toBeLessThan(barTicks);
		}
	});

	it('produces all three rhythm-section roles', () => {
		const events = build();
		const kinds = new Set(events.map((ev) => ev.hit.kind));
		expect(kinds).toContain('bass');
		expect(kinds).toContain('comp');
		expect(kinds).toContain('drum');
	});

	it('keeps the band walking: at least a beat-wise pulse from bass and drums', () => {
		const events = build();
		const bass = events.filter((ev) => ev.hit.kind === 'bass');
		const drums = events.filter((ev) => ev.hit.kind === 'drum');
		expect(bass.length).toBeGreaterThanOrEqual(2);
		expect(drums.length).toBeGreaterThanOrEqual(4);
	});

	it('is deterministic for identical inputs', () => {
		expect(build()).toEqual(build());
	});

	it('varies with the target key (different seed, different figures allowed)', () => {
		// Not asserting inequality of figures (they could coincide) — but the
		// harmony must transpose: bass notes for G-target differ from F-target.
		const f = build({ targetKey: 'F' });
		const g = build({ targetKey: 'G' });
		const bassMidis = (evs: TurnaroundEvent[]) =>
			evs.filter((ev) => ev.hit.kind === 'bass').map((ev) => (ev.hit as { midi: number }).midi);
		expect(bassMidis(f)).not.toEqual(bassMidis(g));
	});

	it('respects the meter', () => {
		const events = build({ beatsPerBar: 3 });
		const barTicks = 3 * PPQ;
		for (const ev of events) {
			expect(ev.tickOffset).toBeLessThan(barTicks);
		}
	});
});
