import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildHistoricalListeningTuneSession as buildListeningTuneSession } from '../../helpers/musicality-tune-fixtures';
import { captureNativeBalladColor, proposeNativeBalladReply, advanceNativeBalladReplyMemory, validateNativeBalladReply } from '$lib/audio/backing-ballad-reply';
import { seedFrom } from '$lib/audio/generation-rng';
import * as voices from '$lib/audio/coordinated-voicing';
import * as drums from '$lib/audio/backing-drum-phrases';
import * as timing from '$lib/audio/ensemble-timing';

const { phrase } = buildListeningTuneSession({ tuneId: 'ls-when-the-saints', key: 'D', soloChoruses: 2 });
const params = { phraseId: phrase.id, tempo: 70, ppq: 192, beatsPerBar: 4, swing: .55,
	performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {} };
function context() {
	const score = createRollingBacking(phrase.harmony, BACKING_STYLES.ballad, params);
	let checkpoint: RollingBackingCheckpoint | undefined;
	const bars = [];
	for (let bar = 0; bar < 17; bar++) { const next = advanceRollingBacking(score, checkpoint); bars.push(next); checkpoint = next.checkpoint; }
	const prior = checkpoint!;
	const noSource = rebind({ ...prior, nativeBalladReply: { ...prior.nativeBalladReply!, previousColor: null } });
	const ordinary = advanceRollingBacking(score, noSource), actual = advanceRollingBacking(score, prior);
	const info = { ...score.bars[17], ensemble: ordinary.ensemblePlan.bars[0] };
	return { score, bars, prior, noSource, ordinary, actual, info,
		proposal: { score, bar: 17, info, evidence: 'unavailable' as const, previous: prior.nativeBalladReply,
			trace: ordinary.ensembleDevelopment.pianoMotifs[0], events: ordinary.compEvents,
			drumTrace: ordinary.ensembleDevelopment.drumPhrases[0], drumEvents: ordinary.drumEvents } };
}
function rebind(checkpoint: RollingBackingCheckpoint): RollingBackingCheckpoint {
	const { checkpointId: _id, ...contents } = checkpoint;
	return { ...contents, checkpointId: `${contents.sessionId}:${contents.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}` };
}
afterEach(() => vi.restoreAllMocks());

