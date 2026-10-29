import { describe, expect, it } from 'vitest';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { realizeRollingPiano } from '$lib/audio/backing-rolling-piano';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildHistoricalListeningTuneSession as buildListeningTuneSession } from '../../helpers/musicality-tune-fixtures';
import { seedFrom } from '$lib/audio/generation-rng';
import type { EnsembleTiming } from '$lib/audio/ensemble-timing';
import { fractionToFloat } from '$lib/music/intervals';
import { capturePianoMotifSource } from '$lib/audio/backing-piano-motif-memory';
import { freezeCompMotifTrace } from '$lib/audio/backing-comp-figures';

const { phrase } = buildListeningTuneSession({ tuneId: 'ls-when-the-saints', key: 'Eb', soloChoruses: 2 });
const params = { phraseId: phrase.id, tempo: 140, ppq: 192, beatsPerBar: 4, swing: .67,
	sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {} };
const score = createRollingBacking(phrase.harmony, BACKING_STYLES.swing, params);
const timing: EnsembleTiming = { place: beat => Math.round(beat * 192), arrivalTick: bar => bar * 4 * 192, trace: [] };
const prefix = (end: number) => {
	let checkpoint: RollingBackingCheckpoint | undefined;
	const bars = [];
	for (let bar = 0; bar < end; bar++) {
		const result = advanceRollingBacking(score, checkpoint);
		checkpoint = result.checkpoint; bars.push(result);
	}
	return { checkpoint: checkpoint!, bars };
};
const rebind = (checkpoint: RollingBackingCheckpoint): RollingBackingCheckpoint => {
	const { checkpointId: _, ...contents } = checkpoint;
	return { ...contents, checkpointId: `${contents.sessionId}:${contents.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}` };
};

