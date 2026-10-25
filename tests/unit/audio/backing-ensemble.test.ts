import { describe, expect, it } from 'vitest';
import { buildBarInfos, generateBacking, generateBackingCached } from '$lib/audio/backing-generation';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';
import { buildPerformanceForm } from '$lib/audio/performance-form';
import { generateForBounce } from '$lib/audio/backing-bounce';
import { DEFAULT_BACKING_MIX } from '$lib/audio/backing-mix';
import { createEnsembleTiming } from '$lib/audio/ensemble-timing';

const preset = BACKING_LAB_PRESETS.find((p) => p.id === 'lab-aaba-c')!;
const base = {
	phraseId: preset.phrase.id,
	tempo: 140,
	ppq: 192,
	beatsPerBar: 4,
	swing: 0.67,
	sectionMap: preset.phrase.sectionMap,
	performanceForm: preset.phrase.performanceForm
};

describe('coordinated swing generation', () => {
	it('realizes the ensemble silence and commentary budgets while preserving the pulse', () => {
		const generated = generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, {
			...base, ensemble: {}
		});
		expect(generated.ensemblePlan).toBeDefined();
		let silentPianoBars = 0;
		let silentCommentaryBars = 0;
		for (const plan of generated.ensemblePlan!.bars) {
			const inBar = (event: { absBeat: number }) => Math.floor(event.absBeat / 4) === plan.barIndex;
			const piano = generated.compEvents.filter(inBar);
			const drums = generated.drumEvents.filter(inBar);
			expect(piano.length).toBeLessThanOrEqual(plan.piano.maxAttacks);
			expect(drums.filter((e) => e.role === 'commentary').length).toBeLessThanOrEqual(plan.drums.maxCommentaryHits);
			if (plan.piano.maxAttacks === 0) {
				silentPianoBars++;
				expect(piano).toHaveLength(0);
			}
			if (plan.drums.maxCommentaryHits === 0) {
				silentCommentaryBars++;
				expect(drums.some((e) => e.role === 'commentary')).toBe(false);
			}
			for (let beat = 0; beat < 4; beat++) {
				expect(drums.some((e) => e.absBeat === plan.barIndex * 4 + beat &&
					['ride', 'ride-bell', 'crash'].includes(e.drum))).toBe(true);
			}
			expect(generated.bassEvents.some(inBar)).toBe(true);
		}
		expect(silentPianoBars).toBeGreaterThan(0);
		expect(silentCommentaryBars).toBeGreaterThan(0);
	});

	it('uses the foot hi-hat for coordinated swing and preserves original playback as a comparison', () => {
		const original = generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, base);
		const coordinated = generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, { ...base, ensemble: {} });
		expect(original.ensemblePlan).toBeUndefined();
		expect(coordinated.drumEvents.some((e) => e.drum === 'hihat-pedal')).toBe(true);
		expect(coordinated).not.toEqual(original);
		expect(generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, base)).toEqual(original);
	});

	it('caches complete independent plans without contaminating the original generation', () => {
		const params = { ...base, ensemble: {} };
		const first = generateBackingCached(preset.phrase.harmony, BACKING_STYLES.swing, params);
		const second = generateBackingCached(preset.phrase.harmony, BACKING_STYLES.swing, params);
		expect(first.ensemblePlan).toBeDefined();
		expect(second).toEqual(first);
		expect(second.ensemblePlan).not.toBe(first.ensemblePlan);
		expect(Object.isFrozen(second.ensemblePlan!.bars[0].piano)).toBe(true);
		expect(generateBackingCached(preset.phrase.harmony, BACKING_STYLES.swing, base).ensemblePlan).toBeUndefined();
	});

	it('exports a restorable planner checkpoint and phrase timing with independent frozen cache copies', () => {
		const params = { ...base, ensemble: {} };
		const first = generateBackingCached(preset.phrase.harmony, BACKING_STYLES.swing, params);
		const second = generateBackingCached(preset.phrase.harmony, BACKING_STYLES.swing, params);
		expect(first.ensembleMemory).toBeDefined();
		expect(first.ensembleMemory!.nextBar).toBe(preset.bars);
		expect(first.ensembleTiming!.length).toBeGreaterThan(0);
		expect(second).toEqual(first);
		expect(second.ensembleMemory).not.toBe(first.ensembleMemory);
		expect(second.ensembleTiming).not.toBe(first.ensembleTiming);
		expect(Object.isFrozen(second.ensembleMemory!.recentBars)).toBe(true);
		expect(Object.isFrozen(second.ensembleTiming![0])).toBe(true);
		const original = generateBackingCached(preset.phrase.harmony, BACKING_STYLES.swing, base);
		expect(original.ensembleMemory).toBeUndefined();
		expect(original.ensembleTiming).toBeUndefined();
	});

	it('exports musical-development decisions with independent immutable cache copies', () => {
		const params = { ...base, ensemble: {} };
		const first = generateBackingCached(preset.phrase.harmony, BACKING_STYLES.swing, params);
		const replay = generateBackingCached(preset.phrase.harmony, BACKING_STYLES.swing, params);
		expect(first.ensembleDevelopment).toBeDefined();
		expect(first.ensembleDevelopment!.version).toBe(1);
		expect(first.ensembleDevelopment!.pianoMotifs.length).toBeGreaterThan(0);
		expect(first.ensembleDevelopment!.bassTurnarounds.length).toBeGreaterThan(0);
		expect(first.ensembleDevelopment!.drumPhrases).toHaveLength(preset.bars);
		expect(replay).toEqual(first);
		expect(replay.ensembleDevelopment).not.toBe(first.ensembleDevelopment);
		expect(Object.isFrozen(replay.ensembleDevelopment)).toBe(true);
		expect(Object.isFrozen(replay.ensembleDevelopment!.pianoMotifs)).toBe(true);
		expect(Object.isFrozen(replay.ensembleDevelopment!.bassTurnarounds)).toBe(true);
		expect(Object.isFrozen(replay.ensembleDevelopment!.drumPhrases)).toBe(true);
		expect(Object.isFrozen(replay.ensembleDevelopment!.drumPhrases[0].hits)).toBe(true);
		expect(generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, base).ensembleDevelopment).toBeUndefined();
	});

	it('does not propose launches into choruses removed when fitting form to actual harmony', () => {
		const shortened = preset.phrase.harmony.filter((segment) => segment.startOffset[0] / segment.startOffset[1] < 32);
		const generated = generateBacking(shortened, BACKING_STYLES.swing, { ...base, ensemble: {} });
		expect(generated.ensemblePlan!.bars).toHaveLength(32);
		expect(generated.ensembleDevelopment!.bassTurnarounds).toEqual([]);
	});

	it('exports the actual emitted drum phrases and develops them across the listening-lab form', () => {
		const realized = new Set<string>();
		let pianoReplies = 0;
		for (const tempo of [90, 160, 240]) for (let seed = 0; seed < 12; seed++) {
			const generated = generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, {
				...base, tempo, phraseId: `${base.phraseId}#drum${seed}`, ensemble: {}
			});
			for (const bar of generated.ensembleDevelopment!.drumPhrases) {
				const actual = generated.drumEvents.filter((event) => Math.floor(event.absBeat / 4) === bar.barIndex);
				expect(bar.hits.map((hit) => [hit.drum, bar.barIndex * 4 + hit.beatOffset, hit.velocity, hit.role]).sort())
					.toEqual(actual.map((event) => [event.drum, event.absBeat, event.velocity, event.role]).sort());
				expect(bar.commentary.hits.map((hit) => [hit.drum, bar.barIndex * 4 + hit.beatOffset]).sort())
					.toEqual(actual.filter((event) => event.role === 'commentary')
						.map((event) => [event.drum, event.absBeat]).sort());
				if (bar.commentary.hits.length > 0) realized.add(bar.commentary.transform);
				if (bar.commentary.source === 'piano' && bar.commentary.transform === 'answer' && bar.commentary.hits.length > 0) {
					pianoReplies++;
					expect(bar.commentary.sourceBar).toBe(bar.barIndex - 1);
					expect(bar.commentary.sourceOffsets).toEqual(generated.compEvents
						.filter((event) => Math.floor(event.absBeat / 4) === bar.commentary.sourceBar)
						.map((event) => event.absBeat % 4).sort((a, b) => a - b));
					expect(bar.commentary.hits.map((hit) => hit.beatOffset)).toEqual(bar.commentary.sourceOffsets);
				}
			}
		}
		for (const transform of ['statement', 'repeat', 'displace', 'orchestrate']) expect(realized.has(transform)).toBe(true);
		expect(pianoReplies).toBeGreaterThan(0);
	});

	it('keeps the emitted drum trace inside a partial final bar', () => {
		const harmony = [{ ...preset.phrase.harmony[0], startOffset: [0, 1] as [number, number], duration: [9, 8] as [number, number] }];
		const generated = generateBacking(harmony, BACKING_STYLES.swing, { ...base, ensemble: {} });
		expect(generated.ensembleDevelopment!.drumPhrases).toHaveLength(2);
		expect(generated.drumEvents.some((event) => event.absBeat === 4)).toBe(true);
		expect(generated.drumEvents.every((event) => event.absBeat < 4.5)).toBe(true);
		const final = generated.ensembleDevelopment!.drumPhrases[1];
		expect(final.hits.every((hit) => hit.beatOffset < 0.5)).toBe(true);
		expect(final.commentary.motifId).toBeNull();
	});

	it('admits fractional-ending drum gestures against their swung scheduled onsets', () => {
		const harmony = [{ ...preset.phrase.harmony[0], startOffset: [0, 1] as [number, number], duration: [17, 12] as [number, number] }];
		const endBeat = 17 / 3;
		for (let seed = 0; seed < 12; seed++) {
			const generated = generateBacking(harmony, BACKING_STYLES.swing, {
				...base, phraseId: `fractional-drums-${seed}`, swing: 0.78, ensemble: {}
			});
			expect(generated.drumEvents.some((event) => event.absBeat === 5)).toBe(true);
			for (const event of generated.drumEvents) expect(parseInt(event.time, 10)).toBeLessThan(endBeat * base.ppq);
			expect(generated.ensembleDevelopment!.drumPhrases.flatMap((bar) => bar.hits
				.map((hit) => [hit.drum, bar.barIndex * 4 + hit.beatOffset])).sort())
				.toEqual(generated.drumEvents.map((event) => [event.drum, event.absBeat]).sort());
		}
	});

	it('realizes both development devices in the unmodified listening-lab form', () => {
		let launches = 0;
		let reprises = 0;
		for (const tempo of [90, 160, 240]) for (let seed = 0; seed < 12; seed++) {
			const generated = generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, {
				...base, tempo, phraseId: `${base.phraseId}#v${seed}`, ensemble: {}
			});
			for (const launch of generated.ensembleDevelopment!.bassTurnarounds) {
				if (launch.status !== 'planned') continue;
				launches++;
				for (const note of launch.notes) {
					expect(generated.bassEvents.find((event) => event.absBeat === note.absBeat)?.midi).toBe(note.midi);
				}
			}
			for (const reprise of generated.ensembleDevelopment!.pianoMotifs) {
				if (reprise.transform !== 'displace') continue;
				reprises++;
				expect(generated.compEvents.filter((event) => Math.floor(event.absBeat / 4) === reprise.barIndex)
					.map((event) => event.absBeat - reprise.barIndex * 4)).toEqual(reprise.hits.map((hit) => hit.b));
			}
		}
		expect(launches).toBeGreaterThan(0);
		expect(reprises).toBeGreaterThan(0);
	});

	it('resolves explicit internal repeats as one chorus before instrument generation', () => {
		const sectionMap = [{ sourceSection: 0, barOffset: 0 }, { sourceSection: 0, barOffset: 8 },
			{ sourceSection: 1, barOffset: 16 }, { sourceSection: 0, barOffset: 24 }];
		const form = buildPerformanceForm({ totalBars: 32, sectionMap,
			choruses: [{ role: 'head', startBar: 0, endBarExclusive: 32 }] });
		const infos = buildBarInfos(32, sectionMap, form);
		expect(infos.every((bar) => bar.chorusIndex === 0)).toBe(true);
		expect(infos[8].isChorusFirstBar).toBe(false);
		expect(infos[8].isSectionFirstBar).toBe(true);
	});

	it('retains explicit chorus identity when harmony extends beyond or ends before the form', () => {
		const sectionMap = [{ sourceSection: 0, barOffset: 0 }, { sourceSection: 0, barOffset: 4 }];
		const form = buildPerformanceForm({ totalBars: 8, sectionMap,
			choruses: [{ role: 'head', startBar: 0, endBarExclusive: 8 }] });
		for (const length of [6, 10]) {
			const infos = buildBarInfos(length, sectionMap, form);
			expect(infos.every((bar) => bar.chorusIndex === 0)).toBe(true);
			expect(infos[length - 1].isSectionFinalBar).toBe(true);
			expect(infos[4].isChorusFirstBar).toBe(false);
		}
		expect(form.totalBars).toBe(8);
		expect(form.choruses[0].endBarExclusive).toBe(8);
	});

	it('puts reserved bass and drum arrivals on the same tick across seeds and tempi', () => {
		let arrivals = 0;
		for (const tempo of [90, 160, 240]) for (const seed of [0, 1, 2]) {
			const generated = generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, {
				...base, tempo, phraseId: `${base.phraseId}#${seed}`, ensemble: {}
			});
			for (const bar of generated.ensemblePlan!.bars) {
				if (!bar.coordinatedAccent) continue;
				arrivals++;
				const beat = bar.barIndex * 4;
				const bass = generated.bassEvents.find((e) => e.absBeat === beat);
				const accents = generated.drumEvents.filter((e) => e.absBeat === beat && e.role === 'accent');
				expect(bass).toBeDefined();
				expect(accents.length).toBeGreaterThan(0);
				expect(accents.every((e) => e.time === bass!.time)).toBe(true);
				const piano = generated.compEvents.filter((e) => Math.floor(e.absBeat / 4) === bar.barIndex);
				if (bar.piano.arrival?.action === 'catch') {
					expect(piano).toHaveLength(1);
					expect(bar.piano.maxAttacks).toBe(1);
					expect(bar.piano.arrival.accentId).toBe(bar.coordinatedAccent.id);
					expect(piano[0].time).toBe(bass!.time);
				} else expect(piano).toHaveLength(0);
			}
		}
		expect(arrivals).toBeGreaterThan(0);
	});

	it('applies the shared phrase timing to all three realized players', () => {
		for (const tempo of [90, 160, 240]) {
			const generated = generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, {
				...base, tempo, ensemble: {}
			});
			const plan = generated.ensemblePlan!;
			const timing = createEnsembleTiming({ ...base, tempo, plan, timingProfiles: BACKING_STYLES.swing.timing });
			for (const event of generated.bassEvents) {
				const barIndex = Math.floor(event.absBeat / 4);
				const arrival = plan.bars[barIndex]?.coordinatedAccent && event.absBeat % 4 === 0;
				expect(event.time).toBe(`${arrival ? (plan.bars[barIndex].piano.arrival ? Math.max(barIndex * 4 * base.ppq, timing.arrivalTick(barIndex)) : timing.arrivalTick(barIndex)) : timing.place(event.absBeat, 'bass')}i`);
			}
			for (const event of generated.drumEvents) {
				const barIndex = Math.floor(event.absBeat / 4);
				const arrival = plan.bars[barIndex]?.coordinatedAccent && event.role === 'accent' && event.absBeat % 4 === 0;
				expect(event.time).toBe(`${arrival ? (plan.bars[barIndex].piano.arrival ? Math.max(barIndex * 4 * base.ppq, timing.arrivalTick(barIndex)) : timing.arrivalTick(barIndex)) : timing.place(event.absBeat, event.drum)}i`);
			}
			for (const event of generated.compEvents) {
				const barIndex = Math.floor(event.absBeat / 4);
				const catchHit = plan.bars[barIndex].piano.arrival?.action === 'catch';
				const tick = catchHit ? Math.max(barIndex * 4 * base.ppq, timing.arrivalTick(barIndex)) : timing.place(event.absBeat, 'comp');
				const afterRest = barIndex > 0 && (plan.bars[barIndex - 1].piano.maxAttacks === 0 ||
					generated.ensembleDevelopment!.pianoMotifs[barIndex - 1].transform === 'space');
				expect(event.time).toBe(`${afterRest ? Math.max(tick, barIndex * 4 * base.ppq) : tick}i`);
			}
		}
	});

	it('reduces actual commentary under dense observed activity without losing timekeeping', () => {
		const generated = generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, {
			...base, ensemble: { soloFeatures: Array.from({ length: preset.bars }, (_, barIndex) => ({
				barIndex, observedAtBar: barIndex, source: 'scripted', confidence: 1, noteDensity: 1, restBeats: 0
			})) }
		});
		expect(generated.drumEvents.filter((e) => e.role === 'commentary')).toHaveLength(0);
		for (const bar of generated.ensemblePlan!.bars) {
			const piano = generated.compEvents.filter((e) => Math.floor(e.absBeat / 4) === bar.barIndex);
			expect(piano.length).toBeLessThanOrEqual(bar.boundaryStrength >= 0.85 ? 1 : 0);
			expect(generated.bassEvents.some((e) => e.absBeat === bar.barIndex * 4)).toBe(true);
		}
	});

	it('bounces the same coordinated events as playback generation, with original as the default', () => {
		const params = { phrase: preset.phrase, style: 'swing' as const, tempo: 140, swing: 0.67,
			instrument: 'piano' as const, volume: 0.6, mix: DEFAULT_BACKING_MIX };
		expect(generateForBounce(params).ensemblePlan).toBeUndefined();
		expect(generateForBounce({ ...params, orchestration: 'coordinated' })).toEqual(
			generateBacking(preset.phrase.harmony, BACKING_STYLES.swing, { ...base, ensemble: {} })
		);
	});

	it('keeps unsupported meters on the original vocabulary', () => {
		for (const style of [BACKING_STYLES['bossa-nova'], BACKING_STYLES.ballad, BACKING_STYLES.straight]) {
			expect(generateBacking(preset.phrase.harmony, style, { ...base, beatsPerBar: 3, swing: style.defaultSwing, ensemble: {} }))
				.toEqual(generateBacking(preset.phrase.harmony, style, { ...base, beatsPerBar: 3, swing: style.defaultSwing }));
		}
	});
});