describe('native Ballad source and recipient admission', () => {
	it('captures one actual late independent color and rejects absent, clipped, setup or answered evidence', () => {
		const { score, bars } = context(), source = bars[16], trace = source.ensembleDevelopment.drumPhrases[0];
		const info = { ...score.bars[16], ensemble: source.ensemblePlan.bars[0] };
		expect(captureNativeBalladColor(info, trace, source.drumEvents)).toEqual(source.checkpoint.nativeBalladReply!.previousColor);
		for (const commentary of [
			{ ...trace.commentary, source: 'piano' as const }, { ...trace.commentary, transform: 'answer' as const },
			{ ...trace.commentary, sourceId: 'previous-piano' }, { ...trace.commentary, hits: [] },
			{ ...trace.commentary, hits: [...trace.commentary.hits, ...trace.commentary.hits] },
			{ ...trace.commentary, hits: trace.commentary.hits.map(hit => ({ ...hit, beatOffset: 3.5 })) }
		]) expect(captureNativeBalladColor(info, { ...trace, commentary }, source.drumEvents)).toBeNull();
		expect(captureNativeBalladColor(info, trace, source.drumEvents.filter(event => event.role !== 'commentary'))).toBeNull();
		expect(captureNativeBalladColor({ ...info, ensemble: { ...info.ensemble, drums: { ...info.ensemble.drums, allowFill: true } } }, trace, source.drumEvents)).toBeNull();
	});
	it('requires the selected whole-pad and existing native space, not an invented chord', () => {
		const { proposal } = context();
		expect(proposeNativeBalladReply(proposal)).toEqual(proposal.previous!.previousColor);
		for (const altered of [
			{ ...proposal, events: [] }, { ...proposal, events: [...proposal.events, ...proposal.events] },
			{ ...proposal, trace: { ...proposal.trace, hits: [{ b: 2, d: 1.8 }] } },
			{ ...proposal, trace: { ...proposal.trace, hits: [{ b: 0, d: 1.8 }] } },
			{ ...proposal, previous: { ...proposal.previous!, previousColor: null } },
			{ ...proposal, previous: { ...proposal.previous!, lastReplyBar: 16 } },
			{ ...proposal, evidence: 'active' as const }, { ...proposal, evidence: 'resting' as const },
			{ ...proposal, drumEvents: [proposal.previous!.previousColor!.hit] }
		]) expect(proposeNativeBalladReply(altered)).toBeUndefined();
	});
	it('preserves form, reservation, space and solo-evidence priorities', () => {
		const { proposal } = context(), plan = proposal.info.ensemble;
		const accent = { id: 'existing', targetBarIndex: 17, beatOffset: 0 as const, strength: .5, participants: ['bass', 'drums'] as const };
		for (const altered of [
			{ ...plan, phraseStartBar: 17 }, { ...plan, coordinatedAccent: accent }, { ...plan, setupFor: accent }, { ...plan, responseOwner: 'drums' as const },
			{ ...plan, intent: 'release' as const }, { ...plan, phraseIntent: 'leave_space' as const },
			{ ...plan, drums: { ...plan.drums, allowFill: true } },
			{ ...plan, piano: { ...plan.piano, maxAttacks: 0 as const } },
			{ ...plan, performanceEnergy: { ...plan.performanceEnergy!, phase: 'solo_peak' as const } }
		]) expect(proposeNativeBalladReply({ ...proposal, info: { ...proposal.info, ensemble: altered } })).toBeUndefined();
		for (const field of ['isSectionFirstBar', 'isSectionFinalBar', 'isChorusFirstBar', 'isChorusFinalBar', 'isFinalBar'] as const)
			expect(proposeNativeBalladReply({ ...proposal, info: { ...proposal.info, [field]: true } })).toBeUndefined();
		const segment = proposal.score.harmony[0];
		const harmony = [{ ...segment, startOffset: [17, 1] as [number, number], duration: [1, 2] as [number, number] },
			{ ...segment, startOffset: [35, 2] as [number, number], duration: [1, 2] as [number, number] }];
		expect(proposeNativeBalladReply({ ...proposal, score: { ...proposal.score, harmony } })).toBeUndefined();
	});
});

