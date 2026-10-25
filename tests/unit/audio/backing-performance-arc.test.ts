import { describe, expect, it } from 'vitest';
import { generateBacking } from '$lib/audio/backing-generation';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildListeningTuneSession, LISTENING_TUNES } from '$lib/musicality/listening-tunes';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { buildPerformanceForm } from '$lib/audio/performance-form';

const session = buildListeningTuneSession({ tuneId: LISTENING_TUNES[0].id, soloChoruses: 2 });
const phrase = session.phrase;
const soloForm = { ...phrase.performanceForm, choruses: phrase.performanceForm.choruses.map((chorus) => ({ ...chorus, role: 'solo' as const })) };
const styles = ['swing', 'straight', 'bossa-nova', 'ballad'] as const;
const params = { phraseId: 'structural-arc-real-tune', tempo: 140, ppq: 192, beatsPerBar: 4, swing: 0.67,
	sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm };

describe.each(styles)('%s performed structural arc', (id) => {
	it('realizes head/solo arrangement changes in the actual accompaniment while preserving Original', () => {
		const style = BACKING_STYLES[id];
		const original = generateBacking(phrase.harmony, style, params);
		const originalAllSolo = generateBacking(phrase.harmony, style, { ...params, performanceForm: soloForm });
		expect(original.bassEvents).toEqual(originalAllSolo.bassEvents);
		expect(original.compEvents).toEqual(originalAllSolo.compEvents);
		expect(original.drumEvents).toEqual(originalAllSolo.drumEvents);
		const arranged = generateBacking(phrase.harmony, style, { ...params, ensemble: {} });
		const allSolo = generateBacking(phrase.harmony, style, { ...params, performanceForm: soloForm, ensemble: {} });
		// Compare emitted music, not just the planner's explanatory metadata.
		expect(arranged.compEvents).not.toEqual(allSolo.compEvents);
		expect(arranged.drumEvents).not.toEqual(allSolo.drumEvents);
		const headOut = phrase.performanceForm.choruses.at(-1)!;
		const meanEnergy = (start: number, end: number) => arranged.ensemblePlan!.bars.slice(start, end)
			.reduce((sum, bar) => sum + bar.energy, 0) / (end - start);
		expect(meanEnergy(headOut.endBarExclusive - 4, headOut.endBarExclusive))
			.toBeLessThan(meanEnergy(headOut.startBar, headOut.startBar + 4));
		for (const bar of arranged.ensemblePlan!.bars) {
			const at = (event: { absBeat: number }) => Math.floor(event.absBeat / 4) === bar.barIndex;
			const bass = arranged.bassEvents.filter(at);
			const drums = arranged.drumEvents.filter(at);
			expect(bass.length).toBeGreaterThan(0);
			expect(arranged.compEvents.filter(at).length).toBeLessThanOrEqual(bar.piano.maxAttacks);
			expect(drums.filter((hit) => hit.role === 'commentary').length).toBeLessThanOrEqual(bar.drums.maxCommentaryHits);
			if (id === 'bossa-nova') {
				expect(drums.filter((hit) => hit.drum === 'crossstick').map((hit) => hit.absBeat))
					.toEqual(original.drumEvents.filter(at).filter((hit) => hit.drum === 'crossstick').map((hit) => hit.absBeat));
				expect(drums.filter((hit) => hit.drum === 'hihat')).toHaveLength(8);
				expect(bass.every((hit) => [0, 1.5, 2, 3.5].includes(hit.absBeat % 4))).toBe(true);
			} else {
				for (let beat = 0; beat < 4; beat++) {
					expect(drums.some((hit) => hit.absBeat === bar.barIndex * 4 + beat &&
						['ride', 'ride-bell', 'crash'].includes(hit.drum))).toBe(true);
				}
			}
			if (id === 'ballad') {
				expect(bar.energy).toBeLessThanOrEqual(0.6);
				expect(bass.every((hit) => hit.absBeat % 2 === 0)).toBe(true);
			}
		}
	});
	it('uses the same complete-tune energy plan in fixed and rolling playback', () => {
		const input = { ...params, ensemble: {} };
		const fixed = generateBacking(phrase.harmony, BACKING_STYLES[id], input);
		const score = createRollingBacking(phrase.harmony, BACKING_STYLES[id], input);
		let checkpoint: RollingBackingCheckpoint | undefined;
		for (let bar = 0; bar < score.totalBars; bar++) {
			const step = advanceRollingBacking(score, checkpoint);
			expect(step.ensemblePlan.bars[0]).toEqual(fixed.ensemblePlan!.bars[bar]);
			expect(step.ensemblePlan.bars[0].performanceEnergy).toBeDefined();
			checkpoint = step.checkpoint;
		}
	});
	it('preserves actual continuation through a loop seam and dense-solo restraint at the peak', () => {
		const score = createRollingBacking(phrase.harmony, BACKING_STYLES[id], { ...params, ensemble: {} }, { loopCount: 2 });
		let checkpoint: RollingBackingCheckpoint | undefined;
		let observedPeaks = 0;
		for (let bar = 0; bar <= score.sourceBars; bar++) {
			const step = advanceRollingBacking(score, checkpoint);
			if (bar === score.sourceBars - 1 || bar === score.sourceBars) {
				expect(step).toEqual(advanceRollingBacking(JSON.parse(JSON.stringify(score)), checkpoint && JSON.parse(JSON.stringify(checkpoint))));
			}
			const plan = step.ensemblePlan.bars[0];
			if (plan.performanceEnergy?.phase === 'solo_peak') {
				observedPeaks++;
				const dense = advanceRollingBacking(score, checkpoint, [{ barIndex: bar, observedAtBar: Math.max(0, bar - 1),
					source: 'scripted', confidence: 1, noteDensity: 1, restBeats: 0 }]);
				expect(dense.ensemblePlan.trace[0].soloEvidence).toBe('active');
				expect(dense.compEvents.length).toBeLessThanOrEqual(dense.ensemblePlan.bars[0].piano.maxAttacks);
				expect(dense.ensemblePlan.bars[0].piano.maxAttacks).toBeLessThanOrEqual(1);
				expect(dense.drumEvents.some((hit) => hit.role === 'commentary')).toBe(false);
				expect(dense.bassEvents.length).toBeGreaterThan(0);
			}
			checkpoint = step.checkpoint;
		}
		expect(observedPeaks).toBeGreaterThan(0);
	});
});

