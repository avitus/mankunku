import { afterEach, expect, it, vi } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildHistoricalListeningTuneSession as buildListeningTuneSession } from '../../helpers/musicality-tune-fixtures';
import * as recoveryPolicy from '$lib/audio/backing-piano-recovery';
import * as drumPhrases from '$lib/audio/backing-drum-phrases';
import { seedFrom } from '$lib/audio/generation-rng';
import type { BarInfo } from '$lib/audio/backing-generation';

afterEach(() => vi.restoreAllMocks());
const { phrase } = buildListeningTuneSession({ tuneId: 'ls-when-the-saints', key: 'F#', soloChoruses: 2 });
const score = createRollingBacking(phrase.harmony, BACKING_STYLES.swing, {
	phraseId: phrase.id, tempo: 140, ppq: 192, swing: 0.67, beatsPerBar: 4,
	performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {}
});
let prior: RollingBackingCheckpoint | undefined;
for (let bar = 0; bar < 19; bar++) prior = advanceRollingBacking(score, prior).checkpoint;
const actual = advanceRollingBacking(score, prior);
const receipt = actual.ensembleDevelopment.pianoRecoveries![0];
const info: BarInfo = { ...score.bars[19], ensemble: actual.ensemblePlan.bars[0], intensity: actual.ensemblePlan.bars[0].energy };
const ordinaryAttack = { ...prior!.pianoRecovery!.previousAnswer!.attack, absBeat: 76, time: `${76 * 192}i` };
const input = { barIndex: 19, info, currentMaxAttacks: 1 as const, previous: prior!.pianoRecovery,
	ordinaryAttacks: [ordinaryAttack], returningDrums: receipt.returningDrums };
function rebind(checkpoint: RollingBackingCheckpoint): RollingBackingCheckpoint {
	const { checkpointId: _, ...contents } = checkpoint;
	return { ...contents, checkpointId: `${contents.sessionId}:${contents.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}` };
}

it('requires an actual immediately preceding answer, one ordinary chord and an accepted retained return', () => {
	expect(recoveryPolicy.planPianoRecovery(input)).toMatchObject({ action: 'space', reason: 'after_drum_reply', originalMaxAttacks: 1, effectiveMaxAttacks: 0 });
	expect(recoveryPolicy.planPianoRecovery({ ...input, previous: undefined })).toBeUndefined();
	expect(recoveryPolicy.planPianoRecovery({ ...input, previous: { version: 1, previousAnswer: null } })).toBeUndefined();
	expect(recoveryPolicy.planPianoRecovery({ ...input, previous: { version: 1, previousAnswer: { ...receipt.source, barIndex: 17 } } })).toBeUndefined();
	for (const ordinaryAttacks of [[], [ordinaryAttack, ordinaryAttack]]) {
		expect(recoveryPolicy.planPianoRecovery({ ...input, ordinaryAttacks })).toMatchObject({ action: 'none', reason: 'no_ordinary_attack' });
	}
	expect(recoveryPolicy.planPianoRecovery({ ...input, returningDrums: null })).toMatchObject({ action: 'none', reason: 'no_drum_return' });
});

it('protects phase/phrase/form anchors, assigned responses and all existing silence priorities', () => {
	const plan = info.ensemble!;
	const accent = { id: 'protected-arrival', targetBarIndex: 19, beatOffset: 0 as const, strength: 0.5, participants: ['bass', 'drums'] as const };
	for (const phase of ['head_in', 'head_return', 'solo_peak', 'solo_release', 'ending'] as const) {
		expect(recoveryPolicy.planPianoRecovery({ ...input, info: { ...info, ensemble: { ...plan, performanceEnergy: { ...plan.performanceEnergy!, phase } } } }))
			.toMatchObject({ action: 'none', reason: 'outside_build' });
	}
	for (const flag of ['isSectionFirstBar', 'isChorusFirstBar', 'isSectionFinalBar', 'isChorusFinalBar', 'isFinalBar'] as const) {
		expect(recoveryPolicy.planPianoRecovery({ ...input, info: { ...info, [flag]: true } }))
			.toMatchObject({ action: 'none', reason: 'reserved_transition' });
	}
	for (const ensemble of [{ ...plan, phraseStartBar: 19 }, { ...plan, coordinatedAccent: accent }, { ...plan, setupFor: accent },
		{ ...plan, drums: { ...plan.drums, allowFill: true } }]) {
		expect(recoveryPolicy.planPianoRecovery({ ...input, info: { ...info, ensemble } }))
			.toMatchObject({ action: 'none', reason: 'reserved_transition' });
	}
	expect(recoveryPolicy.planPianoRecovery({ ...input, info: { ...info, ensemble: { ...plan, responseOwner: 'piano' } } }))
		.toMatchObject({ action: 'none', reason: 'response_reserved' });
	expect(recoveryPolicy.planPianoRecovery({ ...input, currentMaxAttacks: 0 }))
		.toMatchObject({ action: 'none', reason: 'higher_priority_space', effectiveMaxAttacks: 0 });
	expect(recoveryPolicy.planPianoRecovery({ ...input, info: { ...info, ensemble: { ...plan, piano: { ...plan.piano, maxAttacks: 0 } } }, currentMaxAttacks: 0 }))
		.toMatchObject({ action: 'none', reason: 'already_silent', effectiveMaxAttacks: 0 });
	expect(recoveryPolicy.planPianoRecovery({ ...input, info: { ...info, ensemble: { ...plan, phraseIntent: 'leave_space' } } }))
		.toMatchObject({ action: 'none', reason: 'higher_priority_space' });
});

