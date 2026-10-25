import { describe, expect, it } from 'vitest';
import { aggregateRollingBacking } from '$lib/audio/backing-rolling-take';
import { createRollingBackingRenderer } from '$lib/audio/backing-rolling-renderer';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildListeningTuneSession, LISTENING_TUNES } from '$lib/musicality/listening-tunes';

const phrase = buildListeningTuneSession({ tuneId: LISTENING_TUNES[0].id, soloChoruses: 2 }).phrase;

function harness() {
	const definition = createRollingBacking(phrase.harmony, BACKING_STYLES.swing, {
		phraseId: phrase.id, tempo: 140, ppq: 192, beatsPerBar: 4, swing: 0.67,
		performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {}
	});
	let eventId = 0;
	const renderer = createRollingBackingRenderer({ sessionId: definition.sessionId, tempo: definition.tempo,
		ppq: definition.ppq, totalBars: definition.totalBars, startAudioTime: 100 }, {
		audioNow: () => 0, lookAhead: () => 0.1, updateInterval: () => 0.025, isCurrent: () => true,
		scheduleOnce: () => ++eventId, clear: () => {}, play: () => () => {}, publishSchedule: () => {}
	});
	let checkpoint: RollingBackingCheckpoint | undefined;
	return { renderer, append() {
		const bar = advanceRollingBacking(definition, checkpoint);
		expect(renderer.commit(bar).accepted).toBe(true);
		checkpoint = bar.checkpoint;
		return bar;
	} };
}

