import { describe, expect, it } from 'vitest';
import { generateComping, buildBarInfos, type BarInfo } from '$lib/audio/backing-generation';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildPerformanceForm } from '$lib/audio/performance-form';
import { planEnsemble } from '$lib/audio/ensemble-plan';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { realizeRollingPiano } from '$lib/audio/backing-rolling-piano';
import type { HarmonicSegment } from '$lib/types/music';
import { resolveCoordinatedVoicing, type CoordinatedVoicingMemory } from '$lib/audio/coordinated-voicing';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';
import { fractionToFloat } from '$lib/music/intervals';
import { seedFrom } from '$lib/audio/generation-rng';

const harmony: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [1, 1] },
	{ chord: { root: 'F#', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [1, 1], duration: [1, 1] },
	{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [2, 1], duration: [1, 1] }
];
const form = buildPerformanceForm({ totalBars: 3, sectionMap: [], choruses: [{ role: 'solo', startBar: 0, endBarExclusive: 3 }] });
const params = { phraseId: 'voicing-causal', tempo: 120, ppq: 192, swing: 0.67, beatsPerBar: 4, performanceForm: form, ensemble: {} };
function infos(): BarInfo[] {
	const bars = buildBarInfos(3, undefined, form);
	const plan = planEnsemble({ phraseId: params.phraseId, tempo: params.tempo, bars: bars.map((bar, barIndex) => ({ ...bar, barIndex })) });
	return bars.map((bar, index) => ({ ...bar, ensemble: { ...plan.bars[index],
		performanceEnergy: { phase: 'solo_peak', chorusIndex: 0, targetEnergy: 0.7 },
		piano: { role: 'support', maxAttacks: index === 1 ? 0 : 2, densityScale: index === 1 ? 0 : 1 }
	} }));
}

it('voice-leads from the last emitted chord instead of an unheard intermediate harmony', () => {
	const style = { ...BACKING_STYLES.ballad, compPattern: (ctx: { barIndex: number }) => ctx.barIndex === 1 ? []
		: [{ beatOffset: 0, durationBeats: 1, velocity: 60 }] };
	const silentChange = harmony.map((segment, index): HarmonicSegment => index === 1
		? { ...segment, chord: { root: 'Ab', quality: 'min7' } } : segment);
	for (let seed = 0; seed < 12; seed++) {
		const input = { ...params, phraseId: `causal-rest-${seed}` };
		const before = generateComping(harmony, 4, style, input, infos());
		const after = generateComping(silentChange, 4, style, input, infos());
		expect(before.events.map((event) => event.absBeat)).toEqual([0, 8]);
		expect(after.events).toEqual(before.events);
	}
});

it('does not commit a rolling voicing for a hit rejected beyond the owned bar', () => {
	const score = createRollingBacking(harmony, BACKING_STYLES.ballad, params);
	const info = infos()[0];
	const result = realizeRollingPiano(score, 0, info, { place: () => 4 * 192, arrivalTick: () => 0, trace: [] });
		expect(result.events).toEqual([]);
		expect(result.memory.segmentIndex).toBeNull();
		expect(result.memory.segmentVoicing).toEqual([]);
		expect(result.memory.lastVoicing).toEqual([]);
	expect(result.memory.voicing).toBeUndefined();
	expect(result.voicingTrace).toEqual([]);
});

it('voices an accepted anticipation from its upcoming harmony and traces only actual attacks', () => {
	const style = { ...BACKING_STYLES.ballad, compPattern: (ctx: { barIndex: number }) => ctx.barIndex === 0
		? [{ beatOffset: 3.5, durationBeats: 0.4, velocity: 60 }] : [] };
	const bars = infos().map((info) => ({ ...info, ensemble: { ...info.ensemble!, piano: { ...info.ensemble!.piano, maxAttacks: 2 as const } } }));
	const generated = generateComping(harmony, 4, style, params, bars);
	expect(generated.events).toHaveLength(1);
	const trace = generated.voicingTrace![0];
	expect(trace.absBeat).toBe(3.5);
	const expected = resolveCoordinatedVoicing({ chord: harmony[1].chord, family: trace.decision.requestedFamily,
		registerMidi: Math.round(58 + 8 * bars[0].intensity) });
	expect(generated.events[0].notes).toEqual(expected.notes);
	expect(trace).toMatchObject({ absBeat: generated.events[0].absBeat, time: generated.events[0].time, notes: generated.events[0].notes, decision: expected.decision });
	expect(Object.isFrozen(trace.notes) && Object.isFrozen(trace.decision)).toBe(true);
});

it('does not advance fixed voicing history for a discarded zero-length attack', () => {
	const style = { ...BACKING_STYLES.ballad, compPattern: (ctx: { barIndex: number }) => ctx.barIndex === 1 ? []
		: [{ beatOffset: 0, durationBeats: ctx.barIndex === 0 ? 0 : 1, velocity: 60 }] };
	const generated = generateComping(harmony, 4, style, params, infos());
	expect(generated.events.map((event) => event.absBeat)).toEqual([8]);
	expect(generated.voicingTrace).toHaveLength(1);
	expect(generated.voicingTrace![0].decision.guideMotion).toBeNull();
	expect(generated.voicingTrace![0].decision.commonTones).toEqual([]);
});

