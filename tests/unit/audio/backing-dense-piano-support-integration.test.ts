import { assertBassHandoffDelta } from './bass-handoff-assertions';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { generateBacking, type CompEvent } from '$lib/audio/backing-generation';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildHistoricalListeningTuneSession as buildListeningTuneSession } from '../../helpers/musicality-tune-fixtures';
import type { SoloFeature } from '$lib/audio/ensemble-plan';
import baseline from '../../fixtures/audio/dense-piano-support-before.json';

const styles = ['swing', 'straight', 'bossa-nova', 'ballad'] as const;
type StyleId = typeof styles[number];
type Trajectory = 'none' | 'active' | 'dense';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const noPitches = (events: readonly CompEvent[]) => events.map(({ notes: _notes, ...event }) => event);
const session = buildListeningTuneSession({ tuneId: 'ls-mankunku-blues', key: 'Eb', soloChoruses: 2 });

function observations(trajectory: Trajectory): SoloFeature[] {
	if (trajectory === 'none') return [];
	return session.bars.flatMap((bar, index) => bar.context.role === 'solo' && session.bars[index - 1]?.context.role === 'solo'
		? [{ barIndex: index, observedAtBar: index - 1, source: 'scripted' as const, confidence: .95,
			noteDensity: trajectory === 'dense' ? .9 : .6, restBeats: 0 }] : []);
}
function parameters(style: StyleId, features: readonly SoloFeature[]) {
	return { phraseId: session.phrase.id, tempo: 140, ppq: 192, beatsPerBar: 4,
		swing: BACKING_STYLES[style].defaultSwing, sectionMap: session.phrase.sectionMap,
		performanceForm: session.phrase.performanceForm, ensemble: { soloFeatures: features } };
}
function rolling(style: StyleId, features: readonly SoloFeature[]) {
	const definition = createRollingBacking(session.phrase.harmony, BACKING_STYLES[style], parameters(style, features));
	let checkpoint: RollingBackingCheckpoint | undefined;
	const windows = [];
	for (let bar = 0; bar < definition.totalBars; bar++) {
		const window = advanceRollingBacking(definition, checkpoint, features);
		windows.push(window);
		checkpoint = window.checkpoint;
	}
	return { definition, windows, compEvents: windows.flatMap(w => w.compEvents),
		bassEvents: windows.flatMap(w => w.bassEvents), drumEvents: windows.flatMap(w => w.drumEvents) };
}

it.each(styles)('%s thins a naturally retained real-tune dense boundary chord without changing its attack or pulse', style => {
	const features = observations('dense');
	const fixed = generateBacking(session.phrase.harmony, BACKING_STYLES[style], parameters(style, features));
	const rolled = rolling(style, features);
	for (const engine of ['fixed', 'rolling'] as const) {
		const old = baseline.cases.find(c => c.style === style && c.trajectory === 'dense' && c.engine === engine)!;
		const current = engine === 'fixed' ? fixed : rolled;
		const actual = engine === 'rolling' && (style === 'swing' || style === 'straight')
			? { ...current, bassEvents: assertBassHandoffDelta(current.bassEvents, rolled.windows, session.phrase.harmony, `BluesEb-${style}-dense`) } : current;
		const trace = engine === 'fixed' ? fixed.ensembleDevelopment!.pianoVoicings!
			: rolled.windows.flatMap(w => w.ensembleDevelopment.pianoVoicings ?? []);
		const plan = engine === 'fixed' ? fixed.ensemblePlan!.bars[25] : rolled.windows[25].ensemblePlan.bars[0];
		expect(plan.boundaryStrength).toBe(.85);
		expect(plan.piano.maxAttacks).toBe(1);
		expect(plan.drums.maxCommentaryHits).toBe(0);
		const survivor = actual.compEvents.filter(event => Math.floor(event.absBeat / 4) === 25);
		expect(survivor).toHaveLength(1);
		expect(old.witness).toHaveLength(1);
		expect(old.witness[0].notes).toHaveLength(3);
		expect(noPitches(survivor)).toEqual(noPitches(old.witness));
		// Swing/Straight anticipate Eb7; native Bossa/Ballad still sound Bb7.
		const definingTones = style === 'swing' || style === 'straight' ? [1, 7] : [2, 8];
		expect(survivor[0].notes).toHaveLength(2);
		expect(plan.piano.rootlessTexture).toEqual({ request: 'two', reason: 'dense_soloist' });
		expect(survivor[0].notes.map(note => note % 12).sort((a, b) => a - b)).toEqual(definingTones);
		expect(trace.find(t => t.time === survivor[0].time && t.absBeat === survivor[0].absBeat)).toMatchObject({
			notes: survivor[0].notes, decision: { requestedFamily: 'rootless-a', resolvedFamily: 'rootless-a',
				rootlessTexture: { request: 'two', applied: 'two', eligible: true, noteCount: 2 } }
		});
		for (const field of ['bassEvents', 'drumEvents'] as const) expect(hash(actual[field])).toBe(old.expected[field]);
		expect(hash(noPitches(actual.compEvents))).toBe(old.expected.compNonPitches);
		expect(hash(trace.map(t => [t.decision.requestedFamily, t.decision.resolvedFamily]))).toBe(old.expected.families);
	}
	// Dense restraint still leaves ordinary bars silent, without latching fictitious chords.
	const silent = rolled.windows.filter(w => w.ensemblePlan.bars[0].piano.maxAttacks === 0);
	expect(silent.length).toBeGreaterThan(0);
	for (const window of silent) {
		expect(window.compEvents).toEqual([]);
		expect(window.ensembleDevelopment.pianoVoicings).toEqual([]);
		if (window.fromBar > 0) expect(window.checkpoint.piano.voicing).toEqual(rolled.windows[window.fromBar - 1].checkpoint.piano.voicing);
	}
});

