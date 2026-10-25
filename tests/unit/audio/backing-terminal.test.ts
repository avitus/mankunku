import { assessTerminalArrangement, realizeTerminalArrangement } from '$lib/audio/backing-terminal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as voicings from '$lib/audio/coordinated-voicing';
import * as bassGenerator from '$lib/audio/backing-bass';
import { planEnsembleWindow } from '$lib/audio/ensemble-plan';
import { seedFrom } from '$lib/audio/generation-rng';
import { generateBacking, generateBackingCached, type BackingGenerationParams } from '$lib/audio/backing-generation';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';

const { phrase } = buildListeningTuneSession({ tuneId: 'ls-mankunku-blues', key: 'C', soloChoruses: 2 });
const params: BackingGenerationParams = { phraseId: phrase.id, tempo: 140, ppq: 192, beatsPerBar: 4, swing: .67,
	sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {} };
const endingParams: BackingGenerationParams = { ...params, terminalArrangement: { ending: 'hold-release', melody: phrase.notes } };
afterEach(() => vi.restoreAllMocks());

function checkEnding(result: { bassEvents: readonly { absBeat: number; time: string; midi: number; duration: number }[];
	compEvents: readonly { absBeat: number; time: string; notes: number[]; duration: number }[];
	drumEvents: readonly { absBeat: number; time: string; drum: string; role?: string }[] }) {
	const bass = result.bassEvents.filter(event => event.absBeat >= 204);
	const piano = result.compEvents.filter(event => event.absBeat >= 204);
	const drums = result.drumEvents.filter(event => event.absBeat >= 204);
	expect(bass).toHaveLength(1);
	expect(piano).toHaveLength(1);
	expect(drums.map(event => event.drum)).toEqual(['ride', 'kick']);
	expect([...bass, ...piano, ...drums].every(event => event.absBeat === 204 && event.time === '39168i')).toBe(true);
	expect(bass[0].midi % 12).toBe(0);
	expect(bass[0].duration).toBe(120 / 140);
	expect(piano[0].duration).toBe(bass[0].duration);
	expect(piano[0].notes.length).toBeGreaterThanOrEqual(2);
	expect(drums.every(event => event.role === 'accent')).toBe(true);
}

describe('explicit finite terminal arrangement', () => {
	it('admits the known tied closing melody', () => {
		const assessment = assessTerminalArrangement(phrase.harmony, BACKING_STYLES.swing, endingParams);
		expect(assessment, JSON.stringify(assessment)).toMatchObject({ available: true });
	});
	it.each(['swing', 'straight'] as const)('%s fixed holds the final Blues harmony together', styleId => {
		const style = BACKING_STYLES[styleId];
		const ordinary = generateBacking(phrase.harmony, style, params);
		const actual = generateBacking(phrase.harmony, style, endingParams);
		checkEnding(actual);
		for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) {
			expect(actual[field].filter(event => event.absBeat < 204)).toEqual(ordinary[field].filter(event => event.absBeat < 204));
		}
	});
	it.each(['swing', 'straight'] as const)('%s rolling holds only the final committed bar', styleId => {
		const style = BACKING_STYLES[styleId];
		const score = createRollingBacking(phrase.harmony, style, endingParams);
		const control = createRollingBacking(phrase.harmony, style, params);
		let checkpoint: RollingBackingCheckpoint | undefined;
		let baseline: RollingBackingCheckpoint | undefined;
		for (let bar = 0; bar < score.totalBars; bar++) {
			const actual = advanceRollingBacking(score, checkpoint);
			const ordinary = advanceRollingBacking(control, baseline);
			if (bar === score.totalBars - 1) checkEnding(actual);
			else for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) expect(actual[field]).toEqual(ordinary[field]);
			expect(advanceRollingBacking(score, checkpoint && JSON.parse(JSON.stringify(checkpoint)))).toEqual(actual);
			checkpoint = actual.checkpoint; baseline = ordinary.checkpoint;
		}
	});
});


