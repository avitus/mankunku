import { describe, expect, it, vi } from 'vitest';
import { PITCH_CLASSES, type HarmonicSegment, type ChordQuality } from '$lib/types/music';
import { buildPerformanceForm } from '$lib/audio/performance-form';
import { generateComping } from '$lib/audio/backing-generation';
import { createRollingBacking, advanceRollingBacking } from '$lib/audio/backing-rolling';
import { realizeRollingPiano } from '$lib/audio/backing-rolling-piano';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { selectCoordinatedVoicingFamily } from '$lib/audio/coordinated-voicing-family';
import { CHORD_DEFINITIONS } from '$lib/music/chords';

const harmony: HarmonicSegment[] = [{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [0, 1], duration: [2, 1] }];
const performanceForm = buildPerformanceForm({ totalBars: 2, sectionMap: [], choruses: [{ role: 'solo', startBar: 0, endBarExclusive: 2 }] });
const timing = { place: (beat: number) => beat * 192, arrivalTick: (beat: number) => beat * 192, trace: [] };

describe('coordinated piano family policy', () => {
	it('uses the fixed family choice at each accepted current-energy attack in rolling playback', () => {
		const style = BACKING_STYLES.ballad;
		const native = vi.spyOn(style, 'compPattern').mockImplementation(() => [{ beatOffset: 0, durationBeats: 1, velocity: 60 }]);
		try {
			let energyChanges = 0;
			for (let seed = 0; seed < 48; seed++) {
				const params = { phraseId: `family-policy-${seed}`, tempo: 120, ppq: 192, beatsPerBar: 4,
					swing: style.defaultSwing, performanceForm, ensemble: {} };
				const score = createRollingBacking(harmony, style, params);
				const plan = advanceRollingBacking(score).ensemblePlan.bars[0];
				const families = [];
				for (const intensity of [0.2, 0.9]) {
					const infos = score.bars.map((bar) => ({ ...bar, intensity, ensemble: { ...plan, barIndex: bar.barIndex } }));
					const fixed = generateComping(harmony, 4, style, { ...params, ensembleTiming: timing }, infos);
					const rolling = realizeRollingPiano(score, 0, infos[0], timing);
					expect(fixed.events[0].absBeat).toBe(0);
					expect(rolling.events[0].absBeat).toBe(0);
					expect(rolling.voicingTrace![0].decision.requestedFamily, `seed=${seed}, intensity=${intensity}`)
						.toBe(fixed.voicingTrace![0].decision.requestedFamily);
					expect(rolling.events[0].notes).toEqual(fixed.events[0].notes);
					expect(rolling.events[0]).toMatchObject({ duration: 0.5, velocity: 60, time: '0i' });
					families.push(rolling.voicingTrace![0].decision.requestedFamily);
				}
				if (families[0] !== families[1]) energyChanges++;
			}
			expect(energyChanges).toBeGreaterThan(0);
		} finally { native.mockRestore(); }
	});

	it('retains family eligibility in every key and native style at low, middle and high energy', () => {
		const quartalQualities = new Set<ChordQuality>(['maj7', 'min7', '7', 'maj6', 'min6', 'sus4', 'sus2', 'minMaj7']);
		for (const root of PITCH_CLASSES) for (const quality of Object.keys(CHORD_DEFINITIONS) as ChordQuality[]) {
			for (const style of ['swing', 'straight', 'bossa-nova', 'ballad'] as const) for (const intensity of [0.2, 0.5, 0.9]) {
				for (let segmentIndex = 0; segmentIndex < 12; segmentIndex++) {
					const input = { chord: { root, quality }, phraseId: 'family-eligibility', tempo: 140,
						segmentIndex, intensity, voicingBias: BACKING_STYLES[style].voicingBias };
					const family = selectCoordinatedVoicingFamily(input);
					expect(selectCoordinatedVoicingFamily(input)).toBe(family);
					if (quality === 'aug' || quality === 'dim') expect(['shell', 'drop2']).toContain(family);
					if (!quartalQualities.has(quality)) expect(family).not.toBe('quartal');
				}
			}
		}
	});

	it('keeps triad choices independent of intensity, including native style multipliers', () => {
		for (const quality of ['aug', 'dim'] as const) for (let segmentIndex = 0; segmentIndex < 128; segmentIndex++) {
			const input = { chord: { root: 'F#' as const, quality }, phraseId: 'triad-policy', tempo: 140,
				segmentIndex, voicingBias: BACKING_STYLES.ballad.voicingBias };
			expect(selectCoordinatedVoicingFamily({ ...input, intensity: 0.2 }))
				.toBe(selectCoordinatedVoicingFamily({ ...input, intensity: 0.9 }));
		}
	});

	it('keeps the existing low-energy shell preference, high-energy quartal preference and Ballad color bias', () => {
		const count = (intensity: number, style: 'swing' | 'ballad') => {
			const totals = { 'rootless-a': 0, 'rootless-b': 0, shell: 0, drop2: 0, quartal: 0 };
			for (let segmentIndex = 0; segmentIndex < 2048; segmentIndex++) {
				const family = selectCoordinatedVoicingFamily({ chord: { root: 'C', quality: 'min7' },
					phraseId: 'native-family-color', tempo: 140, segmentIndex, intensity, voicingBias: BACKING_STYLES[style].voicingBias });
				totals[family]++;
			}
			return totals;
		};
		const low = count(0.2, 'swing');
		const high = count(0.9, 'swing');
		expect(low.shell).toBeGreaterThan(high.shell);
		expect(high.quartal).toBeGreaterThan(low.quartal);
		const ballad = count(0.5, 'ballad');
		const swing = count(0.5, 'swing');
		expect(ballad.drop2 + ballad.quartal).toBeGreaterThan(swing.drop2 + swing.quartal);
	});
});
