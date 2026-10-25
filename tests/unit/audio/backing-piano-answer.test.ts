import { expect, it } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { realizeRollingPiano } from '$lib/audio/backing-rolling-piano';
import { planDrumPhraseBar } from '$lib/audio/backing-drum-phrases';
import { proposePianoAnswer } from '$lib/audio/backing-piano-answer';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { seedFrom } from '$lib/audio/generation-rng';
import type { EnsembleTiming } from '$lib/audio/ensemble-timing';
import type { BarInfo } from '$lib/audio/backing-generation';

const { phrase } = buildListeningTuneSession({ tuneId: 'ls-when-the-saints', key: 'F#', soloChoruses: 2 });
const score = createRollingBacking(phrase.harmony, BACKING_STYLES.swing, {
	phraseId: phrase.id, tempo: 140, ppq: 192, swing: 0.67, beatsPerBar: 4,
	performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {}
});
let prior: RollingBackingCheckpoint | undefined;
for (let bar = 0; bar < 18; bar++) prior = advanceRollingBacking(score, prior).checkpoint;
const reply = advanceRollingBacking(score, prior);
const info: BarInfo = { ...score.bars[18], ensemble: reply.ensemblePlan.bars[0], intensity: reply.ensemblePlan.bars[0].energy };
const feedback = reply.ensembleDevelopment.pianoFeedback![0];
const context = { feedback, previous: prior!.pianoAnswer };
const timing: EnsembleTiming = { place: (beat) => Math.round(beat * 192), arrivalTick: (bar) => bar * 4 * 192, trace: [] };
const proposalInput = { barIndex: 18, info, feedback, previous: prior!.pianoAnswer, retainedMotif: false,
	realized: [{ beatOffset: 1.5, durationBeats: 1.2, velocity: 65 }] };

function rebind(checkpoint: RollingBackingCheckpoint): RollingBackingCheckpoint {
	const { checkpointId: _, ...contents } = checkpoint;
	return { ...contents, checkpointId: `${contents.sessionId}:${contents.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}` };
}

it('selects a bounded reply from the existing fallback without adding an attack or changing velocity', () => {
	const proposal = proposePianoAnswer(proposalInput)!;
	expect(proposal.hit).toEqual({ beatOffset: 2.5, durationBeats: 0.7, velocity: 65 });
	expect(proposal.source).toEqual(feedback.source);
	const result = realizeRollingPiano(score, 18, info, timing, prior!.piano, context);
	expect(result.events).toHaveLength(1);
	expect(result.trace).toMatchObject({ motifId: null, sourceFigureId: null, transform: 'fallback', reason: 'drum_reply' });
	expect(result.trace.hits).toEqual([{ b: 2.5, d: result.events[0].duration * 140 / 60 }]);
	expect(result.memory.recentFigures.at(-1)).toBe('drum-reply');
	expect(result.answer?.attack).toEqual(result.events[0]);
});

it('keeps all earlier space, form, ownership, active-soloist and cooldown decisions ahead of replies', () => {
	const plan = info.ensemble!;
	const plans = [
		{ ...plan, piano: { ...plan.piano, maxAttacks: 0 as const } },
		{ ...plan, piano: { ...plan.piano, maxAttacks: 2 as const } },
		{ ...plan, piano: { ...plan.piano, rootlessTexture: { request: 'three' as const, reason: 'active_soloist' as const } } },
		{ ...plan, phraseIntent: 'leave_space' as const }, { ...plan, intent: 'release' as const },
		{ ...plan, performanceEnergy: { ...plan.performanceEnergy!, phase: 'solo_release' as const } },
		{ ...plan, performanceEnergy: { ...plan.performanceEnergy!, phase: 'solo_peak' as const } },
		{ ...plan, responseOwner: 'piano' as const },
		{ ...plan, drums: { ...plan.drums, allowFill: true } }
	];
	for (const ensemble of plans) expect(proposePianoAnswer({ ...proposalInput, info: { ...info, ensemble } })).toBeUndefined();
	for (const flag of ['isSectionFirstBar', 'isChorusFirstBar', 'isSectionFinalBar', 'isChorusFinalBar', 'isFinalBar'] as const) {
		expect(proposePianoAnswer({ ...proposalInput, info: { ...info, [flag]: true } })).toBeUndefined();
	}
	expect(proposePianoAnswer({ ...proposalInput, retainedMotif: true })).toBeUndefined();
	expect(proposePianoAnswer({ ...proposalInput, realized: [] })).toBeUndefined();
	expect(proposePianoAnswer({ ...proposalInput, realized: [...proposalInput.realized, ...proposalInput.realized] })).toBeUndefined();
	expect(proposePianoAnswer({ ...proposalInput, previous: { version: 1, lastAnswerBar: 16 } })).toBeUndefined();
	expect(proposePianoAnswer({ ...proposalInput, previous: { version: 1, lastAnswerBar: 15 } })).toBeDefined();
	expect(proposePianoAnswer({ ...proposalInput, feedback: { ...feedback, action: 'yield', reason: 'drum_statement' } })).toBeUndefined();
});

it('retains the actual ordinary fallback when the moved reply is rejected by timing', () => {
	const rejecting: EnsembleTiming = { ...timing, place: (beat) => beat === 74.5 ? 76 * 192 : timing.place(beat, 'comp') };
	const ordinary = realizeRollingPiano(score, 18, info, rejecting, prior!.piano);
	const attempted = realizeRollingPiano(score, 18, info, rejecting, prior!.piano, context);
	expect(ordinary.events).toHaveLength(1);
	expect(attempted).toEqual(ordinary);
	expect(attempted.memory.voicing).toEqual(ordinary.memory.voicing);
});

