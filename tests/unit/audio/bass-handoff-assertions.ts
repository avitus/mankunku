import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import type { BassEvent } from '$lib/audio/backing-generation';
import type { RollingBackingBar } from '$lib/audio/backing-rolling';
import type { HarmonicSegment } from '$lib/types/music';
import { chordToneIntervalsForBass } from '$lib/audio/backing-bass';
import { pitchClassToNumber } from '$lib/audio/voicings';
import { getScale } from '$lib/music/scales';
import { realizeScale } from '$lib/music/keys';
import { fractionToFloat } from '$lib/music/intervals';
import baseline from '../../fixtures/audio/bass-handoff-compatibility.json';

/** Verify exact admitted handoffs before restoring only their MIDI for older hashes. */
export function assertBassHandoffDelta(events: readonly BassEvent[], windows: readonly RollingBackingBar[],
	harmony: readonly HarmonicSegment[], caseId: string): BassEvent[] {
	const retained = baseline.cases.find(entry => entry.id === caseId);
	expect(retained, `missing retained bass case ${caseId}`).toBeDefined();
	const restored = events.map(event => ({ ...event }));
	for (const change of retained!.changes) {
		const window = windows.find(entry => entry.fromBar === change.barIndex)!;
		expect(window).toBeDefined();
		const start = change.barIndex * 4;
		const actual = events.filter(event => event.absBeat >= start && event.absBeat < start + 4);
		expect(actual).toEqual(change.after);
		expect(window.bassEvents).toEqual(actual);
		const withoutPitch = (notes: readonly BassEvent[]) => notes.map(({ midi: _midi, ...event }) => event);
		expect(withoutPitch(actual)).toEqual(withoutPitch(change.before));
		const before = change.before.filter(event => Number.isInteger(event.absBeat));
		const pulse = actual.filter(event => Number.isInteger(event.absBeat));
		expect(before.map(event => event.absBeat)).toEqual([start, start + 1, start + 2, start + 3]);
		expect(pulse.map(event => event.absBeat)).toEqual(before.map(event => event.absBeat));
		expect(Math.abs(before[2].midi - before[3].midi)).toBeGreaterThan(5);
		expect([pulse[0].midi, pulse[3].midi]).toEqual([before[0].midi, before[3].midi]);
		for (let index = 1; index < pulse.length; index++) expect(Math.abs(pulse[index].midi - pulse[index - 1].midi)).toBeLessThanOrEqual(5);
		const memory = window.checkpoint.bass;
		const segment = harmony[memory.segmentIndex!];
		expect(segment).toEqual(change.harmony);
		expect(fractionToFloat(segment.startOffset) * 4).toBe(start);
		expect(fractionToFloat(segment.duration) * 4).toBe(4);
		const scale = getScale(segment.scaleId)!;
		expect(scale).toBeDefined();
		expect(realizeScale(segment.chord.root, scale.intervals)).toContain(pulse[1].midi % 12);
		const tones = chordToneIntervalsForBass(segment.chord.quality);
		const root = pitchClassToNumber(segment.chord.root);
		expect([0, tones.third, tones.fifth, ...(tones.seventh === null ? [] : [tones.seventh])].map(value => (root + value) % 12))
			.toContain(pulse[2].midi % 12);
		expect(['chromatic-above', 'chromatic-below']).toContain(change.approach);
		expect(memory).toMatchObject({ approach: change.approach, nextTarget: change.nextTarget,
			segmentAnchor: pulse[0].midi, previousMidi: pulse[3].midi, previousPreviousMidi: pulse[2].midi,
			direction: Math.sign(pulse[3].midi - pulse[2].midi), feel: 'four', pendingLaunch: null });
		const next = windows.find(entry => entry.fromBar === change.barIndex + 1)!;
		expect(next.bassEvents.find(event => event.absBeat === start + 4)!.midi).toBe(change.nextTarget);
		const plan = window.ensemblePlan.bars[0];
		expect(plan.performanceEnergy).toBeDefined();
		expect(plan.responseOwner).toBe('nobody');
		expect(plan.coordinatedAccent).toBeUndefined();
		expect(plan.setupFor).toBeUndefined();
		expect(window.ensembleDevelopment.bassTurnarounds.some(entry => entry.status === 'planned')).toBe(false);
		for (const [index, event] of actual.entries()) {
			expect(event.midi).toBeGreaterThanOrEqual(28);
			expect(event.midi).toBeLessThanOrEqual(55);
			const old = change.before[index];
			if (old.midi === event.midi) continue;
			const offset = event.absBeat - start;
			expect([1, 1.5, 2, 2.5]).toContain(offset);
			if (!Number.isInteger(offset)) expect(event.midi).toBe(pulse[Math.floor(offset)].midi);
			const position = restored.findIndex(candidate => candidate.absBeat === event.absBeat && candidate.time === event.time);
			expect(position).toBeGreaterThanOrEqual(0);
			restored[position] = { ...restored[position], midi: old.midi };
		}
	}
	// Extra/missing changes anywhere outside these exact cells still fail the
	// retained whole-performance checksum, before the caller's original hashes.
	expect(createHash('sha256').update(JSON.stringify(restored)).digest('hex')).toBe(retained!.beforeBassSha256);
	return restored;
}
