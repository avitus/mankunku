import { expect, it } from 'vitest';
import { seedFrom } from '$lib/audio/generation-rng';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildHistoricalListeningTuneSession as buildListeningTuneSession } from '../../helpers/musicality-tune-fixtures';
import baseline from '../../fixtures/audio/ballad-native-reply-before.json';

const fields = ['bassEvents', 'compEvents', 'drumEvents'] as const;
function perform(fixture: typeof baseline.cases[number]) {
	const { phrase } = buildListeningTuneSession({ tuneId: fixture.tuneId, key: fixture.key as 'D' | 'E', soloChoruses: 2 });
	const style = BACKING_STYLES.ballad;
	const params = { phraseId: phrase.id, tempo: fixture.tempo, ppq: 192, beatsPerBar: 4,
		swing: style.defaultSwing, performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {} };
	const score = createRollingBacking(phrase.harmony, style, params);
	let checkpoint: RollingBackingCheckpoint | undefined;
	const windows = [];
	for (let bar = 0; bar < score.totalBars; bar++) {
		const next = advanceRollingBacking(score, checkpoint);
		windows.push(next); checkpoint = next.checkpoint;
	}
	return { phrase, params, score, windows };
}

it.each(baseline.cases)('$tuneId $key at $tempo answers its actual independent drum color with one native late pad', fixture => {
	const take = perform(fixture);
	const source = take.windows[fixture.bar - 1];
	const reply = take.windows[fixture.bar];
	for (const field of fields) expect(source[field]).toEqual(fixture.sourceEvents[field]);
	expect(source.drumEvents).toContainEqual(fixture.source);
	expect(source.ensembleDevelopment.drumPhrases[0].commentary).toMatchObject({
		source: 'vocabulary', sourceId: 'ballad-color', transform: 'fallback'
	});
	expect(reply.compEvents).toHaveLength(1);
	expect(reply.compEvents[0].absBeat).toBe(fixture.bar * 4 + 2);
	expect(reply.compEvents[0].duration).toBeCloseTo(1.8 * 60 / fixture.tempo, 10);
	expect(reply.compEvents[0].velocity).toBe(fixture.ordinary.velocity - 2);
	expect(reply.drumEvents).toEqual(fixture.recipientEvents.drumEvents);
	expect(reply.bassEvents).toEqual(fixture.recipientEvents.bassEvents);
	expect(reply.ensembleDevelopment.drumPhrases[0].commentary.hits).toEqual([]);
});


it.each(baseline.cases)('$tuneId $key at $tempo requires its actual source and restores exact accepted native history', fixture => {
	const take = perform(fixture);
	const source = take.windows[fixture.bar - 1];
	const reply = take.windows[fixture.bar];
	const receipt = reply.ensembleDevelopment.nativeBalladReplies;
	expect(receipt).toEqual([{ version: 1, profile: 'ballad-late-pad-v1', barIndex: fixture.bar,
		source: { barIndex: fixture.bar - 1, hit: fixture.source }, attack: reply.compEvents[0], drumCommentary: 'space' }]);
	expect(advanceRollingBacking(take.score, JSON.parse(JSON.stringify(source.checkpoint)))).toEqual(reply);
	expect(advanceRollingBacking(take.score, source.checkpoint, [{ barIndex: fixture.bar + 4,
		observedAtBar: fixture.bar + 4, source: 'scripted', confidence: 1, noteDensity: 1, restBeats: 0 }])).toEqual(reply);
	const { checkpointId: _id, ...withoutId } = JSON.parse(JSON.stringify(source.checkpoint));
	withoutId.nativeBalladReply.previousColor = null;
	const missing = { ...withoutId,
		checkpointId: `${withoutId.sessionId}:${withoutId.nextBar}:${seedFrom(JSON.stringify(withoutId)).toString(16)}` };
	const ordinary = advanceRollingBacking(take.score, missing);
	for (const field of fields) expect(ordinary[field]).toEqual(fixture.recipientEvents[field]);
	expect(ordinary.ensembleDevelopment.nativeBalladReplies ?? []).toEqual([]);
	expect(reply.ensemblePlan).toEqual(ordinary.ensemblePlan);
	expect(reply.bassEvents).toEqual(ordinary.bassEvents);
	expect(reply.drumEvents).toEqual(ordinary.drumEvents);
	expect(reply.checkpoint.piano.voicing?.notes).toEqual(reply.compEvents[0].notes);
	expect(reply.checkpoint.piano).not.toHaveProperty('contour');
	expect(reply.checkpoint.piano).not.toHaveProperty('phraseRecall');
	for (const field of ['pianoAnswer', 'pianoRecovery']) expect(reply.checkpoint).not.toHaveProperty(field);
	expect(reply.checkpoint.drums.previousCompOnsets).toEqual([2]);
	expect(reply.checkpoint.nativeBalladReply).toEqual({ version: 1, previousColor: null, lastReplyBar: fixture.bar });
	let restored = JSON.parse(JSON.stringify(reply.checkpoint)) as RollingBackingCheckpoint;
	for (let bar = fixture.bar + 1; bar < take.score.totalBars; bar++) {
		const next = advanceRollingBacking(take.score, restored);
		expect(next).toEqual(take.windows[bar]);
		restored = JSON.parse(JSON.stringify(next.checkpoint));
	}
});

it.each(baseline.cases)('$tuneId $key at $tempo never treats the native reply as a fresh piano-initiated drum source across loops', fixture => {
	const take = perform(fixture);
	const score = createRollingBacking(take.phrase.harmony, BACKING_STYLES.ballad, take.params, { loopCount: 2 });
	let checkpoint: RollingBackingCheckpoint | undefined;
	const replied = new Set<number>();
	for (let bar = 0; bar < score.totalBars; bar++) {
		const window = advanceRollingBacking(score, checkpoint);
		if (bar <= fixture.bar) {
			for (const field of fields) expect(window[field]).toEqual(take.windows[bar][field]);
		}
		for (const receipt of window.ensembleDevelopment.nativeBalladReplies ?? []) {
			expect(receipt.source.barIndex).toBe(bar - 1);
			expect(window.compEvents).toEqual([receipt.attack]);
			expect(window.sourceBarIndex).not.toBe(0);
			expect(score.bars[bar - 1].loopIndex).toBe(score.bars[bar].loopIndex);
			replied.add(bar);
		}
		const commentary = window.ensembleDevelopment.drumPhrases[0].commentary;
		if (commentary.source === 'piano') expect(replied.has(commentary.sourceBar!)).toBe(false);
		if ([fixture.bar, take.score.totalBars - 1, take.score.totalBars].includes(bar)) {
			expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(window.checkpoint))))
				.toEqual(advanceRollingBacking(score, window.checkpoint));
		}
		checkpoint = window.checkpoint;
	}
	expect(replied.has(fixture.bar)).toBe(true);
});