function finalContext() {
	const score = createRollingBacking(phrase.harmony, BACKING_STYLES.swing, endingParams);
	let checkpoint: RollingBackingCheckpoint | undefined;
	let prior;
	for (let bar = 0; bar < score.totalBars - 1; bar++) {
		prior = advanceRollingBacking(score, checkpoint); checkpoint = prior.checkpoint;
	}
	const plan = planEnsembleWindow({ phraseId: score.phraseId, tempo: score.tempo, bars: score.bars,
		startBar: 51, endBarExclusive: 52, memory: checkpoint!.ensemble }).plan.bars[0];
	const input = { reservation: score.terminalArrangement!, plan, style: BACKING_STYLES.swing,
		phraseId: score.phraseId, tempo: score.tempo, ppq: score.ppq, segmentIndex: score.harmony.length - 1,
		previousBass: checkpoint!.bass.previousMidi, previousVoicing: checkpoint!.piano.voicing, previousContour: checkpoint!.piano.contour };
	return { score, checkpoint: checkpoint!, prior: prior!, input };
}

describe('terminal admission and complete fallback', () => {
	it('requires explicit melody knowledge and permits a known instrumental close', () => {
		expect(assessTerminalArrangement(phrase.harmony, BACKING_STYLES.swing, { ...endingParams, terminalArrangement: { ending: 'hold-release' } }))
			.toEqual({ available: false, reason: 'The closing melody must be known' });
		const assessment = assessTerminalArrangement(phrase.harmony, BACKING_STYLES.swing,
			{ ...endingParams, terminalArrangement: { ending: 'hold-release', melody: [] } });
		expect(assessment).toMatchObject({ available: true, reservation: { absBeat: 204, releaseBeat: 206, holdBeats: 2 } });
	});
	it.each([
		{ pitch: 60, offset: [205, 4], duration: [1, 4] },
		{ pitch: 128, offset: [51, 1], duration: [1, 2] },
		{ pitch: 60, offset: [51, 0], duration: [1, 2] },
		{ pitch: 60, offset: [51, 1], duration: [0, 1] },
		{ pitch: 60, offset: [51, 1], duration: [2, 1] },
		{ pitch: 60, offset: [51, 1], duration: [1, 2], tied: true }
	])('does not infer an ending from malformed or continuing melody %j', note => {
		const assessment = assessTerminalArrangement(phrase.harmony, BACKING_STYLES.swing,
			{ ...endingParams, terminalArrangement: { ending: 'hold-release', melody: [note] as typeof phrase.notes } });
		expect(assessment.available).toBe(false);
	});
	it('requires supported stable final harmony rather than flattening a cadence', () => {
		for (const harmony of [
			[...phrase.harmony.slice(0, -1), { ...phrase.harmony.at(-1)!, chord: { root: 'C', quality: 'toString' } }],
			[...phrase.harmony.slice(0, -1), { ...phrase.harmony.at(-1)!, scaleId: 'unknown' }],
			[...phrase.harmony.slice(0, -1), { ...phrase.harmony.at(-1)!, duration: [1, 2] },
				{ ...phrase.harmony.at(-1)!, startOffset: [103, 2], duration: [1, 2] }]
		]) expect(assessTerminalArrangement(harmony as typeof phrase.harmony, BACKING_STYLES.swing, endingParams).available).toBe(false);
	});
	it('keeps the complete ordinary fixed result when a preceding accepted tail owns the cue', () => {
		const original = bassGenerator.generateBassLine;
		vi.spyOn(bassGenerator, 'generateBassLine').mockImplementation((...args) => {
			const result = original(...args);
			const prior = result.events.filter(event => event.absBeat < 204).at(-1)!;
			prior.duration = (204 * 192 - parseInt(prior.time)) * 60 / 140 / 192 + .1;
			return result;
		});
		const ordinary = generateBacking(phrase.harmony, BACKING_STYLES.swing, params);
		const actual = generateBacking(phrase.harmony, BACKING_STYLES.swing, endingParams);
		for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) expect(actual[field]).toEqual(ordinary[field]);
		expect(actual.ensembleDevelopment!.terminalArrangements).toMatchObject([{ status: 'withheld', reason: 'preceding_release' }]);
		expect(actual.ensemblePlan!.bars.at(-1)!.bass.keepPulse).toBe(true);
		expect(actual.ensemblePlan!.bars.at(-1)!.drums.keepTime).toBe(true);
		expect(actual.ensembleDevelopment!.pianoVoicings).toEqual(ordinary.ensembleDevelopment!.pianoVoicings);
	});
	it('rejects the whole alternative when piano cannot supply its participant', () => {
		const { score, checkpoint } = finalContext();
		const ordinaryScore = createRollingBacking(phrase.harmony, BACKING_STYLES.swing, params);
		let ordinaryCheckpoint: RollingBackingCheckpoint | undefined;
		for (let bar = 0; bar < 51; bar++) ordinaryCheckpoint = advanceRollingBacking(ordinaryScore, ordinaryCheckpoint).checkpoint;
		const ordinary = advanceRollingBacking(ordinaryScore, ordinaryCheckpoint);
		const original = voicings.resolveCoordinatedVoicing;
		vi.spyOn(voicings, 'resolveCoordinatedVoicing').mockImplementation(input => ({ ...original(input), notes: [] }));
		const actual = advanceRollingBacking(score, checkpoint);
		for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) expect(actual[field]).toEqual(ordinary[field]);
		for (const field of ['piano', 'bass', 'drums'] as const) expect(actual.checkpoint[field]).toEqual(ordinary.checkpoint[field]);
		expect(actual.ensembleDevelopment.terminalArrangements).toMatchObject([{ status: 'withheld', reason: 'unrealizable' }]);
		expect(actual.ensembleDevelopment.pianoVoicings).toEqual(ordinary.ensembleDevelopment.pianoVoicings);
	});
	it('preserves already reserved shared accents, setups and response ownership', () => {
		const { input } = finalContext();
		const accent = { id: 'existing-closing-catch', targetBarIndex: 51, beatOffset: 0 as const, strength: 1,
			participants: ['bass', 'drums'] as const };
		for (const plan of [{ ...input.plan, coordinatedAccent: accent }, { ...input.plan, setupFor: accent },
			...(['piano', 'bass', 'drums'] as const).map(responseOwner => ({ ...input.plan, responseOwner }))]) {
			const before = JSON.stringify(plan);
			expect(realizeTerminalArrangement({ ...input, plan }).decision).toMatchObject({ status: 'withheld', reason: 'unrealizable' });
			expect(JSON.stringify(plan)).toBe(before);
		}
	});
	it('does not take over an already committed bass launch or mutate actual prior history', () => {
		const { input } = finalContext();
		const before = JSON.stringify(input);
		expect(realizeTerminalArrangement({ ...input, committedLaunch: true }).decision).toMatchObject({ status: 'withheld', reason: 'unrealizable' });
		expect(JSON.stringify(input)).toBe(before);
	});
});

