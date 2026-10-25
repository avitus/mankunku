import { describe, expect, it } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint, type RollingBackingBar } from '$lib/audio/backing-rolling';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';
import { createRng, seedFrom } from '$lib/audio/generation-rng';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { captureDrumStatement, planDrumPianoFeedback } from '$lib/audio/backing-ensemble-feedback';
import type { BarInfo } from '$lib/audio/backing-generation';

const phrase = BACKING_LAB_PRESETS.find((preset) => preset.id === 'lab-aaba-c')!.phrase;
const scoreFor = (seed: number) => createRollingBacking(phrase.harmony, BACKING_STYLES.swing, {
	phraseId: `drum-piano-feedback:${seed}`, tempo: 140, ppq: 192, beatsPerBar: 4, swing: 0.67,
	performanceForm: phrase.performanceForm, ensemble: {}
});

function rebind(checkpoint: RollingBackingCheckpoint): RollingBackingCheckpoint {
	const { checkpointId: _, ...contents } = checkpoint;
	return { ...contents, checkpointId: `${contents.sessionId}:${contents.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}` };
}

// This source gesture and its following audible chord were captured before
// the feedback implementation. Keep the case pinned rather than seed-searching.
const score = scoreFor(14);
let preceding: RollingBackingBar;
let checkpoint: RollingBackingCheckpoint | undefined;
for (let bar = 0; bar <= 50; bar++) {
	preceding = advanceRollingBacking(score, checkpoint);
	checkpoint = preceding.checkpoint;
}
const next = () => advanceRollingBacking(score, preceding.checkpoint);