it.each(styles)('%s preserves old no-observation and active performances outside verified bass handoffs', style => {
	for (const trajectory of ['none', 'active'] as const) {
		const features = observations(trajectory);
		const fixed = generateBacking(session.phrase.harmony, BACKING_STYLES[style], parameters(style, features));
		const rolled = rolling(style, features);
		for (const engine of ['fixed', 'rolling'] as const) {
			const old = baseline.cases.find(c => c.style === style && c.trajectory === trajectory && c.engine === engine)!;
			const current = engine === 'fixed' ? fixed : rolled;
			const actual = engine === 'rolling' && (style === 'swing' || style === 'straight')
				? { ...current, bassEvents: assertBassHandoffDelta(current.bassEvents, rolled.windows, session.phrase.harmony, `BluesEb-${style}-${trajectory}`) } : current;
			for (const field of ['compEvents', 'bassEvents', 'drumEvents'] as const) expect(hash(actual[field])).toBe(old.expected[field]);
		}
	}
});

it.each(styles)('%s commits only actual dense voicings and restores their causal history exactly', style => {
	const features = observations('dense');
	const take = rolling(style, features);
	const checkpoint = take.windows[25].checkpoint;
	expect(checkpoint.piano.voicing!.notes).toEqual(take.windows[25].compEvents[0].notes);
	expect(checkpoint.piano.voicing!.notes).toHaveLength(2);
	let restored: RollingBackingCheckpoint = JSON.parse(JSON.stringify(checkpoint));
	for (let bar = 26; bar < take.definition.totalBars; bar++) {
		const next = advanceRollingBacking(take.definition, restored, features);
		expect(next).toEqual(take.windows[bar]);
		restored = next.checkpoint;
	}
	const prefix = take.windows[23].checkpoint;
	const delivered = features.filter(f => f.barIndex <= 24);
	expect(advanceRollingBacking(take.definition, prefix, features)).toEqual(advanceRollingBacking(take.definition, prefix, delivered));
	const none = rolling(style, []);
	for (const feature of [
		{ barIndex: 25, observedAtBar: 26, confidence: .95, noteDensity: .9, restBeats: 0 },
		{ barIndex: 25, observedAtBar: 22, confidence: .95, noteDensity: .9, restBeats: 0 },
		{ barIndex: 25, observedAtBar: 24, confidence: .3, noteDensity: .9, restBeats: 0 },
		{ barIndex: 25, observedAtBar: 24, confidence: .95, noteDensity: -1, restBeats: 0 }
	]) {
		const unchanged = advanceRollingBacking(none.definition, none.windows[24].checkpoint, [{ ...feature, source: 'scripted' }]);
		for (const field of ['compEvents', 'bassEvents', 'drumEvents'] as const) expect(unchanged[field]).toEqual(none.windows[25][field]);
	}
});

it.each(styles)('%s retains accepted voicing history across a loop seam and its JSON restoration', style => {
	const onePass = observations('dense');
	const features = [ ...onePass, ...onePass.map(feature => ({ ...feature,
		barIndex: feature.barIndex + 52, observedAtBar: feature.observedAtBar + 52 })) ];
	const score = createRollingBacking(session.phrase.harmony, BACKING_STYLES[style], parameters(style, features), { loopCount: 2 });
	let checkpoint: RollingBackingCheckpoint | undefined;
	let restored: RollingBackingCheckpoint | undefined;
	for (let bar = 0; bar < score.totalBars; bar++) {
		const actual = advanceRollingBacking(score, checkpoint, features);
		if (bar === 52) restored = JSON.parse(JSON.stringify(checkpoint));
		if (bar >= 52) {
			const resumed = advanceRollingBacking(score, restored, features);
			expect(resumed).toEqual(actual);
			restored = resumed.checkpoint;
		}
		if (actual.compEvents.length) expect(actual.checkpoint.piano.voicing!.notes).toEqual(actual.compEvents.at(-1)!.notes);
		else if (checkpoint) expect(actual.checkpoint.piano.voicing).toEqual(checkpoint.piano.voicing);
		if (bar === 52) {
			expect(actual.sourceBarIndex).toBe(0);
			expect(actual.loopIndex).toBe(1);
			expect(actual.ensemblePlan.bars[0].piano.rootlessTexture?.reason).not.toBe('dense_soloist');
		}
		checkpoint = actual.checkpoint;
	}
	expect(checkpoint!.nextBar).toBe(104);
	expect(checkpoint).toEqual(restored);
});