it('keeps an anticipation placement independent of future-bar energy observations', () => {
	const style = { ...BACKING_STYLES.ballad, compPattern: (ctx: { barIndex: number }) => ctx.barIndex === 0
		? [{ beatOffset: 3.5, durationBeats: 0.4, velocity: 60 }] : [] };
	for (let seed = 0; seed < 12; seed++) {
		const input = { ...params, phraseId: `causal-anticipation-${seed}` };
		const low = infos().map((info, index) => ({ ...info, intensity: index === 1 ? 0.2 : info.intensity }));
		const high = low.map((info, index) => ({ ...info, intensity: index === 1 ? 0.9 : info.intensity }));
		const a = generateComping(harmony, 4, style, input, low);
		const b = generateComping(harmony, 4, style, input, high);
		expect(a.events).toHaveLength(1);
		expect(b.events).toEqual(a.events);
		expect(b.voicingTrace).toEqual(a.voicingTrace);
	}
});

it('carries actual emitted guide overrides and anticipation harmony through JSON rolling resumes', () => {
	const preset = BACKING_LAB_PRESETS.find((entry) => entry.id === 'lab-aaba-c')!;
	let guides = 0;
	let followedGuides = 0;
	let restoredSounding = 0;
	for (let seed = 0; seed < 12 && (!guides || !followedGuides); seed++) {
		const score = createRollingBacking(preset.phrase.harmony, BACKING_STYLES.swing, { ...params,
			phraseId: `guide-history-${seed}`, performanceForm: preset.phrase.performanceForm });
		let checkpoint: RollingBackingCheckpoint | undefined;
		let actual: CoordinatedVoicingMemory | undefined;
		let previousGuide = false;
		for (let bar = 0; bar < score.totalBars; bar++) {
			const result = advanceRollingBacking(score, checkpoint);
			expect(result.ensembleDevelopment.pianoVoicings).toHaveLength(result.compEvents.length);
			if (result.compEvents.length && restoredSounding < 4 && checkpoint) {
				expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(checkpoint)))).toEqual(result);
				restoredSounding++;
			}
			for (const [index, event] of result.compEvents.entries()) {
				const trace = result.ensembleDevelopment.pianoVoicings![index];
				const lookup = Math.min(score.totalBars * 4 - 0.001, event.absBeat + (event.absBeat % 1 ? 0.5 : 0));
				const chord = score.harmony.find((segment) => lookup >= fractionToFloat(segment.startOffset) * 4 &&
					lookup < (fractionToFloat(segment.startOffset) + fractionToFloat(segment.duration)) * 4)!.chord;
				const expected = resolveCoordinatedVoicing({ chord, family: trace.decision.requestedFamily,
					registerMidi: trace.decision.requestedFamily === 'guide' ? 62 : Math.round(58 + 8 * result.ensemblePlan.bars[0].energy), previous: actual });
				expect(event.notes).toEqual(expected.notes);
				expect(trace).toMatchObject({ absBeat: event.absBeat, time: event.time, notes: event.notes, decision: expected.decision });
				if (previousGuide) followedGuides++;
				previousGuide = trace.decision.requestedFamily === 'guide';
				if (previousGuide) guides++;
				actual = expected.memory;
			}
			expect(result.checkpoint.piano.voicing).toEqual(actual);
			expect(result.checkpoint.piano.lastVoicing).toEqual(actual?.notes ?? []);
			checkpoint = result.checkpoint;
		}
	}
	expect(guides).toBeGreaterThan(0);
	expect(followedGuides).toBeGreaterThan(0);
	expect(restoredSounding).toBeGreaterThan(0);
});

it('rejects prior-policy or malformed emitted-harmony checkpoints before continuation', () => {
	const score = createRollingBacking(harmony, BACKING_STYLES.ballad, params);
	let checkpoint: RollingBackingCheckpoint | undefined;
	for (let bar = 0; bar < score.totalBars - 1 && !checkpoint?.piano.voicing; bar++) checkpoint = advanceRollingBacking(score, checkpoint).checkpoint;
	expect(checkpoint?.piano.voicing).toBeDefined();
	for (const priorPolicy of [
		score.fingerprint.replace('"coordinatedVoicingVersion":2', '"coordinatedVoicingVersion":1'),
		score.fingerprint.replace(',"coordinatedVoicingVersion":2', '')
	]) {
		expect(priorPolicy).not.toBe(score.fingerprint);
		const { checkpointId: _identity, ...contents } = { ...checkpoint!, fingerprint: priorPolicy };
		const checkpointId = `${contents.sessionId}:${contents.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}`;
		expect(() => advanceRollingBacking(score, { ...contents, checkpointId })).toThrow(/checkpoint/i);
	}
	for (const mutate of [
		(value: RollingBackingCheckpoint) => { (value.piano.voicing as { version: number }).version = 2; },
		(value: RollingBackingCheckpoint) => { (value.piano.voicing!.notes as number[])[0] = 0; },
		(value: RollingBackingCheckpoint) => { (value.piano.voicing!.chord as { root: string }).root = 'Ab'; }
	]) {
		const invalid = JSON.parse(JSON.stringify(checkpoint)) as RollingBackingCheckpoint;
		mutate(invalid);
		const { checkpointId: _identity, ...contents } = invalid;
		// Recompute the public integrity checksum so semantic validation must reject it.
		(invalid as { checkpointId: string }).checkpointId = `${invalid.sessionId}:${invalid.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}`;
		expect(() => advanceRollingBacking(score, invalid)).toThrow('Invalid rolling checkpoint');
	}
});
