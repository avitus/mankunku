import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import type { CompEvent, DrumEvent, GeneratedBacking } from '$lib/audio/backing-generation';
import { resolveCoordinatedVoicing } from '$lib/audio/coordinated-voicing';
import baseline from '../../fixtures/audio/piano-phrase-recall-before.json';

type Performance = Pick<GeneratedBacking, 'bassEvents' | 'compEvents' | 'drumEvents'> & {
	ensembleDevelopment?: Pick<NonNullable<GeneratedBacking['ensembleDevelopment']>, 'pianoMotifs' | 'drumPhrases' | 'pianoVoicings'>;
};

/** Preserve the old full-tune hashes by reversing only these explicitly admitted changes. */
export function assertPianoPhraseRecallDelta(actual: Performance, style: 'swing' | 'straight', energy: number): Performance {
	const old = baseline.witnesses.find(entry => entry.style === style)!;
	const swing = style === 'swing';
	const admitted: CompEvent[] = [
		{ absBeat: 97.5, time: swing ? '18758i' : '18723i', notes: [55, 58, 60, 65], duration: .3, velocity: 71 },
		{ absBeat: 105, time: swing ? '20167i' : '20165i', notes: [53, 60], duration: .5243089553900062, velocity: 69 },
		{ absBeat: 109, time: swing ? '20935i' : '20932i', notes: [53, 60], duration: .20535852518298534, velocity: 62 }
	];
	const originalBeats = [99.5, 107, 111];
	const piano = actual.compEvents.map(event => ({ ...event, notes: [...event.notes] }));
	for (const [index, expected] of admitted.entries()) {
		const position = old.compEvents.findIndex(event => event.absBeat === originalBeats[index]);
		expect(actual.compEvents[position]).toEqual(expected);
		piano[position] = old.compEvents[position];
	}
	// This also preserves every pitch/attack outside the three specified changes.
	expect(piano).toEqual(old.compEvents);
	const trace = actual.ensembleDevelopment!.pianoMotifs!.find(entry => entry.barIndex === 24)!;
	expect(trace.recall).toMatchObject({ source: { barIndex: 20, phraseStartBar: 20, figureId: 'and2-only',
		attacks: old.bars[0].compEvents }, attacks: [admitted[0]] });
	for (const event of trace.recall!.source.attacks) expect(actual.compEvents).toContainEqual(event);
	const voicing = actual.ensembleDevelopment!.pianoVoicings!.find(entry => entry.absBeat === 97.5)!;
	const expectedVoicing = resolveCoordinatedVoicing({ chord: { root: 'Eb', quality: 'maj6' },
		previous: { version: 1, chord: { root: 'Bb', quality: '7' }, notes: old.bars[3].compEvents[0].notes },
		family: voicing.decision.requestedFamily, registerMidi: Math.round(58 + 8 * energy),
		rootlessTexture: voicing.decision.rootlessTexture?.request,
		...(voicing.decision.topLine ? { targetTopMidi: voicing.decision.topLine.targetMidi } : {}) });
	expect(voicing.notes).toEqual(expectedVoicing.notes);
	expect(voicing.decision).toEqual(expectedVoicing.decision);

	const drums: DrumEvent[] = actual.drumEvents.map(event => ({ ...event }));
	for (const [barIndex, oldBeat, newBeat, oldTick, newTick] of [
		[28, 115, 113, swing ? 22082 : 22081, 21698],
		[29, 119, 117, swing ? 22850 : 22849, swing ? 22466 : 22465]
	]) {
		const position = drums.findIndex(event => event.absBeat === newBeat && event.role === 'commentary');
		expect(position).toBeGreaterThanOrEqual(0);
		expect(drums[position]).toEqual({ absBeat: newBeat, time: `${newTick}i`, drum: 'snare', velocity: .115, role: 'commentary' });
		const commentary = actual.ensembleDevelopment!.drumPhrases.find(entry => entry.barIndex === barIndex)!.commentary;
		expect(commentary).toMatchObject({ source: 'piano', sourceBar: 27, sourceOffsets: [1], transform: barIndex === 28 ? 'answer' : 'repeat' });
		expect(actual.compEvents.filter(event => Math.floor(event.absBeat / 4) === 27).map(event => event.absBeat - 108)).toEqual(commentary.sourceOffsets);
		drums[position] = { ...drums[position], absBeat: oldBeat, time: `${oldTick}i` };
	}
	const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
	expect(hash(actual.bassEvents)).toBe(old.expected.bassEvents);
	expect(hash(actual.drumEvents.filter(event => event.role === 'timekeeping'))).toBe(old.expected.timekeeping);
	return { ...actual, compEvents: piano, drumEvents: drums };
}
