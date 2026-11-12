import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { planEnsemble, planEnsembleWindow, freezeEnsemblePlan, type SoloFeature } from '$lib/audio/ensemble-plan';
import { createRollingBacking } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildHistoricalListeningTuneSession as buildListeningTuneSession, HISTORICAL_LISTENING_TUNES as LISTENING_TUNES } from '../../helpers/musicality-tune-fixtures';

const session = buildListeningTuneSession({ tuneId: LISTENING_TUNES[0].id, soloChoruses: 2 });
const params = { phraseId: 'rootless-texture-plan', tempo: 140, ppq: 192, beatsPerBar: 4,
	swing: 0.67, performanceForm: session.phrase.performanceForm, ensemble: {} };
const score = createRollingBacking(session.phrase.harmony, BACKING_STYLES.swing, params);
const input = { phraseId: params.phraseId, tempo: params.tempo, bars: score.bars };
const soloBar = score.bars.findIndex((bar) => bar.performanceEnergy?.phase === 'solo_peak');
const feature = (overrides: Partial<SoloFeature> = {}): SoloFeature => ({ barIndex: soloBar, observedAtBar: soloBar,
	source: 'scripted', confidence: 1, noteDensity: 0.6, restBeats: 0, ...overrides });

describe('ensemble rootless texture requests', () => {
	it('plans melody/release support and solo development without interpreting absent observations as rests', () => {
		const plan = planEnsemble(input);
		const phases = new Set<string>();
		for (const bar of plan.bars) {
			const phase = bar.performanceEnergy!.phase;
			phases.add(phase);
			const developing = phase === 'solo_build' || phase === 'solo_peak';
			const melody = phase === 'head_in' || phase === 'head_return';
			expect(bar.piano.rootlessTexture).toEqual({ request: developing ? 'full' : 'three',
				reason: developing ? 'solo_development' : melody ? 'melody_support' : 'structural_release' });
			expect(Object.isFrozen(bar.piano.rootlessTexture)).toBe(true);
		}
		expect(phases).toEqual(new Set(['head_in', 'solo_build', 'solo_peak', 'solo_release', 'head_return', 'ending']));
		expect(plan.trace.every((entry) => entry.soloEvidence === 'unavailable')).toBe(true);
	});

	it.each([
		['active', {}, 'three', 'active_soloist'],
		['resting', { noteDensity: 0.1, restBeats: 2 }, 'full', 'solo_development'],
		['low_confidence', { confidence: 0.69 }, 'full', 'solo_development'],
		['stale', { observedAtBar: soloBar - 2 }, 'full', 'solo_development'],
		['stale', { observedAtBar: soloBar + 1 }, 'full', 'solo_development'],
		['invalid', { noteDensity: Number.NaN }, 'full', 'solo_development']
	] as const)('uses qualified evidence only: %s', (evidence, overrides, request, reason) => {
		const plan = planEnsemble({ ...input, soloFeatures: [feature(overrides)] });
		expect(plan.trace[soloBar].soloEvidence).toBe(evidence);
		expect(plan.bars[soloBar].piano.rootlessTexture).toEqual({ request, reason });
	});

	it('thins a surviving dense boundary chord without expanding its one-attack budget', () => {
		const boundary = soloBar;
		// A strong declared boundary may retain one attack under dense evidence.
		const bars = score.bars.map((bar, index) => index === boundary ? { ...bar, boundaryStrength: 1 } : bar);
		expect(boundary).toBeGreaterThan(0);
		let survivingBoundaries = 0;
		for (let seed = 0; seed < 24; seed++) {
			const plan = planEnsemble({ ...input, bars, phraseId: `dense-rootless-${seed}`, soloFeatures: [feature({
				barIndex: boundary, observedAtBar: boundary, noteDensity: 1
			})] });
			const bar = plan.bars[boundary];
			expect(bar.piano.maxAttacks).toBeLessThanOrEqual(1);
			expect(bar.drums.maxCommentaryHits).toBe(0);
			expect(bar.piano.rootlessTexture).toEqual({ request: 'two', reason: 'dense_soloist' });
			if (bar.piano.maxAttacks === 1) survivingBoundaries++;
		}
		expect(survivingBoundaries).toBeGreaterThan(0);
	});

	it('does not add texture policy to metadata-free coordination, even with qualified observations', () => {
		const bars = score.bars.map(({ performanceEnergy: _energy, pianoArrivalPolicy: _arrival, ...bar }) => bar);
		const plan = planEnsemble({ ...input, bars, soloFeatures: [feature()] });
		expect(plan.bars.every((bar) => bar.piano.rootlessTexture === undefined)).toBe(true);
	});

	it('retains full-window decisions and nested immutability after JSON checkpoint and plan restoration', () => {
		const observed = { ...input, soloFeatures: [feature()] };
		const full = planEnsembleWindow(observed);
		const first = planEnsembleWindow({ ...observed, endBarExclusive: soloBar });
		const second = planEnsembleWindow({ ...observed, memory: JSON.parse(JSON.stringify(first.memory)) });
		expect([...first.plan.bars, ...second.plan.bars]).toEqual(full.plan.bars);
		expect(second.memory).toEqual(full.memory);
		const restored = freezeEnsemblePlan(JSON.parse(JSON.stringify(full.plan)));
		expect(restored).toEqual(full.plan);
		expect(restored.bars.every((bar) => Object.isFrozen(bar.piano.rootlessTexture))).toBe(true);
	});

	it('rejects the actual prior explicit-form policy binding while preserving the metadata-free binding', () => {
		// Captured by running committed 766cec48's ensemble planner against
		// these inputs, independently of the new policy implementation.
		const prior = JSON.parse(readFileSync('tests/fixtures/audio/rootless-texture-prior-policy.json', 'utf8')) as {
			explicit: string; implicit: string; tuneId: string
		};
		expect(session.tune.id).toBe(prior.tuneId);
		const first = planEnsembleWindow({ ...input, endBarExclusive: 8 });
		expect(first.memory.formFingerprint).not.toBe(prior.explicit);
		expect(() => planEnsembleWindow({ ...input, memory: { ...first.memory, formFingerprint: prior.explicit } })).toThrow(/form|timeline/i);
		const bars = score.bars.map(({ performanceEnergy: _energy, pianoArrivalPolicy: _arrival, ...bar }) => bar);
		expect(planEnsembleWindow({ ...input, bars }).memory.formFingerprint).toBe(prior.implicit);
	});
});
