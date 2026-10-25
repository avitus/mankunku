import { describe, expect, it } from 'vitest';
import { generateBacking, type BassEvent } from '$lib/audio/backing-generation';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';

describe('a single scalar step through a real chord change', () => {
	it.each(['swing', 'straight'] as const)('%s continues the fixed Blues F# ascent before the unchanged approach', styleId => {
		const session = buildListeningTuneSession({ tuneId: 'ls-mankunku-blues', key: 'F#', soloChoruses: 2 });
		const style = BACKING_STYLES[styleId];
		const take = generateBacking(session.phrase.harmony, style, { phraseId: `${session.phrase.id}:reply:1`,
			tempo: 140, ppq: 192, beatsPerBar: 4, swing: style.defaultSwing, performanceForm: session.phrase.performanceForm,
			sectionMap: session.phrase.sectionMap, ensemble: {} });
		expect([91, 92, 93, 94, 95, 96].map(beat => take.bassEvents.find(event => event.absBeat === beat)!.midi))
			.toEqual([42, 43, 45, 42, 43, 44]);
	});

	it.each(['swing', 'straight'] as const)('%s continues the rolling Blues Eb ascent before the unchanged device', styleId => {
		const session = buildListeningTuneSession({ tuneId: 'ls-mankunku-blues', key: 'Eb', soloChoruses: 2 });
		const style = BACKING_STYLES[styleId];
		const definition = createRollingBacking(session.phrase.harmony, style, { phraseId: `${session.phrase.id}:reply:1`,
			tempo: 140, ppq: 192, beatsPerBar: 4, swing: style.defaultSwing, performanceForm: session.phrase.performanceForm,
			sectionMap: session.phrase.sectionMap, ensemble: {} });
		let checkpoint: RollingBackingCheckpoint | undefined;
		const events: BassEvent[] = [];
		for (let bar = 0; bar <= 24; bar++) {
			const next = advanceRollingBacking(definition, checkpoint);
			events.push(...next.bassEvents);
			checkpoint = next.checkpoint;
		}
		expect([91, 92, 93, 94, 95, 96].map(beat => events.find(event => event.absBeat === beat)!.midi))
			.toEqual([35, 36, 37, 39, 40, 41]);
	});
});

import { allowsBassScalarContinuation, selectBassScalarContinuation } from '$lib/audio/backing-bass-continuation';
import { seedFrom } from '$lib/audio/generation-rng';
import { realizeRollingBass } from '$lib/audio/backing-rolling-bass';

const selectedInput = { phraseId: 'musicality-ls-mankunku-blues-F#-2:reply:1', tempo: 140, boundaryAbsBeat: 92,
	previousMidi: 42, arrivalMidi: 43, ordinaryMidi: 42, candidates: [42, 44, 45], scalePcs: [0, 2, 4, 5, 7, 9, 11], deviceEntryMidi: 42 };

it('selects only in-scale stepwise continuations that preserve the approach handoff and register', () => {
	expect(selectBassScalarContinuation(selectedInput)).toBe(45);
	expect(selectBassScalarContinuation({ ...selectedInput, previousMidi: 39, arrivalMidi: 37, ordinaryMidi: 39,
		candidates: [35, 36, 39], scalePcs: [0, 1, 3, 5, 7, 9, 10], deviceEntryMidi: 40 })).toBe(36);
	for (const change of [
		{ previousMidi: 43 }, { previousMidi: 39 }, { candidates: [44], scalePcs: [0, 2, 4] },
		{ deviceEntryMidi: 51 }, { arrivalMidi: 55, previousMidi: 54, candidates: [56, 57] },
		{ arrivalMidi: 28, previousMidi: 30, candidates: [26, 27] }, { candidates: [] }
	]) expect(selectBassScalarContinuation({ ...selectedInput, ...change })).toBe(selectedInput.ordinaryMidi);
	// An already connected line needs no rewrite or misleading changed-cell trace.
	expect(selectBassScalarContinuation({ ...selectedInput, ordinaryMidi: 45 })).toBe(45);
	const diminished = { ...selectedInput, previousMidi: 35, arrivalMidi: 36, ordinaryMidi: 34,
		candidates: [37, 38], scalePcs: [0, 2, 3, 5, 6, 8, 9, 11], deviceEntryMidi: 39 };
	expect(selectBassScalarContinuation(diminished)).toBe(38);
});

it('leaves most unsupported or unselected opportunities alone and repeats its dedicated choice', () => {
	let selected = 0;
	for (let seed = 0; seed < 64; seed++) {
		const input = { ...selectedInput, phraseId: `scalar-choice:${seed}` };
		const midi = selectBassScalarContinuation(input);
		expect(selectBassScalarContinuation(input)).toBe(midi);
		if (midi !== input.ordinaryMidi) selected++;
	}
	expect(selected).toBeGreaterThan(8);
	expect(selected).toBeLessThan(56);
});

