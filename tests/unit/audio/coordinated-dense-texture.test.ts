import { describe, expect, it } from 'vitest';
import priorPolicy from '../../fixtures/audio/dense-texture-prior-policy.json';
import { resolveCoordinatedVoicing, type CoordinatedVoicingFamily } from '$lib/audio/coordinated-voicing';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import { PITCH_CLASSES, type ChordQuality } from '$lib/types/music';
import { planEnsembleWindow, type SoloFeature } from '$lib/audio/ensemble-plan';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildHistoricalListeningTuneSession as buildListeningTuneSession } from '../../helpers/musicality-tune-fixtures';
import { seedFrom } from '$lib/audio/generation-rng';

const { phrase } = buildListeningTuneSession({ tuneId: 'ls-mankunku-blues', key: 'Eb', soloChoruses: 2 });
const params = { phraseId: phrase.id, tempo: 140, ppq: 192, beatsPerBar: 4, swing: .67,
	performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {} };
const score = createRollingBacking(phrase.harmony, BACKING_STYLES.swing, params);
const feature = (overrides: Partial<SoloFeature> = {}): SoloFeature => ({ barIndex: 25, observedAtBar: 24,
	source: 'scripted', confidence: .95, noteDensity: .9, restBeats: 0, ...overrides });
const stripTexture = (result: ReturnType<typeof resolveCoordinatedVoicing>) => {
	const { rootlessTexture: _texture, ...decision } = result.decision;
	return { ...result, decision };
};