describe('committed rolling take aggregation', () => {
	it('contains actual accepted notes and every decision for the committed prefix, with no future score', () => {
		const h = harness(); h.append(); h.append();
		const snapshot = h.renderer.snapshot();
		const take = aggregateRollingBacking(snapshot);
		expect(snapshot.generated.bassEvents.length).toBeGreaterThan(0);
		expect(take.bassEvents).toEqual(snapshot.generated.bassEvents);
		expect(take.compEvents).toEqual(snapshot.generated.compEvents);
		expect(take.drumEvents).toEqual(snapshot.generated.drumEvents);
		expect(take.ensemblePlan!.bars).toEqual(snapshot.windows.flatMap((bar) => bar.ensemblePlan.bars));
		expect(take.ensemblePlan!.trace).toEqual(snapshot.windows.flatMap((bar) => bar.ensemblePlan.trace));
		expect(take.ensembleMemory).toEqual(snapshot.windows.at(-1)!.checkpoint.ensemble);
		expect(take.ensembleTiming).toEqual(snapshot.windows[0].ensembleTiming);
		expect(take.ensembleDevelopment).toEqual({ version: 1,
			pianoMotifs: snapshot.windows.flatMap((bar) => bar.ensembleDevelopment.pianoMotifs),
			bassTurnarounds: snapshot.windows.flatMap((bar) => bar.ensembleDevelopment.bassTurnarounds),
			bassFeel: snapshot.windows.flatMap((bar) => bar.ensembleDevelopment.bassFeel ?? []),
			pianoVoicings: snapshot.windows.flatMap((bar) => bar.ensembleDevelopment.pianoVoicings ?? []),
			pianoFeedback: snapshot.windows.flatMap((bar) => bar.ensembleDevelopment.pianoFeedback ?? []),
			drumPhrases: snapshot.windows.flatMap((bar) => bar.ensembleDevelopment.drumPhrases)
		});
		expect([...take.bassEvents, ...take.compEvents, ...take.drumEvents].every((event) => event.absBeat < 8)).toBe(true);
		expect(take.ensemblePlan!.bars).toHaveLength(2);
	});

	it('keeps a prior exported prefix immutable while new committed bars and reciprocal evidence append', () => {
		const h = harness(); h.append(); h.append();
		const early = aggregateRollingBacking(h.renderer.snapshot());
		const before = JSON.stringify(early);
		for (let bar = 2; bar < 36; bar++) h.append();
		const later = aggregateRollingBacking(h.renderer.snapshot());
		expect(JSON.stringify(early)).toBe(before);
		expect(later.bassEvents.slice(0, early.bassEvents.length)).toEqual(early.bassEvents);
		expect(later.compEvents.slice(0, early.compEvents.length)).toEqual(early.compEvents);
		expect(later.drumEvents.slice(0, early.drumEvents.length)).toEqual(early.drumEvents);
		expect(later.ensemblePlan!.bars).toHaveLength(36);
		expect(later.ensembleMemory!.nextBar).toBe(36);
		expect(new Set(later.ensembleTiming!.map((trace) => trace.phraseStartBar)).size).toBe(later.ensembleTiming!.length);
		const feedback = later.ensembleDevelopment!.pianoFeedback!.find((entry) => entry.action === 'yield')!;
		expect(feedback).toBeDefined();
		for (const hit of feedback.source!.hits) expect(later.drumEvents).toContainEqual(hit);
		expect(Object.isFrozen(feedback.source!.hits[0])).toBe(true);
		expect(Object.isFrozen(later.ensemblePlan!.bars[0].piano.rootlessTexture)).toBe(true);
		expect(Object.isFrozen(later.bassEvents)).toBe(true);
		expect(Object.isFrozen(later)).toBe(true);
	});

	it('owns its exported data without freezing or mutating a restored caller snapshot', () => {
		const h = harness(); h.append();
		const restored = JSON.parse(JSON.stringify(h.renderer.snapshot()));
		const before = JSON.stringify(restored);
		const take = aggregateRollingBacking(restored);
		expect(JSON.stringify(restored)).toBe(before);
		expect(Object.isFrozen(restored.generated.bassEvents[0])).toBe(false);
		restored.generated.bassEvents[0].midi = 99;
		expect(take.bassEvents[0].midi).not.toBe(99);
	});

	it('preserves optional scalar-continuation evidence as an owned immutable committed prefix', () => {
		const h = harness(); h.append(); h.append();
		const early = aggregateRollingBacking(h.renderer.snapshot());
		const before = JSON.stringify(early);
		const restored = JSON.parse(JSON.stringify(h.renderer.snapshot()));
		const notes = restored.generated.bassEvents.slice(0, 3).map(({ absBeat, time, midi }: { absBeat: number; time: string; midi: number }) => ({ absBeat, time, midi }));
		const evidence = [{ barIndex: 1, boundaryAbsBeat: 4, direction: 'up', notes }];
		restored.windows[1].ensembleDevelopment.bassContinuations = evidence;
		const exported = aggregateRollingBacking(restored);
		expect(exported.ensembleDevelopment!.bassContinuations).toEqual(evidence);
		expect(Object.isFrozen(exported.ensembleDevelopment!.bassContinuations)).toBe(true);
		expect(Object.isFrozen(exported.ensembleDevelopment!.bassContinuations![0].notes[0])).toBe(true);
		expect(Object.isFrozen(evidence[0].notes[0])).toBe(false);
		evidence[0].notes[0].midi = 99;
		expect(exported.ensembleDevelopment!.bassContinuations![0].notes[0].midi).not.toBe(99);
		expect(JSON.stringify(early)).toBe(before);
		expect(early.ensembleDevelopment!.bassContinuations).toBeUndefined();
	});

	it('owns accepted piano answer receipts and their source notes without extending an earlier export', () => {
		const h = harness(); h.append(); h.append();
		const early = aggregateRollingBacking(h.renderer.snapshot());
		const restored = JSON.parse(JSON.stringify(h.renderer.snapshot()));
		const answer = { version: 1, barIndex: 1, source: { barIndex: 0, transform: 'statement', hits: [
			{ absBeat: 1.5, time: '288i', drum: 'snare', velocity: .3, role: 'commentary' },
			{ absBeat: 3.5, time: '672i', drum: 'snare', velocity: .3, role: 'commentary' }
		] }, attack: { absBeat: 6.5, time: '1248i', notes: [62, 65, 69], duration: .2, velocity: 60 },
			replyOffset: 2.5, drumCommentary: 'space' };
		restored.windows[1].ensembleDevelopment.pianoAnswers = [answer];
		const result = aggregateRollingBacking(restored);
		expect(result.ensembleDevelopment!.pianoAnswers).toEqual([answer]);
		const accepted = result.ensembleDevelopment!.pianoAnswers![0];
		expect(Object.isFrozen(accepted.source.hits[0])).toBe(true);
		expect(Object.isFrozen(accepted.attack.notes)).toBe(true);
		expect(Object.isFrozen(accepted)).toBe(true);
		answer.source.hits[0].velocity = .9; answer.attack.notes[0] = 99;
		expect(accepted.source.hits[0].velocity).toBe(.3);
		expect(accepted.attack.notes[0]).toBe(62);
		expect(early.ensembleDevelopment!.pianoAnswers).toBeUndefined();
	});

	it('owns recovery receipts and actual returned drum hits without rewriting an earlier export', () => {
		const h = harness(); h.append(); h.append();
		const early = aggregateRollingBacking(h.renderer.snapshot());
		const restored = JSON.parse(JSON.stringify(h.renderer.snapshot()));
		const recovery = { version: 1, barIndex: 1, source: { barIndex: 0,
			attack: { absBeat: 2.5, time: '480i', notes: [62, 65, 69], duration: .2, velocity: 60 } },
			returningDrums: { motifId: 'drum:0', sourceBar: 0, hits: [{ absBeat: 5.5, time: '1056i', drum: 'snare', velocity: .3, role: 'commentary' }] },
			action: 'space', reason: 'after_drum_reply', originalMaxAttacks: 1, effectiveMaxAttacks: 0, acceptedAttacks: [] };
		restored.windows[1].ensembleDevelopment.pianoRecoveries = [recovery];
		const result = aggregateRollingBacking(restored);
		expect(result.ensembleDevelopment!.pianoRecoveries).toEqual([recovery]);
		const accepted = result.ensembleDevelopment!.pianoRecoveries![0];
		expect(Object.isFrozen(accepted.source.attack.notes)).toBe(true);
		expect(Object.isFrozen(accepted.returningDrums!.hits[0])).toBe(true);
		expect(Object.isFrozen(accepted.acceptedAttacks)).toBe(true);
		recovery.source.attack.notes[0] = 99; recovery.returningDrums.hits[0].velocity = .9;
		expect(accepted.source.attack.notes[0]).toBe(62);
		expect(accepted.returningDrums!.hits[0].velocity).toBe(.3);
		expect(early.ensembleDevelopment!.pianoRecoveries).toBeUndefined();
	});

	it('exports an empty committed prefix without fabricating a plan or final checkpoint', () => {
		const take = aggregateRollingBacking(harness().renderer.snapshot());
		expect(take).toEqual({ bassEvents: [], compEvents: [], drumEvents: [] });
		expect(Object.isFrozen(take)).toBe(true);
	});

	it('rejects mismatched windows and future ledger events rather than exporting uncommitted claims', () => {
		const h = harness(); h.append();
		const snapshot = h.renderer.snapshot();
		expect(() => aggregateRollingBacking({ ...snapshot, nextBar: 2 })).toThrow(/committed prefix/);
		expect(() => aggregateRollingBacking({ ...snapshot, windows: [] })).toThrow(/committed prefix/);
		expect(() => aggregateRollingBacking({ ...snapshot, windows: [{ ...snapshot.windows[0], sessionId: 'foreign' }] })).toThrow(/committed prefix/);
		expect(() => aggregateRollingBacking({ ...snapshot, generated: { ...snapshot.generated,
			bassEvents: [...snapshot.generated.bassEvents, { ...snapshot.generated.bassEvents[0], absBeat: 4, time: '768i' }] } })).toThrow(/committed prefix/);
	});
});
