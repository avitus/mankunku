import { describe, expect, it } from 'vitest';
import { planCompFigures, compMotifTrace, compFigureById, hitsForPlannedBar, freezeCompMotifTrace } from '$lib/audio/backing-comp-figures';
import { buildBarInfos, generateBacking, generateComping, type BarInfo } from '$lib/audio/backing-generation';
import { planEnsemble } from '$lib/audio/ensemble-plan';
import type { HarmonicSegment } from '$lib/types/music';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';
import { BACKING_STYLES } from '$lib/audio/backing-styles';

const preset = BACKING_LAB_PRESETS.find((entry) => entry.id === 'lab-aaba-c')!;

function generousInfos(): BarInfo[] {
	const infos = buildBarInfos(preset.bars, preset.phrase.sectionMap);
	const ensemble = planEnsemble({ phraseId: 'motif-fixture', tempo: 140, bars: infos.map((bar, barIndex) => ({ ...bar, barIndex })) });
	return infos.map((bar, index) => ({
		...bar,
		ensemble: {
			...ensemble.bars[index], responseOwner: 'nobody', coordinatedAccent: undefined,
			piano: { role: 'support', maxAttacks: 2, densityScale: 1 }
		}
	}));
}

describe('coordinated piano motif development', () => {
	it('develops selected four-bar motifs through an audible whole-cell displacement', () => {
		const infos = generousInfos();
		const plan = planCompFigures(infos, 4, 'motif-probe', 140, undefined, { motifs: true });
		const trace = compMotifTrace(plan);
		const statements = trace.filter((entry) => entry.transform === 'statement');
		expect(statements.length).toBeGreaterThan(0);
		expect(statements.length).toBeLessThan(infos.length / 4);
		for (const statement of statements) {
			const reprise = trace.find((entry) => entry.motifId === statement.motifId && entry.transform === 'displace')!;
			expect(reprise).toBeDefined();
			expect(reprise.barIndex - statement.barIndex).toBe(2);
			expect(reprise.displacementBeats).not.toBe(0);
			expect(reprise.hits.map((hit) => hit.b)).toEqual(statement.hits.map((hit) => hit.b + reprise.displacementBeats));
			expect(statement.hits).toEqual(compFigureById(statement.sourceFigureId!)!.hits[0]);
			for (const entry of [statement, reprise]) {
				expect(hitsForPlannedBar(plan[entry.barIndex], plan, entry.barIndex, infos[entry.barIndex], 4)).toEqual(entry.hits);
			}
		}
	});

	it('keeps the original planner exact unless both the option and coordinated four-beat context exist', () => {
		const infos = generousInfos();
		const ordinary = infos.map(({ ensemble: _ensemble, ...info }) => info);
		expect(planCompFigures(ordinary, 4, 'gating', 140, undefined, { motifs: true }))
			.toEqual(planCompFigures(ordinary, 4, 'gating', 140));
		expect(planCompFigures(infos, 4, 'gating', 140, undefined, { motifs: false }))
			.toEqual(planCompFigures(infos, 4, 'gating', 140));
		expect(planCompFigures(infos, 3, 'gating', 140, undefined, { motifs: true }))
			.toEqual(planCompFigures(infos, 3, 'gating', 140));
		expect(compMotifTrace(planCompFigures(ordinary, 4, 'gating', 140))).toEqual([]);
	});

	it('requires an audible source and admits later transforms whole without rewriting earlier decisions', () => {
		const baseline = compMotifTrace(planCompFigures(generousInfos(), 4, 'motif-probe', 140, undefined, { motifs: true }));
		for (const blockedOffset of [0, 2]) {
			const infos = generousInfos().map((info, bar) => bar % 4 === blockedOffset ? {
				...info, ensemble: { ...info.ensemble!, piano: { ...info.ensemble!.piano, maxAttacks: 0 as const, densityScale: 0 } }
			} : info);
			const plan = planCompFigures(infos, 4, 'motif-probe', 140, undefined, { motifs: true });
			const trace = compMotifTrace(plan);
			if (blockedOffset === 0) {
				expect(trace.some((entry) => entry.transform === 'statement')).toBe(false);
				expect(trace.some((entry) => entry.reason === 'gesture_does_not_fit')).toBe(true);
			} else {
				expect(trace.filter((entry) => entry.transform === 'statement')).toEqual(baseline.filter((entry) => entry.transform === 'statement'));
				expect(trace.some((entry) => entry.transform === 'displace')).toBe(false);
				expect(trace.some((entry) => entry.transform === 'space' && entry.reason === 'ensemble_silence')).toBe(true);
			}
			for (const entry of trace) {
				if (blockedOffset === 0) expect(entry.sourceFigureId).toBeNull();
				expect(entry.hits.length).toBeLessThanOrEqual(infos[entry.barIndex].ensemble!.piano.maxAttacks);
			}
		}
	});

	it('keeps transforms on the eighth grid with truthful tags and complete final-bar hits', () => {
		const infos = generousInfos();
		let transformed = 0;
		for (let seed = 0; seed < 12; seed++) {
			const plan = planCompFigures(infos, 4, `motif-final-${seed}`, 140, undefined, { motifs: true });
			for (const [bar, planned] of plan.entries()) {
				if (!planned.transformedFigure) continue;
				transformed++;
				const figure = planned.transformedFigure;
				expect(planned.motif!.hits).toEqual(figure.hits[0]);
				expect(figure.tags.includes('push')).toBe(figure.hits[0].some((hit) => hit.b === 3.5));
				expect(figure.tags.includes('early')).toBe(figure.hits[0].some((hit) => hit.b === 0));
				for (const hit of figure.hits[0]) {
					expect(hit.b * 2 % 1).toBe(0);
					expect(hit.b).toBeGreaterThanOrEqual(0);
					expect(hit.b).toBeLessThan(infos[bar].isFinalBar ? 3.5 : 4);
				}
			}
		}
		expect(transformed).toBeGreaterThan(0);
	});

	it('preserves an explicitly withheld final cell with positive budget instead of inventing a resolution pad', () => {
		const infos = generousInfos();
		const final = infos.length - 1;
		let checked = false;
		for (let seed = 0; seed < 12 && !checked; seed++) {
			const phraseId = `motif-final-${seed}`;
			const baseline = planCompFigures(infos, 4, phraseId, 140, undefined, { motifs: true });
			if (baseline[final].motif?.transform !== 'shorten') continue;
			const reserved = infos.map((info, bar) => bar === final ? {
				...info, ensemble: { ...info.ensemble!, responseOwner: 'piano' as const }
			} : info);
			const plan = planCompFigures(reserved, 4, phraseId, 140, undefined, { motifs: true });
			expect(reserved[final].ensemble!.piano.maxAttacks).toBe(2);
			expect(plan[final].motif).toMatchObject({ transform: 'space', reason: 'response_reserved', hits: [] });
			expect(hitsForPlannedBar(plan[final], plan, final, reserved[final], 4)).toEqual([]);
			checked = true;
		}
		expect(checked).toBe(true);
	});

	it('declines shortened form groups and episodes extending beyond actual harmony', () => {
		const infos = generousInfos();
		for (const length of [1, 2, 3]) {
			const short = infos.slice(0, length);
			const trace = compMotifTrace(planCompFigures(short, 4, 'motif-probe', 140, undefined, { motifs: true }));
			expect(trace).toHaveLength(length);
			expect(trace.every((entry) => entry.transform === 'fallback' && entry.reason === 'short_phrase')).toBe(true);
		}
		const partial = compMotifTrace(planCompFigures(infos, 4, 'motif-probe', 140, undefined, {
			motifs: true, harmonyEndBeat: infos.length * 4 - 2
		}));
		expect(partial.slice(-4).every((entry) => entry.transform === 'fallback' && entry.reason === 'incomplete_harmony')).toBe(true);
	});

	it('replays immutable trace and complete transformed figures without mutating the caller', () => {
		const infos = generousInfos();
		const before = JSON.stringify(infos);
		const plan = planCompFigures(infos, 4, 'motif-probe', 140, undefined, { motifs: true });
		expect(planCompFigures(infos, 4, 'motif-probe', 140, undefined, { motifs: true })).toEqual(plan);
		expect(JSON.stringify(infos)).toBe(before);
		const trace = compMotifTrace(plan);
		for (const replay of [trace, freezeCompMotifTrace(JSON.parse(JSON.stringify(trace)))]) {
			expect(replay).toEqual(trace);
			expect(Object.isFrozen(replay)).toBe(true);
			for (const entry of replay) {
				expect(Object.isFrozen(entry)).toBe(true);
				expect(Object.isFrozen(entry.hits)).toBe(true);
				for (const hit of entry.hits) expect(Object.isFrozen(hit)).toBe(true);
			}
		}
	});

	it('realizes the trace as generated piano events and gives accepted motif gaps sounding silence', () => {
		let statements = 0;
		let spaces = 0;
		for (let seed = 0; seed < 12; seed++) {
			const generated = generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, {
				phraseId: `motif-events-${seed}`, tempo: 140, ppq: 192, beatsPerBar: 4, swing: 0.733,
				sectionMap: preset.phrase.sectionMap, ensemble: {}
			});
			const trace = generated.ensembleDevelopment!.pianoMotifs;
			for (const entry of trace) {
				const events = generated.compEvents.filter((event) => Math.floor(event.absBeat / 4) === entry.barIndex);
				expect(events.map((event) => event.absBeat - entry.barIndex * 4)).toEqual(entry.hits.map((hit) => hit.b));
				if (entry.transform === 'statement') statements++;
				if (entry.transform !== 'space') continue;
				spaces++;
				expect(events).toHaveLength(0);
				const startTick = entry.barIndex * 4 * 192;
				const endTick = startTick + 4 * 192;
				for (const event of generated.compEvents) {
					const tick = parseInt(event.time, 10);
					const stop = tick + event.duration * 140 / 60 * 192;
					expect(tick >= endTick || stop <= startTick + 1e-8).toBe(true);
				}
			}
		}
		expect(statements).toBeGreaterThan(0);
		expect(spaces).toBeGreaterThan(0);
	});

	it('revoices a displaced rhythm against the harmony sounding at each new attack', () => {
		const infos = generousInfos();
		const harmony: HarmonicSegment[] = infos.map((_, bar) => ({
			chord: { root: bar % 4 < 2 ? 'C' : 'F#', quality: 'maj7' }, scaleId: 'major',
			startOffset: [bar, 1], duration: [1, 1]
		}));
		const generated = generateComping(harmony, 4, BACKING_STYLES.swing, {
			phraseId: 'motif-probe', tempo: 140, ppq: 192, beatsPerBar: 4, swing: 0.733,
			ensemble: {}, timing: BACKING_STYLES.swing.timing
		}, infos);
		let pairs = 0;
		for (const source of generated.motifTrace!.filter((entry) => entry.transform === 'statement')) {
			const reprise = generated.motifTrace!.find((entry) => entry.motifId === source.motifId && entry.transform === 'displace')!;
			const sourceNotes = generated.events.filter((event) => Math.floor(event.absBeat / 4) === source.barIndex).map((event) => event.notes);
			const repriseNotes = generated.events.filter((event) => Math.floor(event.absBeat / 4) === reprise.barIndex).map((event) => event.notes);
			expect(sourceNotes.length).toBe(source.hits.length);
			expect(repriseNotes.length).toBe(reprise.hits.length);
			expect(repriseNotes).not.toEqual(sourceNotes);
			pairs++;
		}
		expect(pairs).toBeGreaterThan(0);
	});

	it('retains an already chosen source event when later dense solo evidence withholds its reprise', () => {
		let checked = false;
		for (let seed = 0; seed < 12 && !checked; seed++) {
			const params = {
				phraseId: `motif-events-${seed}`, tempo: 140, ppq: 192, beatsPerBar: 4, swing: 0.733,
				sectionMap: preset.phrase.sectionMap, ensemble: {}
			};
			const before = generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, params);
			const source = before.ensembleDevelopment!.pianoMotifs.find((entry) => entry.transform === 'statement');
			if (!source) continue;
			const observedBar = source.barIndex + 2;
			const after = generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, {
				...params, ensemble: { soloFeatures: [{
					barIndex: observedBar, observedAtBar: observedBar, source: 'scripted',
					confidence: 1, noteDensity: 0.95, restBeats: 0
				}] }
			});
			expect(after.ensembleDevelopment!.pianoMotifs[source.barIndex]).toEqual(source);
			expect(after.compEvents.filter((event) => Math.floor(event.absBeat / 4) === source.barIndex))
				.toEqual(before.compEvents.filter((event) => Math.floor(event.absBeat / 4) === source.barIndex));
			expect(after.ensembleDevelopment!.pianoMotifs[observedBar]).toMatchObject({ transform: 'space', reason: 'ensemble_silence' });
			expect(after.compEvents.filter((event) => Math.floor(event.absBeat / 4) === observedBar)).toEqual([]);
			checked = true;
		}
		expect(checked).toBe(true);
	});

	it('does not claim a motif when sustained dense soloing suppresses its source', () => {
		const generated = generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, {
			phraseId: 'motif-events-0', tempo: 140, ppq: 192, beatsPerBar: 4, swing: 0.733,
			sectionMap: preset.phrase.sectionMap,
			ensemble: { soloFeatures: Array.from({ length: preset.bars }, (_, barIndex) => ({
				barIndex, observedAtBar: barIndex, source: 'scripted', confidence: 1, noteDensity: 0.95, restBeats: 0
			})) }
		});
		expect(generated.ensembleDevelopment!.pianoMotifs.every((entry) => entry.transform === 'fallback')).toBe(true);
		for (const plan of generated.ensemblePlan!.bars) {
			const events = generated.compEvents.filter((event) => Math.floor(event.absBeat / 4) === plan.barIndex);
			expect(events.length).toBeLessThanOrEqual(plan.piano.maxAttacks);
		}
	});
});