it('matches actual whole returning vocabulary cells and refuses timekeeping, new sources or partial cells', () => {
	const decision = actual.ensembleDevelopment.drumPhrases[0];
	const held = prior!.drums.phrase.motif;
	expect(recoveryPolicy.captureReturningDrums(decision, actual.drumEvents, held)).toEqual(receipt.returningDrums);
	expect(recoveryPolicy.captureReturningDrums(decision, [], held)).toBeNull();
	expect(recoveryPolicy.captureReturningDrums(decision, actual.drumEvents.filter(event => event.role === 'timekeeping'), held)).toBeNull();
	expect(recoveryPolicy.captureReturningDrums(decision, actual.drumEvents.filter(event => event.absBeat !== 77.5), held)).toBeNull();
	for (const transform of ['statement', 'answer', 'fallback', 'setup', 'space'] as const) {
		expect(recoveryPolicy.captureReturningDrums({ ...decision, commentary: { ...decision.commentary, transform } }, actual.drumEvents, held)).toBeNull();
	}
	expect(recoveryPolicy.captureReturningDrums({ ...decision, commentary: { ...decision.commentary, source: 'piano' } }, actual.drumEvents, held)).toBeNull();
	expect(recoveryPolicy.captureReturningDrums({ ...decision, commentary: { ...decision.commentary, motifId: 'different' } }, actual.drumEvents, held)).toBeNull();
	expect(recoveryPolicy.captureReturningDrums(decision, actual.drumEvents, undefined)).toBeNull();
});

it('rolls back the proposed silence if re-realizing from actual empty onsets loses the accepted drum return', () => {
	const suppress = vi.spyOn(recoveryPolicy, 'planPianoRecovery').mockReturnValue(undefined);
	const ordinary = advanceRollingBacking(score, prior);
	suppress.mockRestore();
	expect(ordinary.compEvents.map(event => event.absBeat)).toEqual([76]);
	const original = drumPhrases.planDrumPhraseBar;
	let calls = 0;
	vi.spyOn(drumPhrases, 'planDrumPhraseBar').mockImplementation((input, memory) => {
		const result = original(input, memory);
		calls++;
		return calls === 2 ? { ...result, bar: { ...result.bar, hits: result.bar.hits.filter(hit => hit.role !== 'commentary') } } : result;
	});
	const rejected = advanceRollingBacking(score, prior);
	expect(calls).toBe(2);
	for (const field of ['compEvents', 'bassEvents', 'drumEvents', 'checkpoint', 'ensemblePlan'] as const) expect(rejected[field]).toEqual(ordinary[field]);
	expect(rejected.ensembleDevelopment.pianoRecoveries).toMatchObject([{ action: 'none', reason: 'no_drum_return', effectiveMaxAttacks: 1, acceptedAttacks: ordinary.compEvents }]);
});

it('retains real voiced history, expires the one-bar receipt and never fabricates a planned response', () => {
	expect(actual.compEvents).toEqual([]);
	expect(actual.checkpoint.piano.voicing).toEqual(prior!.piano.voicing);
	expect(actual.checkpoint.piano.contour).toEqual(prior!.piano.contour);
	expect(actual.checkpoint.drums.previousCompOnsets).toEqual([]);
	expect(actual.checkpoint.pianoRecovery).toEqual({ version: 1, previousAnswer: null });
	expect(actual.checkpoint.pianoAnswer).toEqual(prior!.pianoAnswer);
	expect(actual.ensemblePlan.bars[0].responseOwner).toBe('nobody');
	expect(actual.ensemblePlan.bars[0].piano.maxAttacks).toBe(1);
	expect(advanceRollingBacking(score, actual.checkpoint).ensembleDevelopment.pianoRecoveries).toBeUndefined();
	expect(Object.isFrozen(prior!.pianoRecovery!.previousAnswer!.attack.notes)).toBe(true);
});

it('validates a bounded actual reply receipt independently of numerical cooldown or recomputed checksum', () => {
	const pending = prior!.pianoRecovery!;
	for (const pianoRecovery of [undefined, { ...pending, version: 2 }, { version: 1, previousAnswer: null },
		{ ...pending, previousAnswer: { ...pending.previousAnswer!, barIndex: 17 } },
		...[
			{ absBeat: 74.25 }, { absBeat: 78.5 }, { time: '14592i' }, { duration: 2 }, { duration: NaN },
			{ velocity: 128 }, { notes: [48, 60] }
		].map(change => ({ ...pending, previousAnswer: { ...pending.previousAnswer!, attack: { ...pending.previousAnswer!.attack, ...change } } }))
	]) expect(() => advanceRollingBacking(score, rebind({ ...prior!, pianoRecovery } as RollingBackingCheckpoint))).toThrow(/checkpoint/);
	const binding = JSON.parse(score.fingerprint);
	const policy = binding.find((entry: unknown) => entry && typeof entry === 'object' && 'pianoRecoveryVersion' in entry);
	expect(policy.pianoRecoveryVersion).toBe(1);
	delete policy.pianoRecoveryVersion;
	expect(() => advanceRollingBacking(score, rebind({ ...prior!, fingerprint: JSON.stringify(binding) }))).toThrow(/checkpoint/);
});
