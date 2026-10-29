import { describe, expect, it } from 'vitest';
import { generateBacking } from '$lib/audio/backing-generation';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildPerformanceForm } from '$lib/audio/performance-form';
import { buildHistoricalListeningTuneSession as buildListeningTuneSession, HISTORICAL_LISTENING_TUNES as LISTENING_TUNES } from '../../helpers/musicality-tune-fixtures';
import type { HarmonicSegment } from '$lib/types/music';

const harmony: HarmonicSegment[] = [{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [0, 1], duration: [8, 1] }];
const performanceForm = buildPerformanceForm({ totalBars: 8, sectionMap: [], choruses: [{ role: 'solo', startBar: 0, endBarExclusive: 8 }] });
const session = buildListeningTuneSession({ tuneId: LISTENING_TUNES.find(tune => tune.title === 'When the Saints Go Marching In')!.id, soloChoruses: 2 });

describe.each(['swing', 'straight', 'bossa-nova', 'ballad'] as const)('%s shared piano-family integration', id => {
	it('matches the first accepted cold voicing under comparable actual native attack context', () => {
		const style = BACKING_STYLES[id];
		let comparable = 0;
		const families = new Set<string>();
		for (let seed = 0; seed < 32; seed++) {
			const params = { phraseId: `native-family-parity-${id}-${seed}`, tempo: 140, ppq: 192, beatsPerBar: 4,
				swing: style.defaultSwing, performanceForm, ensemble: {} };
			const fixed = generateBacking(harmony, style, params);
			const fixedAttack = fixed.ensembleDevelopment!.pianoVoicings![0];
			const score = createRollingBacking(harmony, style, params);
			let checkpoint: RollingBackingCheckpoint | undefined;
			for (let bar = 0; bar < score.totalBars; bar++) {
				const rolling = advanceRollingBacking(score, checkpoint);
				checkpoint = rolling.checkpoint;
				const rollingAttack = rolling.ensembleDevelopment.pianoVoicings?.[0];
				if (!rollingAttack) continue;
				// Fixed/rolling rhythm planning may choose different cells and
				// guide overrides. Compare the shared policy only when their
				// first actual attack owns the same bar/energy/harmony context.
				if (fixedAttack && Math.floor(fixedAttack.absBeat / 4) === bar &&
					fixedAttack.decision.requestedFamily !== 'guide' && rollingAttack.decision.requestedFamily !== 'guide') {
					expect(rolling.ensemblePlan.bars[0].energy).toBe(fixed.ensemblePlan!.bars[bar].energy);
					expect(rollingAttack.decision.requestedFamily, `seed ${seed}`).toBe(fixedAttack.decision.requestedFamily);
					expect(rollingAttack.notes, `seed ${seed}`).toEqual(fixedAttack.notes);
					expect(rollingAttack.decision.guideMotion).toBeNull();
					expect(fixedAttack.decision.guideMotion).toBeNull();
					families.add(fixedAttack.decision.requestedFamily);
					comparable++;
				}
				break;
			}
		}
		expect(comparable, 'real native attacks must exercise the comparison').toBeGreaterThanOrEqual(16);
		expect(families.size, 'exercise multiple seeded families rather than a constant fallback').toBeGreaterThan(1);
	});

	it('honors a dense soloist silence budget without advancing the emitted voicing history', () => {
		const style = BACKING_STYLES[id];
		const params = { phraseId: `dense-family-policy-${id}`, tempo: 140, ppq: 192, beatsPerBar: 4,
			swing: style.defaultSwing, performanceForm: session.phrase.performanceForm,
			sectionMap: session.phrase.sectionMap, ensemble: {} };
		const score = createRollingBacking(session.phrase.harmony, style, params);
		let checkpoint: RollingBackingCheckpoint | undefined;
		for (let bar = 0; bar < 12; bar++) {
			const next = advanceRollingBacking(score, checkpoint);
			checkpoint = next.checkpoint;
			if (next.compEvents.length) break;
		}
		expect(checkpoint?.piano.voicing?.notes.length).toBeGreaterThan(0);
		const before = JSON.stringify(checkpoint);
		const targetBar = checkpoint!.nextBar;
		const result = advanceRollingBacking(score, checkpoint, [{ barIndex: targetBar, observedAtBar: targetBar - 1,
			source: 'microphone', confidence: .95, noteDensity: 1, restBeats: 0 }]);
		expect(result.ensemblePlan.trace[0].soloEvidence).toBe('active');
		expect(result.ensemblePlan.bars[0].piano.maxAttacks).toBe(0);
		expect(result.compEvents).toEqual([]);
		expect(result.ensembleDevelopment.pianoVoicings).toEqual([]);
		expect(result.checkpoint.piano.voicing).toEqual(checkpoint!.piano.voicing);
		expect(result.checkpoint.piano.lastVoicing).toEqual(checkpoint!.piano.lastVoicing);
		expect(result.bassEvents.length).toBeGreaterThan(0);
		expect(JSON.stringify(checkpoint)).toBe(before);
		expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(result.checkpoint))))
			.toEqual(advanceRollingBacking(score, result.checkpoint));
	});
});
