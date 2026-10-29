import { describe, expect, it } from 'vitest';
import { generateBacking } from '$lib/audio/backing-generation';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { buildHistoricalListeningTuneSession as buildListeningTuneSession, HISTORICAL_LISTENING_TUNES as LISTENING_TUNES } from '../../helpers/musicality-tune-fixtures';

const tune = LISTENING_TUNES.find((entry) => entry.title === 'When the Saints Go Marching In')!;
const session = buildListeningTuneSession({ tuneId: tune.id, soloChoruses: 4 });
const params = { phraseId: 'structural-texture-real-tune', tempo: 140, ppq: 192, beatsPerBar: 4, swing: 0.67,
	sectionMap: session.phrase.sectionMap, performanceForm: session.phrase.performanceForm, ensemble: {} };

describe.each(['swing', 'straight'] as const)('%s full-tune structural textures', (style) => {
	it('realizes sustained peak bell time and returns to melody two-feel, including checkpoint continuation', () => {
		// The actual 16-bar chart has full phrase-sized peaks. A 12-bar chart
		// may conservatively keep ride when its peak cuts across a phrase.
		let matched: { input: typeof params; fixed: ReturnType<typeof generateBacking> } | undefined;
		for (let seed = 0; seed < 24 && !matched; seed++) {
			const input = { ...params, phraseId: `structural-texture-real-tune-${seed}` };
			const fixed = generateBacking(session.phrase.harmony, BACKING_STYLES[style], input);
			if (fixed.drumEvents.some((event) => event.drum === 'ride-bell' && event.role === 'timekeeping')) matched = { input, fixed };
		}
		expect(matched, 'A reachable real-tune peak must actually emit sustained bell time').toBeDefined();
		const { input, fixed } = matched!;
		const score = createRollingBacking(session.phrase.harmony, BACKING_STYLES[style], input);
		const headOut = session.phrase.performanceForm.choruses.at(-1)!;
		let checkpoint: RollingBackingCheckpoint | undefined;
		let restoredBell = false;
		let heardBellBars = 0;
		for (let bar = 0; bar < score.totalBars; bar++) {
			const step = advanceRollingBacking(score, checkpoint);
			const trace = step.ensembleDevelopment.drumPhrases[0];
			const fixedTrace = fixed.ensembleDevelopment!.drumPhrases[bar];
			expect(trace.ride.voice).toBe(fixedTrace.ride.voice);
			expect(step.ensembleDevelopment.bassFeel?.[0]).toEqual(fixed.ensembleDevelopment!.bassFeel?.[bar]);
			if (trace.ride.voice === 'ride-bell') {
				heardBellBars++;
				expect(step.ensemblePlan.bars[0].performanceEnergy?.phase).toBe('solo_peak');
				expect(trace.phraseLength).toBeGreaterThanOrEqual(2);
				for (const events of [step.drumEvents, fixed.drumEvents.filter((event) => Math.floor(event.absBeat / 4) === bar)]) {
					// Shared accents can replace one cymbal stroke; the remaining
					// quarter-note time must be the reserved bell texture.
					expect(events.filter((event) => event.role === 'timekeeping' && Number.isInteger(event.absBeat) && event.drum === 'ride-bell').length).toBeGreaterThanOrEqual(3);
				}
				if (checkpoint?.drums.phrase.rideVoice === 'ride-bell' && bar < checkpoint.drums.phrase.end) {
					expect(step).toEqual(advanceRollingBacking(JSON.parse(JSON.stringify(score)), JSON.parse(JSON.stringify(checkpoint))));
					restoredBell = true;
				}
			}
			if (bar >= headOut.startBar) {
				expect(step.ensembleDevelopment.bassFeel?.[0].feel).toBe('two');
				for (const events of [step.bassEvents, fixed.bassEvents.filter((event) => Math.floor(event.absBeat / 4) === bar)]) {
					expect(events.filter((event) => Number.isInteger(event.absBeat)).map((event) => event.absBeat % 4)).toEqual([0, 2]);
				}
				expect(trace.ride.voice).toBe('ride');
			}
			checkpoint = step.checkpoint;
		}
		expect(heardBellBars).toBeGreaterThanOrEqual(2);
		expect(restoredBell).toBe(true);
	});
});