describe('causal drum-to-piano feedback', () => {
	it('occasionally leaves a breathing bar after an accepted independent two-hit drum statement', () => {
		let eligible = 0;
		let sounding = 0;
		for (const seed of [14]) {
			const score = scoreFor(seed);
			let checkpoint: RollingBackingCheckpoint | undefined;
			let source = false;
			let lastYield = -Infinity;
			for (let bar = 0; bar < score.totalBars; bar++) {
				const step = advanceRollingBacking(score, checkpoint);
				const plan = step.ensemblePlan.bars[0];
				if (source && plan.piano.maxAttacks > 0 && plan.responseOwner === 'nobody' &&
					!plan.coordinatedAccent && !plan.setupFor && !score.bars[bar].isFinalBar &&
					!score.bars[bar].isSectionFirstBar && !score.bars[bar].isChorusFirstBar &&
					plan.performanceEnergy?.phase !== 'ending' && bar - lastYield >= 3 &&
					createRng(seedFrom(score.phraseId, score.tempo, 'drum-piano-yield', bar)).chance(1 / 3)) {
					eligible++;
					expect(step.compEvents.length, `seed ${seed}, bar ${bar}`).toBe(0);

					lastYield = bar;
				}
				if (step.compEvents.length) sounding++;
				const decision = step.ensembleDevelopment.drumPhrases[0];
				const hits = decision.hits.filter((hit) => hit.role === 'commentary' && ['snare', 'crossstick', 'kick'].includes(hit.drum));
				source = decision.commentary.source === 'vocabulary' &&
					['statement', 'repeat', 'displace', 'orchestrate', 'fallback'].includes(decision.commentary.transform) &&
					new Set(hits.map((hit) => hit.beatOffset)).size >= 2;
				checkpoint = step.checkpoint;
			}
		}
		expect(eligible).toBeGreaterThan(0);
		expect(sounding).toBeGreaterThan(0);
	});

	it('changes an actual sounding chord into one breathing bar without changing bass or shared intentions', () => {
		const breath = next();
		const restored: RollingBackingCheckpoint = JSON.parse(JSON.stringify(preceding.checkpoint));
		const noSource = { ...restored, feedback: { ...restored.feedback!, previousDrumStatement: null } };
		const control = advanceRollingBacking(score, rebind(noSource));
		expect(control.compEvents).toHaveLength(1);
		expect(breath.compEvents).toEqual([]);
		expect(breath.bassEvents).toEqual(control.bassEvents);
		expect(breath.ensemblePlan).toEqual(control.ensemblePlan);
		expect(breath.checkpoint.ensemble).toEqual(control.checkpoint.ensemble);
		expect(breath.checkpoint.piano.voicing).toEqual(preceding.checkpoint.piano.voicing);
		expect(breath.ensembleDevelopment.pianoFeedback).toEqual([{
			version: 1, barIndex: 51, source: preceding.checkpoint.feedback!.previousDrumStatement,
			action: 'yield', reason: 'drum_statement', originalMaxAttacks: 1, effectiveMaxAttacks: 0, acceptedAttacks: []
		}]);
		for (const event of preceding.checkpoint.feedback!.previousDrumStatement!.hits) {
			expect(preceding.drumEvents).toContainEqual(event);
		}
		expect(breath.drumEvents.filter((hit) => hit.role === 'timekeeping'))
			.toEqual(control.drumEvents.filter((hit) => hit.role === 'timekeeping'));
	});

	it('requires actual accepted optional evidence, not a proposed gesture, native pulse or piano answer', () => {
		const decision = preceding.ensembleDevelopment.drumPhrases[0];
		const source = captureDrumStatement(decision, preceding.drumEvents);
		expect(source?.hits).toHaveLength(2);
		expect(captureDrumStatement(decision, [])).toBeNull();
		expect(captureDrumStatement({ ...decision, hits: [] }, preceding.drumEvents)).toBeNull();
		expect(captureDrumStatement({ ...decision, commentary: { ...decision.commentary, hits: [] } }, preceding.drumEvents)).toBeNull();
		expect(captureDrumStatement(decision, preceding.drumEvents.map((event) => ({ ...event, role: 'timekeeping' })))).toBeNull();
		for (const transform of ['answer', 'setup', 'space'] as const) {
			expect(captureDrumStatement({ ...decision, commentary: { ...decision.commentary, transform } }, preceding.drumEvents)).toBeNull();
		}
		expect(captureDrumStatement({ ...decision, commentary: { ...decision.commentary, source: 'piano' } }, preceding.drumEvents)).toBeNull();
		expect(captureDrumStatement(decision, source!.hits.slice(0, 1))).toBeNull();
	});

	it('protects zero budgets, native anchors, formal transitions, endings and assigned responses', () => {
		const ensemble = next().ensemblePlan.bars[0];
		const info: BarInfo = { ...score.bars[51], ensemble, intensity: ensemble.energy };
		const decide = (changed: BarInfo) => planDrumPianoFeedback({ phraseId: score.phraseId, tempo: score.tempo,
			barIndex: 51, info: changed, previous: preceding.checkpoint.feedback });
		expect(decide(info).action).toBe('yield');
		const cases: BarInfo[] = [
			{ ...info, isSectionFirstBar: true }, { ...info, isChorusFirstBar: true }, { ...info, isFinalBar: true },
			{ ...info, ensemble: { ...ensemble, piano: { ...ensemble.piano, maxAttacks: 0 } } },
			{ ...info, ensemble: { ...ensemble, performanceEnergy: { ...ensemble.performanceEnergy!, phase: 'ending' } } }
		];
		for (const owner of ['piano', 'drums', 'bass'] as const) cases.push({ ...info, ensemble: { ...ensemble, responseOwner: owner } });
		const reservation = { id: 'protected-arrival', targetBarIndex: 51, beatOffset: 0 as const,
			strength: 1, participants: ['bass', 'drums'] as const };
		cases.push({ ...info, ensemble: { ...ensemble, coordinatedAccent: reservation } });
		cases.push({ ...info, ensemble: { ...ensemble, setupFor: reservation } });
		for (const changed of cases) {
			const result = decide(changed);
			expect(result.action).toBe('none');
			expect(result.effectiveMaxAttacks).toBe(changed.ensemble!.piano.maxAttacks);
		}
	});

	it('expires stale/future source evidence and spaces selected breaths without inventing new rests', () => {
		const ensemble = next().ensemblePlan.bars[0];
		const input = { phraseId: score.phraseId, tempo: score.tempo, barIndex: 51,
			info: { ...score.bars[51], ensemble, intensity: ensemble.energy } };
		for (const barIndex of [49, 51]) {
			const result = planDrumPianoFeedback({ ...input, previous: { ...preceding.checkpoint.feedback!,
				previousDrumStatement: { ...preceding.checkpoint.feedback!.previousDrumStatement!, barIndex } } });
			expect(result.reason).toBe('no_statement');
			expect(result.effectiveMaxAttacks).toBe(1);
		}
		for (const lastYieldBar of [49, 50]) {
			expect(planDrumPianoFeedback({ ...input, previous: { ...preceding.checkpoint.feedback!, lastYieldBar } }).reason).toBe('cooldown');
		}
		expect(planDrumPianoFeedback({ ...input, previous: { ...preceding.checkpoint.feedback!, lastYieldBar: 48 } }).action).toBe('yield');
	});

	it('retains ordinary playing choices for most qualifying phrases and repeats each seeded choice exactly', () => {
		const ensemble = next().ensemblePlan.bars[0];
		let breaths = 0;
		for (let seed = 0; seed < 64; seed++) {
			const input = { phraseId: `feedback-choice:${seed}`, tempo: score.tempo, barIndex: 51,
				info: { ...score.bars[51], ensemble, intensity: ensemble.energy }, previous: preceding.checkpoint.feedback };
			const result = planDrumPianoFeedback(input);
			expect(planDrumPianoFeedback(input)).toEqual(result);
			if (result.action === 'yield') breaths++;
			else {
				expect(result.reason).toBe('not_selected');
				expect(result.effectiveMaxAttacks).toBe(ensemble.piano.maxAttacks);
			}
		}
		expect(breaths).toBeGreaterThan(0);
		expect(breaths).toBeLessThan(32);
	});

	it('owns frozen feedback and restores the chosen breath exactly from JSON', () => {
		const restored: RollingBackingCheckpoint = JSON.parse(JSON.stringify(preceding.checkpoint));
		const before = JSON.stringify(restored);
		expect(advanceRollingBacking(score, restored)).toEqual(next());
		expect(JSON.stringify(restored)).toBe(before);
		expect(Object.isFrozen(restored.feedback)).toBe(false);
		expect(Object.isFrozen(preceding.checkpoint.feedback!.previousDrumStatement!.hits[0])).toBe(true);
		expect(Object.isFrozen(next().ensembleDevelopment.pianoFeedback![0].source!.hits)).toBe(true);
	});

	it('rejects structurally invalid feedback even with a recomputed checkpoint checksum', () => {
		const mutations: Array<(state: any) => void> = [
			(state) => { delete state.feedback; },
			(state) => { state.feedback.version = 2; },
			(state) => { state.feedback.lastYieldBar = 51; },
			(state) => { state.feedback.lastYieldBar = -1; },
			(state) => { state.feedback.previousDrumStatement.barIndex = 49; },
			(state) => { state.feedback.previousDrumStatement.transform = 'answer'; },
			(state) => { state.feedback.previousDrumStatement.hits.pop(); },
			(state) => { state.feedback.previousDrumStatement.hits[0].role = 'timekeeping'; },
			(state) => { state.feedback.previousDrumStatement.hits[0].absBeat = 204; },
			(state) => { state.feedback.previousDrumStatement.hits[0].time = '0i'; },
			(state) => { state.feedback.previousDrumStatement.hits[0].velocity = 2; }
		];
		for (const mutate of mutations) {
			const state = JSON.parse(JSON.stringify(preceding.checkpoint));
			mutate(state);
			expect(() => advanceRollingBacking(score, rebind(state))).toThrow(/feedback checkpoint/);
		}
		const old = JSON.parse(JSON.stringify(preceding.checkpoint));
		old.fingerprint = old.fingerprint.replace(',"reciprocalFeedbackVersion":1', '');
		expect(() => advanceRollingBacking(score, rebind(old))).toThrow(/checkpoint/);
	});
});