it('protects space, response ownership, formal reservations and restrained structural phases', () => {
	const session = buildListeningTuneSession({ tuneId: 'ls-mankunku-blues', key: 'Eb', soloChoruses: 2 });
	const score = createRollingBacking(session.phrase.harmony, BACKING_STYLES.swing, { phraseId: `${session.phrase.id}:reply:1`,
		tempo: 140, ppq: 192, beatsPerBar: 4, swing: 0.67, performanceForm: session.phrase.performanceForm, ensemble: {} });
	let checkpoint: RollingBackingCheckpoint | undefined;
	for (let bar = 0; bar < 23; bar++) checkpoint = advanceRollingBacking(score, checkpoint).checkpoint;
	const step = advanceRollingBacking(score, checkpoint);
	const plan = step.ensemblePlan.bars[0];
	expect(allowsBassScalarContinuation(plan)).toBe(true);
	const reservation = { id: 'arrival:24', targetBarIndex: 24, beatOffset: 0 as const, strength: 1, participants: ['bass', 'drums'] as const };
	for (const changed of [
		{ ...plan, performanceEnergy: undefined }, { ...plan, bass: { ...plan.bass, ornamentScale: 0.35 } },
		...(['head_in', 'head_return', 'solo_release', 'ending'] as const).map(phase => ({ ...plan, performanceEnergy: { ...plan.performanceEnergy!, phase } })),
		...(['leave_space', 'release'] as const).map(phraseIntent => ({ ...plan, phraseIntent })),
		...(['bass', 'piano', 'drums'] as const).map(responseOwner => ({ ...plan, responseOwner })),
		{ ...plan, setupFor: reservation }, { ...plan, coordinatedAccent: reservation }
	]) expect(allowsBassScalarContinuation(changed)).toBe(false);
});

it('restores actual pulse evidence and rejects malformed histories without inventing missing evidence', () => {
	const session = buildListeningTuneSession({ tuneId: 'ls-mankunku-blues', key: 'Eb', soloChoruses: 2 });
	const score = createRollingBacking(session.phrase.harmony, BACKING_STYLES.swing, { phraseId: `${session.phrase.id}:reply:1`,
		tempo: 140, ppq: 192, beatsPerBar: 4, swing: 0.67, performanceForm: session.phrase.performanceForm, ensemble: {} });
	let checkpoint: RollingBackingCheckpoint | undefined;
	for (let bar = 0; bar < 23; bar++) checkpoint = advanceRollingBacking(score, checkpoint).checkpoint;
	const rebind = (value: RollingBackingCheckpoint): RollingBackingCheckpoint => {
		const { checkpointId: _id, ...contents } = value;
		return { ...contents, checkpointId: `${contents.sessionId}:${contents.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}` };
	};
	const actual = advanceRollingBacking(score, checkpoint);
	expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(checkpoint)))).toEqual(actual);
	expect(actual.ensembleDevelopment.bassContinuations).toHaveLength(1);
	const missing = JSON.parse(JSON.stringify(checkpoint));
	delete missing.bass.scalarHistory;
	const fallback = advanceRollingBacking(score, rebind(missing));
	expect(fallback.bassEvents.find(event => event.absBeat === 93)!.midi).toBe(34);
	expect(fallback.ensembleDevelopment.bassContinuations).toBeUndefined();
	for (const mutate of [
		(state: any) => { state.bass.scalarHistory.pulse.absBeat = 87; },
		(state: any) => { state.bass.scalarHistory.pulse.midi = 0; },
		(state: any) => { state.bass.scalarHistory.pulse.time = 'NaNi'; },
		(state: any) => { state.bass.scalarHistory.pulse.time = '0i'; },
		(state: any) => { state.bass.scalarHistory.ornamentAfterPulse = 'false'; }
	]) {
		const invalid = JSON.parse(JSON.stringify(checkpoint)); mutate(invalid);
		expect(() => advanceRollingBacking(score, rebind(invalid))).toThrow(/checkpoint/i);
	}
	const old = JSON.parse(JSON.stringify(checkpoint));
	old.fingerprint = score.fingerprint.replace(',"bassScalarContinuationVersion":1', '');
	expect(old.fingerprint).not.toBe(score.fingerprint);
	expect(() => advanceRollingBacking(score, rebind(old))).toThrow(/checkpoint/i);
});

it('does not advance scalar pulse evidence or pitch history for a rejected rolling pulse', () => {
	const session = buildListeningTuneSession({ tuneId: 'ls-mankunku-blues', key: 'Eb', soloChoruses: 2 });
	const score = createRollingBacking(session.phrase.harmony, BACKING_STYLES.swing, { phraseId: `${session.phrase.id}:reply:1`,
		tempo: 140, ppq: 192, beatsPerBar: 4, swing: 0.67, performanceForm: session.phrase.performanceForm, ensemble: {} });
	const first = advanceRollingBacking(score);
	const info = { ...score.bars[0], ensemble: first.ensemblePlan.bars[0], intensity: first.ensemblePlan.bars[0].energy };
	const rejected = realizeRollingBass(score, 0, info, { trace: [], place: () => 4 * score.ppq, arrivalTick: () => 0 });
	expect(rejected.events).toEqual([]);
	expect(rejected.memory.scalarHistory).toBeUndefined();
	expect(rejected.memory.previousMidi).toBeNull();
	expect(rejected.memory.previousPreviousMidi).toBeNull();
});
