import { describe, expect, it } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildHistoricalListeningTuneSession as buildListeningTuneSession, HISTORICAL_LISTENING_TUNES as LISTENING_TUNES } from '../../helpers/musicality-tune-fixtures';

const session = buildListeningTuneSession({ tuneId: LISTENING_TUNES.find(tune => tune.title.includes('Saints'))!.id, key: 'C', soloChoruses: 2 });
const params = { phraseId: session.phrase.id, tempo: 140, ppq: 192, beatsPerBar: 4,
	performanceForm: session.phrase.performanceForm, sectionMap: session.phrase.sectionMap, ensemble: {} };

describe('real-tune drum-to-piano feedback', () => {
	it.each(['swing', 'straight'] as const)('%s leaves room for a previously emitted drum phrase in Saints', id => {
		const style = BACKING_STYLES[id];
		const score = createRollingBacking(session.phrase.harmony, style, { ...params, swing: style.defaultSwing });
		let checkpoint: RollingBackingCheckpoint | undefined;
		let previous;
		for (let bar = 0; bar < 35; bar++) {
			previous = advanceRollingBacking(score, checkpoint);
			checkpoint = previous.checkpoint;
		}
		const drumPhrase = previous!.ensembleDevelopment.drumPhrases[0];
		expect(drumPhrase.commentary).toMatchObject({ source: 'vocabulary', transform: 'statement' });
		expect(drumPhrase.commentary.hits.map(hit => hit.beatOffset)).toEqual([1.5, 3.5]);
		for (const hit of drumPhrase.commentary.hits) expect(previous!.drumEvents).toContainEqual(expect.objectContaining({
			drum: hit.drum, absBeat: 34 * 4 + hit.beatOffset, velocity: hit.velocity, role: 'commentary'
		}));
		const next = advanceRollingBacking(score, checkpoint);
		expect(next.ensemblePlan.bars[0].piano.maxAttacks).toBe(1);
		// The old committed engine emitted one quartal attack at beat 142.5.
		// A whole-bar breath is an actual event change, not a lower unused cap.
		expect(next.compEvents).toHaveLength(0);
		expect(next.ensembleDevelopment.pianoFeedback![0]).toMatchObject({ barIndex: 35, action: 'yield', reason: 'drum_statement',
			originalMaxAttacks: 1, effectiveMaxAttacks: 0, acceptedAttacks: [], source: { barIndex: 34, transform: 'statement' } });
		for (const hit of next.ensembleDevelopment.pianoFeedback![0].source!.hits) expect(previous!.drumEvents).toContainEqual(hit);
		expect(next.checkpoint.piano.voicing).toEqual(checkpoint!.piano.voicing);
		expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(checkpoint)))).toEqual(next);
		expect(advanceRollingBacking(score, checkpoint, [{ barIndex: 37, observedAtBar: 37,
			source: 'scripted', confidence: 1, noteDensity: 1, restBeats: 0 }])).toEqual(next);

	});
});


it('does not react when an actual dense soloist suppresses the source drum phrase', () => {
	const score = createRollingBacking(session.phrase.harmony, BACKING_STYLES.swing, { ...params, swing: BACKING_STYLES.swing.defaultSwing });
	let checkpoint: RollingBackingCheckpoint | undefined;
	for (let bar = 0; bar < 34; bar++) checkpoint = advanceRollingBacking(score, checkpoint).checkpoint;
	const source = advanceRollingBacking(score, checkpoint, [{ barIndex: 34, observedAtBar: 34,
		source: 'scripted', confidence: 1, noteDensity: 1, restBeats: 0 }]);
	expect(source.drumEvents.filter(event => event.role === 'commentary')).toEqual([]);
	expect(source.checkpoint.feedback!.previousDrumStatement).toBeNull();
	const next = advanceRollingBacking(score, source.checkpoint);
	expect(next.ensembleDevelopment.pianoFeedback![0]).toMatchObject({ action: 'none', reason: 'no_statement', source: null });
	expect(next.compEvents).toHaveLength(1);
});

it.each(['swing', 'straight', 'bossa-nova', 'ballad'] as const)('%s preserves the shared source prefix and JSON history through a real-tune loop seam', id => {
	const style = BACKING_STYLES[id];
	const two = createRollingBacking(session.phrase.harmony, style, { ...params, swing: style.defaultSwing }, { loopCount: 2 });
	const three = createRollingBacking(session.phrase.harmony, style, { ...params, swing: style.defaultSwing }, { loopCount: 3 });
	let left: RollingBackingCheckpoint | undefined, right: RollingBackingCheckpoint | undefined;
	let previous: ReturnType<typeof advanceRollingBacking> | undefined;
	let yields = 0, lastYield = -Infinity;
	for (let bar = 0; bar < two.sourceBars + 8; bar++) {
		const a = advanceRollingBacking(two, left), b = advanceRollingBacking(three, right);
		expect(advanceRollingBacking(two, left ? JSON.parse(JSON.stringify(left)) : undefined)).toEqual(a);
		for (const field of ['bassEvents', 'compEvents', 'drumEvents', 'ensemblePlan', 'ensembleTiming', 'ensembleDevelopment'] as const)
			expect(a[field], `bar ${bar} ${field}`).toEqual(b[field]);
		const feedback = a.ensembleDevelopment.pianoFeedback![0];
		expect(feedback.acceptedAttacks).toEqual(a.compEvents.map(({ time, absBeat, notes }) => ({ time, absBeat, notes })));
		if (feedback.source) {
			expect(feedback.source.barIndex).toBe(bar - 1);
			for (const hit of feedback.source.hits) {
				expect(hit.role).toBe('commentary');
				expect(previous!.drumEvents).toContainEqual(hit);
			}
		}
		if (feedback.action === 'yield') {
			expect(a.compEvents).toEqual([]);
			expect(bar - lastYield).toBeGreaterThanOrEqual(3);
			expect(a.ensemblePlan.bars[0].responseOwner).toBe('nobody');
			expect(two.bars[bar].isSectionFirstBar).toBe(false);
			expect(two.bars[bar].isChorusFirstBar).toBe(false);
			lastYield = bar; yields++;
		}
		if (id === 'bossa-nova') expect(feedback.source).toBeNull();
		left = a.checkpoint; right = b.checkpoint; previous = a;
	}
	if (id === 'swing' || id === 'straight') expect(yields).toBeGreaterThan(0);
});