describe('actual piano motif recall across adjacent solo phrases', () => {
	it('recalls the complete heard Saints cell once and develops it using the current phrase', () => {
		const { checkpoint, bars } = prefix(24);
		const source = bars[20];
		expect(source.compEvents.map(event => event.absBeat)).toEqual([81.5]);
		expect(source.ensembleDevelopment.pianoMotifs[0]).toMatchObject({ transform: 'statement', sourceFigureId: 'and2-only' });
		expect(bars[21].compEvents).toEqual([]);
		expect(bars[22].compEvents.map(event => event.absBeat)).toEqual([90.5]);
		expect(bars[23].compEvents.map(event => event.absBeat)).toEqual([94.5]);
		const recalled = advanceRollingBacking(score, checkpoint);
		expect(recalled.compEvents.map(event => event.absBeat)).toEqual([97.5]);
		expect(recalled.ensembleDevelopment.pianoMotifs[0].recall).toEqual({ source: {
			barIndex: 20, phraseStartBar: 20, chorusIndex: 1, sectionIndex: 1, loopIndex: 0,
			figureId: 'and2-only', attacks: source.compEvents
		}, attacks: recalled.compEvents });
		expect(recalled.checkpoint.piano.phraseRecall?.recalledAt).toBe(24);
		expect(recalled.checkpoint.piano.motif).toMatchObject({ sourceId: 'and2-only', shift: -.5 });
		expect(recalled.checkpoint.piano.voicing?.notes).toEqual(recalled.compEvents[0].notes);
		expect(recalled.checkpoint.drums.previousCompOnsets).toEqual([1.5]);
		const recalledInfo = { ...score.bars[24], ensemble: recalled.ensemblePlan.bars[0], intensity: recalled.ensemblePlan.bars[0].energy };
		expect(capturePianoMotifSource(score, 24, recalledInfo, 'unavailable', recalled.ensembleDevelopment.pianoMotifs[0], recalled.compEvents)).toBeNull();
		expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(checkpoint)))).toEqual(recalled);
		let next = recalled;
		for (let bar = 25; bar <= 28; bar++) {
			next = advanceRollingBacking(score, next.checkpoint);
			expect(next.ensembleDevelopment.pianoMotifs[0].recall).toBeUndefined();
			if (bar === 26) expect(next.compEvents.map(event => event.absBeat)).toEqual([105]);
		}
		expect(next.checkpoint.piano.phraseRecall).toEqual({ version: 1, source: null, recalledAt: null });
	});

	it('does not remember a statement that was never accepted, and keeps ordinary output when the recall is rejected', () => {
		const beforeSource = prefix(20).checkpoint;
		const source = advanceRollingBacking(score, beforeSource);
		const sourceInfo = { ...score.bars[20], ensemble: source.ensemblePlan.bars[0], intensity: source.ensemblePlan.bars[0].energy };
		const rejected = realizeRollingPiano(score, 20, sourceInfo, { ...timing, place: () => 21 * 4 * 192 }, beforeSource.piano);
		expect(rejected.events).toEqual([]);
		expect(rejected.memory.phraseRecall).toEqual({ version: 1, source: null, recalledAt: null });
		const checkpoint = prefix(24).checkpoint;
		const result = advanceRollingBacking(score, checkpoint);
		const info = { ...score.bars[24], ensemble: result.ensemblePlan.bars[0], intensity: result.ensemblePlan.bars[0].energy };
		const noSource = { ...checkpoint.piano, phraseRecall: { version: 1 as const, source: null, recalledAt: null } };
		// The original push resolves the next chord at100, while the recall
		// needs current harmony at98. Missing current harmony must not erase it.
		const gap = { ...score, harmony: score.harmony.filter(segment => !(fractionToFloat(segment.startOffset) * 4 <= 98 &&
			(fractionToFloat(segment.startOffset) + fractionToFloat(segment.duration)) * 4 > 98)) };
		const ordinary = realizeRollingPiano(gap, 24, info, timing, noSource);
		const failed = realizeRollingPiano(gap, 24, info, timing, checkpoint.piano);
		expect(failed).toEqual(ordinary);
		expect(failed.events.map(event => event.absBeat)).toEqual([99.5]);
	});

	it('keeps known activity/rest, reservations and silence ahead of recall', () => {
		const checkpoint = prefix(24).checkpoint;
		const result = advanceRollingBacking(score, checkpoint);
		const plan = result.ensemblePlan.bars[0];
		const info = { ...score.bars[24], ensemble: plan, intensity: plan.energy };
		const reservation = { id: 'existing-reservation', targetBarIndex: 24, beatOffset: 0 as const, strength: 1, participants: ['bass', 'drums'] as const };
		for (const evidence of ['active', 'resting'] as const) {
			const actual = realizeRollingPiano(score, 24, info, timing, checkpoint.piano, undefined, evidence);
			expect(actual.trace.recall).toBeUndefined();
			expect(actual.events.map(event => event.absBeat)).toEqual([99.5]);
		}
		for (const ensemble of [
			{ ...plan, piano: { ...plan.piano, maxAttacks: 0 as const } },
			{ ...plan, phraseIntent: 'leave_space' as const },
			{ ...plan, phraseIntent: 'release' as const },
			{ ...plan, responseOwner: 'drums' as const },
			{ ...plan, coordinatedAccent: reservation },
			{ ...plan, setupFor: reservation },
			{ ...plan, drums: { ...plan.drums, allowFill: true } },
			{ ...plan, performanceEnergy: { ...plan.performanceEnergy!, phase: 'solo_release' as const } }
		]) expect(realizeRollingPiano(score, 24, { ...info, ensemble }, timing, checkpoint.piano).trace.recall).toBeUndefined();
		for (const flag of ['isSectionFirstBar', 'isChorusFirstBar', 'isSectionFinalBar', 'isChorusFinalBar', 'isFinalBar'] as const) {
			expect(realizeRollingPiano(score, 24, { ...info, [flag]: true }, timing, checkpoint.piano).trace.recall).toBeUndefined();
		}
	});

	it('requires the entire naturally played two-attack source, rather than a surviving fragment', () => {
		const { phrase: blues } = buildListeningTuneSession({ tuneId: 'ls-mankunku-blues', key: 'C', soloChoruses: 2 });
		const bluesScore = createRollingBacking(blues.harmony, BACKING_STYLES.swing, { ...params, phraseId: blues.id,
			performanceForm: blues.performanceForm, sectionMap: blues.sectionMap });
		let checkpoint: RollingBackingCheckpoint | undefined;
		let source = advanceRollingBacking(bluesScore);
		for (let bar = 0; bar <= 20; bar++) { source = advanceRollingBacking(bluesScore, checkpoint); checkpoint = source.checkpoint; }
		expect(source.compEvents.map(event => event.absBeat)).toEqual([81.5, 83]);
		const info = { ...bluesScore.bars[20], ensemble: source.ensemblePlan.bars[0], intensity: source.ensemblePlan.bars[0].energy };
		const trace = source.ensembleDevelopment.pianoMotifs[0];
		expect(capturePianoMotifSource(bluesScore, 20, info, 'unavailable', trace, source.compEvents)?.attacks).toEqual(source.compEvents);
		for (const fragment of [source.compEvents.slice(0, 1), source.compEvents.slice(1)]) {
			expect(capturePianoMotifSource(bluesScore, 20, info, 'unavailable', trace, fragment)).toBeNull();
		}
	});

	it('owns and deeply freezes accepted provenance after mutable JSON input and cache restoration', () => {
		const input = JSON.parse(JSON.stringify(prefix(24).checkpoint));
		const result = advanceRollingBacking(score, input);
		const receipt = result.ensembleDevelopment.pianoMotifs[0].recall!;
		expect(Object.isFrozen(input.piano.phraseRecall.source.attacks[0].notes)).toBe(false);
		input.piano.phraseRecall.source.attacks[0].notes[0] = 1;
		expect(receipt.source.attacks[0].notes[0]).toBe(55);
		const restored = freezeCompMotifTrace(JSON.parse(JSON.stringify(result.ensembleDevelopment.pianoMotifs)));
		for (const value of [receipt, restored[0].recall!]) {
			expect(Object.isFrozen(value)).toBe(true);
			expect(Object.isFrozen(value.source)).toBe(true);
			for (const attacks of [value.source.attacks, value.attacks]) {
				expect(Object.isFrozen(attacks)).toBe(true);
				expect(attacks.every(attack => Object.isFrozen(attack) && Object.isFrozen(attack.notes))).toBe(true);
			}
		}
	});

	it('requires valid bounded source identity under the scoped policy and rejects prior policy with a fresh checksum', () => {
		const checkpoint = prefix(24).checkpoint;
		expect(checkpoint.piano.phraseRecall?.source?.barIndex).toBe(20);
		for (const mutate of [
			(value: any) => { delete value.piano.phraseRecall; },
			(value: any) => { value.piano.phraseRecall.source.sectionIndex = 2; },
			(value: any) => { value.piano.phraseRecall.source.loopIndex = 1; },
			(value: any) => { value.piano.phraseRecall.source.attacks[0].absBeat = 83.5; },
			(value: any) => { value.piano.phraseRecall.source.attacks[0].time = '999999i'; },
			(value: any) => { value.piano.phraseRecall.recalledAt = 23; }
		]) {
			const malformed = JSON.parse(JSON.stringify(checkpoint)); mutate(malformed);
			expect(() => advanceRollingBacking(score, rebind(malformed))).toThrow(/checkpoint/);
		}
		const binding = JSON.parse(score.fingerprint);
		const policy = binding.find((entry: any) => entry?.pianoPhraseRecallVersion);
		expect(policy.pianoPhraseRecallVersion).toBe(1);
		delete policy.pianoPhraseRecallVersion;
		expect(() => advanceRollingBacking(score, rebind({ ...checkpoint, fingerprint: JSON.stringify(binding) }))).toThrow(/checkpoint/);
	});
});