it('cannot resurrect an ordinary fallback rejected by timing', () => {
	const rejecting: EnsembleTiming = { ...timing, place: (beat) => beat !== 74.5 ? 76 * 192 : timing.place(beat, 'comp') };
	const ordinary = realizeRollingPiano(score, 18, info, rejecting, prior!.piano);
	const attempted = realizeRollingPiano(score, 18, info, rejecting, prior!.piano, context);
	expect(ordinary.events).toEqual([]);
	expect(attempted).toEqual(ordinary);
	expect(attempted.memory.voicing).toEqual(prior!.piano.voicing);
});

it('resolves the accepted reply from its actual anticipated harmony and retains the actual emitted memory', () => {
	const changed: typeof score = { ...score, harmony: [
		{ chord: { root: 'C' as const, quality: 'maj7' as const }, scaleId: 'major.ionian', startOffset: [18, 1], duration: [3, 4] },
		{ chord: { root: 'F#' as const, quality: '7' as const }, scaleId: 'major.mixolydian', startOffset: [75, 4], duration: [1, 4] }
	] };
	const ordinary = realizeRollingPiano(changed, 18, info, timing, prior!.piano);
	const actual = realizeRollingPiano(changed, 18, info, timing, prior!.piano, context);
	expect(ordinary.memory.voicing!.chord).toEqual({ root: 'C', quality: 'maj7' });
	expect(actual.memory.voicing!.chord).toEqual({ root: 'F#', quality: '7' });
	expect(actual.memory.voicing!.notes).toEqual(actual.events[0].notes);
	expect(actual.voicingTrace![0].notes).toEqual(actual.events[0].notes);
	const gap = { ...changed, harmony: changed.harmony.slice(0, 1) };
	expect(realizeRollingPiano(gap, 18, info, timing, prior!.piano, context))
		.toEqual(realizeRollingPiano(gap, 18, info, timing, prior!.piano));
});

it('binds reply provenance to a valid scoped checkpoint while retaining its actual onset ledger', () => {
	expect(reply.checkpoint.drums.previousCompOnsets).toEqual([2.5]);
	expect(reply.checkpoint.drums.previousCompIsDrumReply).toBe(true);
	expect(reply.checkpoint.pianoAnswer).toEqual({ version: 1, lastAnswerBar: 18 });
	expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(reply.checkpoint))))
		.toEqual(advanceRollingBacking(score, reply.checkpoint));
	for (const change of [
		{ pianoAnswer: undefined }, { pianoAnswer: { version: 2, lastAnswerBar: 18 } },
		{ pianoAnswer: { version: 1, lastAnswerBar: 19 } }, { pianoAnswer: { version: 1, lastAnswerBar: 1.5 } },
		{ drums: { ...reply.checkpoint.drums, previousCompIsDrumReply: false } },
		{ drums: { ...reply.checkpoint.drums, previousCompIsDrumReply: undefined } },
		{ drums: { ...reply.checkpoint.drums, previousCompOnsets: [0, 2.5] } },
		{ drums: { ...reply.checkpoint.drums, previousCompOnsets: [0.5] } }
	]) expect(() => advanceRollingBacking(score, rebind({ ...reply.checkpoint, ...change } as RollingBackingCheckpoint))).toThrow(/checkpoint/);
});


it('excludes a reply before drum answer RNG eligibility while keeping ordinary independent piano answers possible', () => {
	let ordinaryAnswers = 0;
	for (let seed = 0; seed < 32; seed++) {
		const input = (bar: number, maxCommentaryHits: 0 | 2) => ({
			phraseId: `reply-source-${seed}`, tempo: 140, beatsPerBar: 4 as const, barIndex: bar,
			phraseStartBar: 0, phraseEndBarExclusive: 4, harmonyEndBeat: 16,
			info: { ...info, ensemble: { ...info.ensemble!, barIndex: bar, phraseStartBar: 0,
				drums: { ...info.ensemble!.drums, maxCommentaryHits } } },
			compOnsets: bar === 0 ? [2.5] : [], bassOnsets: [0, 1, 2, 3]
		});
		const first = planDrumPhraseBar({ ...input(0, 0), compIsDrumReply: true });
		expect(first.memory.previousCompOnsets).toEqual([2.5]);
		const { previousCompIsDrumReply: _, ...ordinaryMemory } = first.memory;
		const marked = planDrumPhraseBar(input(1, 2), first.memory);
		const noIndependentSource = planDrumPhraseBar(input(1, 2), { ...ordinaryMemory, previousCompOnsets: [] });
		const independent = planDrumPhraseBar(input(1, 2), ordinaryMemory);
		// Equality of the whole accepted phrase, not merely the source label,
		// detects an erroneous eligibility coin draw before filtering provenance.
		expect(marked).toEqual(noIndependentSource);
		expect(marked.memory.previousCompIsDrumReply).toBeUndefined();
		if (independent.bar.commentary.source === 'piano') ordinaryAnswers++;
	}
	expect(ordinaryAnswers).toBeGreaterThan(0);
});

it('rejects historical policy checkpoints with a valid checksum rather than accepting an incompatible continuation', () => {
	const binding = JSON.parse(score.fingerprint);
	const policy = binding.find((entry: unknown) => entry && typeof entry === 'object' && 'pianoAnswerVersion' in entry);
	expect(policy.pianoAnswerVersion).toBe(1);
	delete policy.pianoAnswerVersion;
	const historical = { ...prior!, fingerprint: JSON.stringify(binding) };
	expect(() => advanceRollingBacking(score, rebind(historical))).toThrow(/checkpoint/);
});