describe('qualified dense-solo defining-tone support', () => {
	it('uses the defining third and seventh for both selected rootless families in every key', () => {
		for (const root of PITCH_CLASSES) for (const quality of ['maj7', 'min7', '7'] as const) {
			for (const family of ['rootless-a', 'rootless-b'] as const) {
				const input = { chord: { root, quality }, family, registerMidi: 62, rootlessTexture: 'two' as const };
				const result = resolveCoordinatedVoicing(input);
				expect(result.notes).toHaveLength(2);
				expect(result.notes.map(note => (note - PITCH_CLASSES.indexOf(root) + 12) % 12).sort((a, b) => a - b))
					.toEqual([quality === 'min7' ? 3 : 4, quality === 'maj7' ? 11 : 10]);
				expect(result.notes.every(note => note >= 48 && note <= 84)).toBe(true);
				expect(result.notes[0]).toBeLessThan(result.notes[1]);
				expect(result.memory.notes).toEqual(result.notes);
				expect(result.decision.rootlessTexture).toEqual({ request: 'two', applied: 'two', eligible: true, noteCount: 2 });
				expect(Object.isFrozen(result.decision.rootlessTexture)).toBe(true);
				expect(resolveCoordinatedVoicing(input)).toEqual(result);
			}
		}
	});

	it('preserves unsupported selected families and qualities exactly, even when fallback resolves to rootless', () => {
		const families: CoordinatedVoicingFamily[] = ['rootless-a', 'rootless-b', 'guide', 'shell', 'quartal', 'drop2'];
		for (const quality of Object.keys(CHORD_DEFINITIONS) as ChordQuality[]) for (const family of families) {
			if (['maj7', 'min7', '7'].includes(quality) && ['rootless-a', 'rootless-b'].includes(family)) continue;
			const input = { chord: { root: 'F#' as const, quality }, family, registerMidi: 62 };
			const baseline = resolveCoordinatedVoicing(input);
			const thinned = resolveCoordinatedVoicing({ ...input, rootlessTexture: 'two' });
			expect(stripTexture(thinned)).toEqual(baseline);
			expect(thinned.decision.rootlessTexture).toEqual({ request: 'two', applied: 'full', eligible: false, noteCount: baseline.notes.length });
		}
	});

	it('retains common defining tones and semitone motion through ii–V–I with actual two-note history', () => {
		const prior = resolveCoordinatedVoicing({ chord: { root: 'D', quality: 'min7' }, family: 'guide', registerMidi: 56 });
		const first = resolveCoordinatedVoicing({ chord: { root: 'D', quality: 'min7' }, family: 'rootless-a', registerMidi: 58,
			rootlessTexture: 'two', previous: prior.memory });
		const second = resolveCoordinatedVoicing({ chord: { root: 'G', quality: '7' }, family: 'rootless-b', registerMidi: 70, rootlessTexture: 'two', previous: first.memory });
		const third = resolveCoordinatedVoicing({ chord: { root: 'C', quality: 'maj7' }, family: 'rootless-a', registerMidi: 70, rootlessTexture: 'two', previous: second.memory });
		expect(first.notes).toEqual([53, 60]);
		expect(second.notes).toEqual([53, 59]);
		expect(third.notes).toEqual([52, 59]);
		expect(second.decision.guideMotion).toBe(1);
		expect(third.decision.guideMotion).toBe(1);
		expect(second.decision.commonTones).toEqual([53]);
		expect(third.decision.commonTones).toEqual([59]);
		expect(resolveCoordinatedVoicing({ chord: { root: 'C', quality: 'maj7' }, family: 'rootless-a', registerMidi: 70,
			rootlessTexture: 'two', previous: JSON.parse(JSON.stringify(second.memory)) })).toEqual(third);
	});

	it.each([
		['threshold', { noteDensity: .75 }, 'two', 'dense_soloist'],
		['active', { noteDensity: .749 }, 'three', 'active_soloist'],
		['resting', { noteDensity: .1, restBeats: 2 }, 'three', 'structural_release'],
		['stale', { observedAtBar: 23 }, 'three', 'structural_release'],
		['future', { observedAtBar: 26 }, 'three', 'structural_release'],
		['uncertain', { confidence: .69 }, 'three', 'structural_release'],
		['invalid', { noteDensity: Number.NaN }, 'three', 'structural_release']
	] as const)('qualifies density without changing the planner evidence boundary: %s', (_name, overrides, request, reason) => {
		const { plan } = planEnsembleWindow({ phraseId: params.phraseId, tempo: 140, bars: score.bars, soloFeatures: [feature(overrides)] });
		expect(plan.bars[25].piano.rootlessTexture).toEqual({ request, reason });
		expect(Object.isFrozen(plan.bars[25].piano.rootlessTexture)).toBe(true);
	});

	it('binds the dense policy only to explicit forms and rejects prior policy with a valid checksum', () => {
		const first = advanceRollingBacking(score);
		const binding = JSON.parse(score.fingerprint);
		const policy = binding.find((value: any) => value?.coordinatedVoicingVersion);
		expect(policy.coordinatedVoicingVersion).toBe(4);
		policy.coordinatedVoicingVersion = 3;
		const { checkpointId: _id, ...contents } = { ...first.checkpoint, fingerprint: JSON.stringify(binding) };
		const stale = { ...contents, checkpointId: `${contents.sessionId}:${contents.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}` } as RollingBackingCheckpoint;
		expect(() => advanceRollingBacking(score, stale)).toThrow(/checkpoint/);
		const input = { phraseId: params.phraseId, tempo: 140, bars: score.bars };
		const planned = planEnsembleWindow({ ...input, endBarExclusive: 1 });
		expect(params.phraseId).toBe(priorPolicy.phraseId);
		expect(planned.memory.formFingerprint).not.toBe(priorPolicy.formFingerprint);
		const oldMemory = { ...planned.memory, formFingerprint: priorPolicy.formFingerprint };
		expect(() => planEnsembleWindow({ ...input, memory: oldMemory })).toThrow(/form|timeline/);
		const implicit = createRollingBacking(phrase.harmony, BACKING_STYLES.swing, { ...params, performanceForm: undefined });
		expect(implicit.fingerprint).not.toContain('coordinatedVoicingVersion');
	});

	it('plans full versus split dense windows equivalently with immutable restored requests', () => {
		const input = { phraseId: params.phraseId, tempo: 140, bars: score.bars, soloFeatures: [feature()] };
		const full = planEnsembleWindow(input);
		const prefix = planEnsembleWindow({ ...input, endBarExclusive: 25 });
		const suffix = planEnsembleWindow({ ...input, memory: JSON.parse(JSON.stringify(prefix.memory)) });
		expect([...prefix.plan.bars, ...suffix.plan.bars]).toEqual(full.plan.bars);
		expect(suffix.memory).toEqual(full.memory);
		expect(suffix.plan.bars[0].piano.rootlessTexture).toEqual({ request: 'two', reason: 'dense_soloist' });
	});
});