describe('native Ballad accepted-only transaction and provenance', () => {
	it('commits the real late pad and retains exact bass/drum events and truthful histories', () => {
		const { prior, ordinary, actual } = context();
		expect(actual.compEvents).toHaveLength(1); expect(actual.compEvents[0].absBeat).toBe(70);
		expect(actual.compEvents[0].velocity).toBe(ordinary.compEvents[0].velocity - 2);
		expect(actual.compEvents[0].notes).toEqual(ordinary.compEvents[0].notes);
		expect(actual.bassEvents).toEqual(ordinary.bassEvents); expect(actual.drumEvents).toEqual(ordinary.drumEvents);
		expect(actual.checkpoint.piano.voicing?.notes).toEqual(actual.compEvents[0].notes);
		expect(actual.checkpoint.drums.previousCompOnsets).toEqual([2]);
		expect(actual.checkpoint.nativeBalladReply).toEqual({ version: 1, previousColor: null, lastReplyBar: 17 });
		expect(actual.ensembleDevelopment.nativeBalladReplies).toEqual([{ version: 1, profile: 'ballad-late-pad-v1', barIndex: 17,
			source: prior.nativeBalladReply!.previousColor, attack: actual.compEvents[0], drumCommentary: 'space' }]);
		for (const field of ['contour', 'phraseRecall']) expect(actual.checkpoint.piano).not.toHaveProperty(field);
		for (const field of ['pianoAnswer', 'pianoRecovery']) expect(actual.checkpoint).not.toHaveProperty(field);
		for (const field of ['previousCompIsSharedArrival', 'previousCompIsDrumReply']) expect(actual.checkpoint.drums).not.toHaveProperty(field);
	});
	it('keeps the whole ordinary result if the late candidate is clipped', () => {
		const { score, prior, ordinary } = context(), restore = timing.restoreEnsembleTiming;
		vi.spyOn(timing, 'restoreEnsembleTiming').mockImplementation(input => {
			const result = restore(input);
			return { ...result, place: (beat, role) => beat === 70 && role === 'comp' ? 72 * 192 : result.place(beat, role) };
		});
		const actual = advanceRollingBacking(score, prior);
		for (const field of ['compEvents', 'bassEvents', 'drumEvents'] as const) expect(actual[field]).toEqual(ordinary[field]);
		for (const field of ['piano', 'bass', 'drums'] as const) expect(actual.checkpoint[field]).toEqual(ordinary.checkpoint[field]);
		expect(actual.checkpoint.nativeBalladReply?.lastReplyBar).toBeNull(); expect(actual.ensembleDevelopment.nativeBalladReplies).toBeUndefined();
	});
	it('keeps ordinary histories when the candidate voicing fails', () => {
		const { score, prior, ordinary } = context(), resolve = voices.resolveCoordinatedVoicing; let calls = 0;
		vi.spyOn(voices, 'resolveCoordinatedVoicing').mockImplementation(input => {
			const result = resolve(input); return ++calls === 2 ? { ...result, notes: [] } : result;
		});
		const actual = advanceRollingBacking(score, prior);
		expect(calls).toBe(2);
		for (const field of ['piano', 'bass', 'drums'] as const) expect(actual.checkpoint[field]).toEqual(ordinary.checkpoint[field]);
		expect(actual.compEvents).toEqual(ordinary.compEvents); expect(actual.ensembleDevelopment.nativeBalladReplies).toBeUndefined();
	});
	it('keeps the ordinary group if moving piano would change any accepted drum event', () => {
		const { score, prior, ordinary } = context(), plan = drums.planDrumPhraseBar;
		vi.spyOn(drums, 'planDrumPhraseBar').mockImplementation((input, memory) => {
			const result = plan(input, memory);
			return input.barIndex === 17 && input.compOnsets?.includes(2)
				? { ...result, bar: { ...result.bar, hits: result.bar.hits.map((hit, index) => index ? hit : { ...hit, velocity: hit.velocity + .001 }) } } : result;
		});
		const actual = advanceRollingBacking(score, prior);
		for (const field of ['compEvents', 'bassEvents', 'drumEvents'] as const) expect(actual[field]).toEqual(ordinary[field]);
		for (const field of ['piano', 'bass', 'drums'] as const) expect(actual.checkpoint[field]).toEqual(ordinary.checkpoint[field]);
		expect(actual.ensembleDevelopment.nativeBalladReplies).toBeUndefined();
	});
	it('suppresses only reply-derived answer eligibility and retains actual onset evidence', () => {
		const { score, actual } = context(), plan = drums.planDrumPhraseBar;
		const spy = vi.spyOn(drums, 'planDrumPhraseBar');
		advanceRollingBacking(score, actual.checkpoint);
		expect(spy.mock.calls[0][0].suppressPreviousPianoAnswer).toBe(true);
		expect(spy.mock.calls[0][1]?.previousCompOnsets).toEqual([2]);
		const call = spy.mock.calls[0][0], memory = spy.mock.calls[0][1]!;
		const info = { ...call.info, ensemble: { ...call.info.ensemble!, responseOwner: 'drums' as const, drums: { ...call.info.ensemble!.drums, maxCommentaryHits: 1 as const } } };
		const ordinary = plan({ ...call, info, compOnsets: [], suppressPreviousPianoAnswer: undefined }, memory);
		const reply = plan({ ...call, info, compOnsets: [], suppressPreviousPianoAnswer: true }, memory);
		expect(ordinary.bar.commentary.source).toBe('piano'); expect(reply.bar.commentary.source).not.toBe('piano');
		expect(reply.memory.previousCompOnsets).toEqual([]);
	});
	it('expires source evidence and resets only formal-seam cooldown while preserving phrase cooldown', () => {
		const { score, prior } = context(), source = prior.nativeBalladReply!.previousColor!;
		const previous = { ...prior.nativeBalladReply!, lastReplyBar: 15 };
		const seam = { ...score, bars: score.bars.map((bar, index) => index === 17 ? { ...bar, loopIndex: 1 } : bar) };
		expect(advanceNativeBalladReplyMemory(seam, 16, previous, source, false)).toEqual({ version: 1, previousColor: null, lastReplyBar: null });
		expect(() => validateNativeBalladReply(previous, seam, 17, prior.piano.recentFigures, prior.drums.previousCompOnsets)).toThrow('checkpoint');
		const phraseBoundary = { ...score, bars: score.bars.map((bar, index) => index === 17 ? { ...bar, phrase4: { ...bar.phrase4, barIndex: 0 } } : bar) };
		expect(advanceNativeBalladReplyMemory(phraseBoundary, 16, previous, source, false)).toEqual({ version: 1, previousColor: null, lastReplyBar: 15 });
		expect(() => validateNativeBalladReply(previous, phraseBoundary, 17, prior.piano.recentFigures, prior.drums.previousCompOnsets)).toThrow('checkpoint');
		expect(advanceNativeBalladReplyMemory(score, 17, prior.nativeBalladReply, null, false).previousColor).toBeNull();
	});
	it('validates required bounded source/cooldown state and completed native provenance', () => {
		const { score, prior, actual } = context();
		for (const memory of [undefined, { ...prior.nativeBalladReply!, lastReplyBar: 100 },
			{ ...prior.nativeBalladReply!, previousColor: { ...prior.nativeBalladReply!.previousColor!, barIndex: 15 } },
			{ ...prior.nativeBalladReply!, previousColor: { ...prior.nativeBalladReply!.previousColor!, hit: { ...prior.nativeBalladReply!.previousColor!.hit, role: 'timekeeping' as const } } }
		]) expect(() => validateNativeBalladReply(memory, score, 17, prior.piano.recentFigures, prior.drums.previousCompOnsets)).toThrow('checkpoint');
		const source = prior.nativeBalladReply!.previousColor!;
		for (const hit of [{ ...source.hit, velocity: 1.1 }, { ...source.hit, velocity: NaN },
			{ ...source.hit, time: '0i' }, { ...source.hit, time: '13056i' }, { ...source.hit, absBeat: 65.5 },
			{ ...source.hit, extra: true }]) {
			const state = { ...prior.nativeBalladReply!, previousColor: { ...source, hit } };
			expect(() => advanceRollingBacking(score, rebind({ ...prior, nativeBalladReply: state }))).toThrow('checkpoint');
		}
		expect(() => advanceRollingBacking(score, rebind({ ...prior, nativeBalladReply: undefined }))).toThrow('checkpoint');
		const fingerprint = prior.fingerprint.replace(',"nativeBalladReplyVersion":1', ''); expect(fingerprint).not.toBe(prior.fingerprint);
		expect(() => advanceRollingBacking(score, rebind({ ...prior, fingerprint }))).toThrow('checkpoint');
		expect(() => advanceRollingBacking(score, rebind({ ...actual.checkpoint, nativeBalladReply: { ...actual.checkpoint.nativeBalladReply!, lastReplyBar: null } }))).toThrow('checkpoint');
		const mutable = JSON.parse(JSON.stringify(prior)), restored = advanceRollingBacking(score, mutable);
		expect(restored).toEqual(actual); expect(Object.isFrozen(mutable.nativeBalladReply.previousColor.hit)).toBe(false);
		const receipt = restored.ensembleDevelopment.nativeBalladReplies![0];
		for (const value of [receipt, receipt.source, receipt.source.hit, receipt.attack, receipt.attack.notes]) expect(Object.isFrozen(value)).toBe(true);
	});
});