describe('terminal causal checkpoint and immutable receipts', () => {
	it('commits only the root, held chord and actual onset ledger, expiring discarded final proposals', () => {
		const { score, checkpoint, prior } = finalContext();
		const restored = JSON.parse(JSON.stringify(checkpoint));
		const actual = advanceRollingBacking(score, restored);
		const bass = actual.bassEvents[0], piano = actual.compEvents[0];
		for (const event of [...prior.bassEvents, ...prior.compEvents]) {
			expect(parseInt(event.time) + event.duration * 140 / 60 * 192).toBeLessThanOrEqual(39168 + 1e-7);
		}
		expect(actual.checkpoint.bass).toMatchObject({ previousMidi: bass.midi, previousPreviousMidi: checkpoint.bass.previousMidi,
			nextTarget: null, pendingLaunch: null, scalarHistory: { pulse: { midi: bass.midi, absBeat: 204, time: bass.time }, ornamentAfterPulse: false } });
		expect(actual.checkpoint.piano.voicing?.notes).toEqual(piano.notes);
		expect(actual.checkpoint.piano.contour).toMatchObject({ lastTopMidi: piano.notes.at(-1), lastBarIndex: 51 });
		expect(actual.checkpoint.piano.phraseRecall).toEqual({ version: 1, source: null, recalledAt: null });
		expect(actual.checkpoint.piano.motif).toBeNull();
		expect(actual.checkpoint.drums.previousCompOnsets).toEqual([0]);
		expect(actual.checkpoint.drums.previousCompIsSharedArrival).toBe(true);
		expect(actual.checkpoint.drums).not.toHaveProperty('previousCompIsDrumReply');
		expect(actual.checkpoint.drums.phrase).not.toHaveProperty('motif');
		expect(actual.ensembleDevelopment.bassTurnarounds).toEqual([]);
		expect(actual.ensembleDevelopment).not.toHaveProperty('pianoAnswers');
		expect(actual.ensembleDevelopment).not.toHaveProperty('pianoRecoveries');
		expect(actual.ensembleDevelopment).not.toHaveProperty('pianoFeedback');
		expect(actual.ensembleDevelopment.pianoMotifs).toMatchObject([{ reason: 'terminal_arrangement', hits: [{ b: 0, d: 2 }] }]);
		expect(() => advanceRollingBacking(score, JSON.parse(JSON.stringify(actual.checkpoint)))).toThrow('complete');
		expect(Object.isFrozen(restored)).toBe(false);
	});
	it('rejects a rebound checkpoint from continuing accompaniment and invalid direct-planner reservation', () => {
		const { score, checkpoint } = finalContext();
		const plain = createRollingBacking(phrase.harmony, BACKING_STYLES.swing, params);
		const forged = JSON.parse(JSON.stringify(checkpoint));
		forged.fingerprint = plain.fingerprint;
		const { checkpointId: _id, ...contents } = forged;
		forged.checkpointId = `${forged.sessionId}:${forged.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}`;
		expect(() => advanceRollingBacking(score, forged)).toThrow('checkpoint');
		for (const reservation of [{ ...score.terminalArrangement!, holdBeats: 5 }, { ...score.terminalArrangement!, barIndex: 50 },
			{ ...score.terminalArrangement!, participants: ['piano'] }]) {
			const bars = score.bars.map(entry => entry.barIndex === 51 ? { ...entry, terminalArrangement: reservation } : entry);
			expect(() => planEnsembleWindow({ phraseId: score.phraseId, tempo: score.tempo, bars: bars as typeof score.bars })).toThrow('terminal');
		}
	});
	it('freezes actual receipt and reservation again on fixed JSON-cache retrieval', () => {
		const original = generateBackingCached(phrase.harmony, BACKING_STYLES.swing, endingParams);
		const restored = generateBackingCached(phrase.harmony, BACKING_STYLES.swing, endingParams);
		expect(restored).toEqual(original);
		const receipt = restored.ensembleDevelopment!.terminalArrangements![0];
		expect(receipt.status).toBe('accepted');
		if (receipt.status !== 'accepted') throw new Error('Expected actual terminal evidence');
		for (const value of [receipt, receipt.piano, receipt.piano.notes, receipt.bass, receipt.drums, ...receipt.drums,
			restored.ensemblePlan!.bars.at(-1)!.terminalArrangement, restored.ensemblePlan!.bars.at(-1)!.terminalArrangement!.chord,
			restored.ensemblePlan!.bars.at(-1)!.terminalArrangement!.participants]) expect(Object.isFrozen(value)).toBe(true);
	});
});
