import { expect, it } from 'vitest';
import { resolveCoordinatedVoicing } from '$lib/audio/coordinated-voicing';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { realizeRollingPiano } from '$lib/audio/backing-rolling-piano';
import { generateBacking } from '$lib/audio/backing-generation';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { seedFrom } from '$lib/audio/generation-rng';

const { phrase } = buildListeningTuneSession({ tuneId: 'ls-mankunku-blues', key: 'F#', soloChoruses: 2 });
const params = { phraseId: phrase.id, tempo: 140, ppq: 192, swing: 0.67, beatsPerBar: 4,
	performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {} };
const score = createRollingBacking(phrase.harmony, BACKING_STYLES['bossa-nova'], params);

function rebind(checkpoint: RollingBackingCheckpoint): RollingBackingCheckpoint {
	const { checkpointId: _, ...contents } = checkpoint;
	return { ...contents, checkpointId: `${contents.sessionId}:${contents.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}` };
}

it('admits the real native Bossa target-70 inversion without trading harmonic or movement priorities', () => {
	const input = { chord: { root: 'Db' as const, quality: 'min7' as const }, family: 'rootless-a' as const, registerMidi: 63,
		previous: { version: 1 as const, chord: { root: 'F#' as const, quality: '7' as const }, notes: [56, 61, 66] } };
	const before = resolveCoordinatedVoicing(input);
	const after = resolveCoordinatedVoicing({ ...input, targetTopMidi: 70 });
	expect(before.notes).toEqual([56, 59, 64, 75]);
	expect(after.notes).toEqual([56, 63, 64, 71]);
	expect(after.decision.guideMotion).toBeNull();
	expect(after.decision.commonTones).toEqual(before.decision.commonTones);
	expect(after.decision.totalMovement).toBe(16);
	expect(after.decision.totalMovement).toBe(before.decision.totalMovement);
	expect(after.notes.map(n => n % 12).sort()).toEqual(before.notes.map(n => n % 12).sort());
	expect(after.decision.topLine).toEqual({ targetMidi: 70, actualMidi: 71, distance: 1, eligible: true });
});

it('anchors only accepted Bossa notes and exposes fixed and rolling pitch targets without enabling dialogue', () => {
	const fixed = generateBacking(phrase.harmony, BACKING_STYLES['bossa-nova'], params);
	expect(fixed.ensembleDevelopment!.pianoVoicings!.some(v => v.decision.topLine?.eligible)).toBe(true);
	let checkpoint: RollingBackingCheckpoint | undefined;
	let targets = 0;
	for (let bar = 0; bar < score.totalBars; bar++) {
		const result = advanceRollingBacking(score, checkpoint);
		if (checkpoint) expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(checkpoint)))).toEqual(result);
		if (result.compEvents.length) {
			expect(result.checkpoint.piano.contour!.lastTopMidi).toBe(result.compEvents.at(-1)!.notes.at(-1));
			expect(result.checkpoint.piano.contour!.lastBarIndex).toBe(bar);
		} else expect(result.checkpoint.piano.contour).toEqual(checkpoint?.piano.contour);
		targets += result.ensembleDevelopment!.pianoVoicings!.filter(v => v.decision.topLine?.eligible).length;
		expect(result.checkpoint.pianoAnswer).toBeUndefined();
		expect(result.checkpoint.pianoRecovery).toBeUndefined();
		expect(result.ensembleDevelopment!.pianoAnswers).toBeUndefined();
		expect(result.ensembleDevelopment!.pianoRecoveries).toBeUndefined();
		checkpoint = result.checkpoint;
	}
	expect(targets).toBeGreaterThan(0);
	const first = advanceRollingBacking(score);
	const info = { ...score.bars[0], ensemble: first.ensemblePlan.bars[0], intensity: first.ensemblePlan.bars[0].energy };
	const rejected = realizeRollingPiano(score, 0, info, { place: () => 768, arrivalTick: () => 768, trace: [] });
	expect(rejected.events).toEqual([]);
	expect(rejected.memory.contour).toBeUndefined();
});

it('binds and validates Bossa contour independently of Swing reply and recovery state', () => {
	let checkpoint: RollingBackingCheckpoint | undefined;
	for (let bar = 0; bar < 4; bar++) checkpoint = advanceRollingBacking(score, checkpoint).checkpoint;
	const memory = checkpoint!.piano.contour;
	expect(memory).toBeDefined();
	for (const bad of [undefined, { ...memory, version: 2 }, { ...memory, targetMidi: 85 },
		{ ...memory, lastTopMidi: 49 }, { ...memory, phraseStartBar: 1 }, { ...memory, chorusIndex: 1 }]) {
		expect(() => advanceRollingBacking(score, rebind({ ...checkpoint!, piano: { ...checkpoint!.piano, contour: bad } } as RollingBackingCheckpoint))).toThrow(/checkpoint/);
	}
	for (const addition of [{ pianoAnswer: { version: 1, lastAnswerBar: null } }, { pianoRecovery: { version: 1, previousAnswer: null } }]) {
		expect(() => advanceRollingBacking(score, rebind({ ...checkpoint!, ...addition } as RollingBackingCheckpoint))).toThrow(/checkpoint/);
	}
	const binding = JSON.parse(score.fingerprint);
	const policy = binding.find((value: any) => value?.performanceEnergyVersion);
	expect(policy.pianoContourVersion).toBe(1);
	expect(policy.pianoAnswerVersion).toBeUndefined();
	expect(policy.pianoRecoveryVersion).toBeUndefined();
	delete policy.pianoContourVersion;
	expect(() => advanceRollingBacking(score, rebind({ ...checkpoint!, fingerprint: JSON.stringify(binding) }))).toThrow(/checkpoint/);
});