it('does not infer a performance arc from sections or the rolling fallback form, and binds explicit provenance', () => {
	const input = { ...params, performanceForm: undefined, ensemble: {} };
	const fixed = generateBacking(phrase.harmony, BACKING_STYLES.swing, input);
	expect(fixed.ensemblePlan!.bars.every((bar) => bar.performanceEnergy === undefined)).toBe(true);
	const implicit = createRollingBacking(phrase.harmony, BACKING_STYLES.swing, input);
	expect(implicit.bars.every((bar) => bar.performanceEnergy === undefined)).toBe(true);
	const first = advanceRollingBacking(implicit);
	expect(first.ensemblePlan.bars[0].performanceEnergy).toBeUndefined();
	// Identical score and form shape; only the caller's explicit declaration differs.
	const performanceForm = buildPerformanceForm({ totalBars: implicit.totalBars, sectionMap: phrase.sectionMap ?? [],
		choruses: [{ role: 'solo', startBar: 0, endBarExclusive: implicit.totalBars }] });
	expect(implicit.performanceForm).toEqual(performanceForm);
	const explicit = createRollingBacking(phrase.harmony, BACKING_STYLES.swing, { ...input, performanceForm });
	expect(explicit.bars.every((bar) => bar.performanceEnergy !== undefined)).toBe(true);
	expect(() => advanceRollingBacking(explicit, first.checkpoint)).toThrow(/checkpoint/i);
	expect(() => advanceRollingBacking(implicit, advanceRollingBacking(explicit).checkpoint)).toThrow(/checkpoint/i);
});
