import { describe, expect, it } from 'vitest';
import { generateBacking, generateComping, buildBarInfos, type CompEvent } from '$lib/audio/backing-generation';
import { buildPerformanceForm } from '$lib/audio/performance-form';
import type { HarmonicSegment } from '$lib/types/music';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { realizeRollingPiano, type RollingPianoMemory } from '$lib/audio/backing-rolling-piano';
import { restoreEnsembleTiming } from '$lib/audio/ensemble-timing';
import { buildListeningTuneSession, LISTENING_TUNES } from '$lib/musicality/listening-tunes';

const withoutPitches = (events: readonly CompEvent[]) => events.map(({ notes: _notes, ...event }) => event);
const session = buildListeningTuneSession({ tuneId: LISTENING_TUNES.find(tune => tune.title.includes('Saints'))!.id, soloChoruses: 2 });

describe.each(['swing', 'straight', 'bossa-nova', 'ballad'] as const)('%s structural rootless texture integration', id => {
	const style = BACKING_STYLES[id];
	const params = { phraseId: session.phrase.id, tempo: 140, ppq: 192, beatsPerBar: 4, swing: style.defaultSwing,
		sectionMap: session.phrase.sectionMap, performanceForm: session.phrase.performanceForm, ensemble: {} };

	it('changes chord density without changing native attacks, articulation or family selection', () => {
		const actual = generateBacking(session.phrase.harmony, style, params);
		const infos = buildBarInfos(session.bars.length, undefined, session.phrase.performanceForm).map((info, bar) => ({
			...info, ensemble: actual.ensemblePlan!.bars[bar], intensity: actual.ensemblePlan!.bars[bar].energy
		}));
		const fullInfos = infos.map(info => ({ ...info, ensemble: { ...info.ensemble,
			piano: { ...info.ensemble.piano, rootlessTexture: undefined } } }));
		const timing = restoreEnsembleTiming({ ...params, trace: actual.ensembleTiming!, timingProfiles: style.timing });
		const fixed = generateComping(session.phrase.harmony, 4, style, { ...params, ensembleTiming: timing }, infos);
		const full = generateComping(session.phrase.harmony, 4, style, { ...params, ensembleTiming: timing }, fullInfos);
		expect(withoutPitches(fixed.events)).toEqual(withoutPitches(full.events));
		expect(fixed.onsetsByBar).toEqual(full.onsetsByBar);
		expect(fixed.voicingTrace!.map(trace => trace.decision.requestedFamily)).toEqual(full.voicingTrace!.map(trace => trace.decision.requestedFamily));
		const thinned = fixed.voicingTrace!.filter(trace => trace.decision.rootlessTexture?.applied === 'three');
		expect(thinned.length).toBeGreaterThan(0);
		for (const trace of thinned) {
			expect(trace.notes).toHaveLength(3);
			expect(trace.decision.rootlessTexture).toMatchObject({ request: 'three', eligible: true, noteCount: 3 });
			const index = fixed.voicingTrace!.indexOf(trace);
			expect(full.events[index].notes).toHaveLength(4);
			expect(trace.notes).toEqual(fixed.events[index].notes);
		}
		expect(fixed.voicingTrace!.some(trace => trace.decision.rootlessTexture?.request === 'full' && trace.notes.length === 4)).toBe(true);

		const score = createRollingBacking(session.phrase.harmony, style, params);
		let memory: RollingPianoMemory | undefined, fullMemory: RollingPianoMemory | undefined;
		let rollingThree = 0;
		for (let bar = 0; bar < score.totalBars; bar++) {
			const next = realizeRollingPiano(score, bar, infos[bar], timing, memory);
			const old = realizeRollingPiano(score, bar, fullInfos[bar], timing, fullMemory);
			expect(withoutPitches(next.events)).toEqual(withoutPitches(old.events));
			expect(next.trace).toEqual(old.trace);
			expect(next.voicingTrace!.map(trace => trace.decision.requestedFamily)).toEqual(old.voicingTrace!.map(trace => trace.decision.requestedFamily));
			for (const [index, trace] of next.voicingTrace!.entries()) {
				expect(trace.notes).toEqual(next.events[index].notes);
				expect(trace.decision.rootlessTexture?.noteCount).toBe(trace.notes.length);
				if (trace.decision.rootlessTexture?.applied === 'three') {
					expect(trace.notes).toHaveLength(3); expect(old.events[index].notes).toHaveLength(4); rollingThree++;
				}
			}
			if (next.events.length) expect(next.memory.voicing?.notes).toEqual(next.events.at(-1)!.notes);
			memory = next.memory; fullMemory = old.memory;
		}
		expect(rollingThree).toBeGreaterThan(0);
	});

	it('restores emitted three-note history and obeys dense soloist silence without extra attacks', () => {
		const score = createRollingBacking(session.phrase.harmony, style, params);
		let checkpoint: RollingBackingCheckpoint | undefined;
		for (let bar = 0; bar < score.totalBars - 1; bar++) {
			const next = advanceRollingBacking(score, checkpoint);
			checkpoint = next.checkpoint;
			if (next.ensembleDevelopment.pianoVoicings?.at(-1)?.decision.rootlessTexture?.applied === 'three') break;
		}
		expect(checkpoint!.piano.voicing?.notes).toHaveLength(3);
		expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(checkpoint))))
			.toEqual(advanceRollingBacking(score, checkpoint));
		const dense = advanceRollingBacking(score, checkpoint, [{ barIndex: checkpoint!.nextBar,
			observedAtBar: checkpoint!.nextBar - 1, source: 'microphone', confidence: .95, noteDensity: 1, restBeats: 0 }]);
		expect(dense.ensemblePlan.bars[0].piano.rootlessTexture).toEqual({ request: 'two', reason: 'dense_soloist' });
		expect(dense.ensemblePlan.bars[0].piano.maxAttacks).toBe(0);
		expect(dense.compEvents).toEqual([]);
		expect(dense.ensembleDevelopment.pianoVoicings).toEqual([]);
		expect(dense.checkpoint.piano.voicing).toEqual(checkpoint!.piano.voicing);
	});
});


it.each([
	{ noteDensity: .6, request: 'three', reason: 'active_soloist', count: 3, commentary: 3 },
	{ noteDensity: 1, request: 'two', reason: 'dense_soloist', count: 2, commentary: 0 }
] as const)('realizes $request-note support at the permitted solo-peak boundary under density $noteDensity', ({ noteDensity, request, reason, count, commentary }) => {
	const sectionMap = [{ sourceSection: 0, barOffset: 0 }, { sourceSection: 1, barOffset: 8 }];
	const performanceForm = buildPerformanceForm({ totalBars: 16, sectionMap,
		choruses: [{ role: 'solo', startBar: 0, endBarExclusive: 16 }] });
	const harmony: HarmonicSegment[] = [{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.dorian',
		startOffset: [0, 1], duration: [16, 1] }];
	// The declared section at bar 8 gives its preceding bar the existing
	// strong-boundary budget. This pinned seed selects a rootless B attack;
	// no pattern, family, energy or attack budget is overridden by the test.
	const params = { phraseId: 'dense-rootless-realized-1', tempo: 140, ppq: 192, beatsPerBar: 4,
		swing: BACKING_STYLES.swing.defaultSwing, sectionMap, performanceForm };
	const defaultPlan = generateBacking(harmony, BACKING_STYLES.swing, { ...params, ensemble: {} });
	const active = generateBacking(harmony, BACKING_STYLES.swing, { ...params, ensemble: { soloFeatures: [
		{ barIndex: 7, observedAtBar: 7, source: 'scripted', confidence: 1, noteDensity, restBeats: 0 }
	] } });
	expect(defaultPlan.ensemblePlan!.bars[7].piano.rootlessTexture).toEqual({ request: 'full', reason: 'solo_development' });
	const plan = active.ensemblePlan!.bars[7];
	expect(plan.performanceEnergy?.phase).toBe('solo_peak');
	expect(active.ensemblePlan!.trace[7].soloEvidence).toBe('active');
	expect(plan.boundaryStrength).toBe(.85);
	expect(plan.piano.maxAttacks).toBe(1);
	expect(plan.drums.maxCommentaryHits).toBe(commentary);
	expect(plan.piano.rootlessTexture).toEqual({ request, reason });
	const attacks = active.compEvents.filter(event => Math.floor(event.absBeat / 4) === 7);
	const traces = active.ensembleDevelopment!.pianoVoicings!.filter(trace => Math.floor(trace.absBeat / 4) === 7);
	expect(attacks).toHaveLength(1);
	expect(traces).toHaveLength(1);
	expect(attacks[0].notes).toHaveLength(count);
	expect(attacks[0].notes.map(note => note % 12).sort((a, b) => a - b)).toEqual(count === 2 ? [0, 5] : [0, 4, 5]);
	expect(traces[0]).toMatchObject({ time: attacks[0].time, absBeat: attacks[0].absBeat, notes: attacks[0].notes,
		decision: { requestedFamily: 'rootless-b', rootlessTexture: { request, applied: request, eligible: true, noteCount: count } } });
});
