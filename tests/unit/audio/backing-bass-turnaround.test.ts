import { describe, expect, it } from 'vitest';
import { generateBassLine } from '$lib/audio/backing-bass';
import { freezeBassTurnaroundTrace } from '$lib/audio/backing-bass-turnaround';
import { buildBarInfos, type BarInfo, type InstrumentGenerationParams } from '$lib/audio/backing-generation';
import { buildPerformanceForm } from '$lib/audio/performance-form';
import { planEnsemble } from '$lib/audio/ensemble-plan';
import { createEnsembleTiming } from '$lib/audio/ensemble-timing';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import type { ChordQuality, HarmonicSegment, PitchClass } from '$lib/types/music';
import { pitchClassToNumber } from '$lib/audio/voicings';

const form = buildPerformanceForm({
	totalBars: 12, sectionMap: [],
	choruses: [0, 4, 8].map((startBar) => ({ startBar, endBarExclusive: startBar + 4, role: 'solo' as const }))
});
const changes: Array<[PitchClass, ChordQuality, number]> = [
	['C', 'maj7', 4], ['F', 'maj7', 4], ['C', 'maj7', 2], ['A', '7', 2], ['D', 'min7', 2], ['G', '7', 2]
];
const harmony: HarmonicSegment[] = [];
for (let chorus = 0; chorus < 3; chorus++) {
	let beat = chorus * 16;
	for (const [root, quality, length] of changes) {
		harmony.push({ chord: { root, quality }, scaleId: quality === 'min7' ? 'minor.dorian' : quality === '7' ? 'major.mixolydian' : 'major.ionian',
			startOffset: [beat, 4], duration: [length, 4] });
		beat += length;
	}
}

function fixture(seed: number) {
	const ordinary = buildBarInfos(12, undefined, form);
	const plan = planEnsemble({ phraseId: `launch-${seed}`, tempo: 140,
		bars: ordinary.map((info, barIndex) => ({ ...info, barIndex })) });
	const supported = { ...plan, bars: plan.bars.map((bar) => ({ ...bar,
		phraseIntent: 'support' as const, intent: 'support' as const, responseOwner: 'nobody' as const,
		coordinatedAccent: undefined, setupFor: undefined,
		bass: { ...bar.bass, ornamentScale: 1 }
	})) };
	const infos = ordinary.map((info, bar) => ({ ...info, ensemble: supported.bars[bar] }));
	const params: InstrumentGenerationParams = { phraseId: `launch-${seed}`, tempo: 140, ppq: 192,
		beatsPerBar: 4, swing: 0.67, performanceForm: form,
		ensembleTiming: createEnsembleTiming({ phraseId: `launch-${seed}`, tempo: 140, ppq: 192, swing: 0.67, plan: supported }) };
	return { params, infos, ordinary };
}

describe('planned following-chorus bass launches', () => {
	it('realizes a bounded directional two-bar path and its exact root arrival', () => {
		let accepted = 0;
		for (let seed = 0; seed < 60; seed++) {
			const { params, infos } = fixture(seed);
			const result = generateBassLine(harmony, 4, params, infos);
			for (const launch of result.turnaroundTrace ?? []) {
				if (launch.status !== 'planned') continue;
				accepted++;
				expect(launch.notes).toHaveLength(9);
				expect(launch.notes.map((note) => note.absBeat)).toEqual(Array.from({ length: 9 }, (_, i) => launch.startBar * 4 + i));
				const direction = launch.direction === 'ascending' ? 1 : -1;
				const movement = (launch.notes[8].midi - launch.notes[0].midi) * direction;
				expect(movement).toBeGreaterThanOrEqual(6);
				expect(movement).toBeLessThanOrEqual(14);
				let contrary = 0;
				for (const [index, note] of launch.notes.entries()) {
					const sounding = result.events.filter((event) => event.absBeat === note.absBeat);
					expect(sounding).toHaveLength(1);
					expect(sounding[0].midi).toBe(note.midi);
					expect(note.midi).toBeGreaterThanOrEqual(28);
					expect(note.midi).toBeLessThanOrEqual(55);
					if (index) {
						const interval = note.midi - launch.notes[index - 1].midi;
						expect(interval).not.toBe(0);
						expect(Math.abs(interval)).toBeLessThanOrEqual(index === 8 ? 2 : 5);
						contrary += Number(interval * direction < 0);
					}
					const chord = harmony.findLast((segment) => segment.startOffset[0] / segment.startOffset[1] * 4 <= note.absBeat)!;
					if (note.absBeat % 2 === 0) {
						const degree = (note.midi - pitchClassToNumber(chord.chord.root) + 120) % 12;
						expect(CHORD_DEFINITIONS[chord.chord.quality].intervals).toContain(degree);
					}
				}
				expect(contrary).toBeLessThanOrEqual(1);
				expect(launch.notes[8].midi).toBe(launch.targetMidi);
				expect(launch.targetMidi! % 12).toBe(0);
				const before = result.events.filter((event) => Number.isInteger(event.absBeat) && event.absBeat < launch.startBar * 4).at(-1)!;
				expect(Math.abs(launch.notes[0].midi - before.midi)).toBeLessThanOrEqual(7);
				const after = result.events.find((event) => event.absBeat === launch.arrivalBar * 4 + 1)!;
				if (Math.abs(after.midi - launch.targetMidi!) > 7) {
					const baseline = generateBassLine(harmony, 4, { ...params, performanceForm: undefined }, infos).events;
					expect([launch.targetMidi, after.midi]).toEqual([0, 1].map((offset) => baseline.find((event) => event.absBeat === launch.arrivalBar * 4 + offset)!.midi));
				}
			}
		}
		expect(accepted).toBeGreaterThan(0);
	});

	it('retains quarter-note pulse, stable timing and honest skipped-opportunity reasons', () => {
		for (let seed = 0; seed < 24; seed++) {
			const { params, infos } = fixture(seed);
			const result = generateBassLine(harmony, 4, params, infos);
			expect(result.turnaroundTrace?.map((entry) => entry.arrivalBar)).toEqual([4, 8]);
			for (const entry of result.turnaroundTrace ?? []) {
				expect(entry.reason.length).toBeGreaterThan(0);
				if (entry.status !== 'planned') { expect(entry.notes).toEqual([]); continue; }
				for (const note of entry.notes) {
					const sounding = result.events.find((event) => event.absBeat === note.absBeat)!;
					expect(sounding.time).toBe(`${params.ensembleTiming!.place(note.absBeat, 'bass')}i`);
				}
				// The path owns the transition: no independent pitched pickup or
				// triplet cuts across it. Quiet ghost reattacks may keep its pitch.
				const decorations = result.events.filter((event) => event.absBeat >= entry.startBar * 4 && event.absBeat < entry.arrivalBar * 4 && !Number.isInteger(event.absBeat));
				for (const event of decorations) {
					expect(event.velocity).toBeLessThan(50);
					expect(event.midi).toBe(result.events.find((quarter) => quarter.absBeat === Math.floor(event.absBeat))!.midi);
				}
			}
		}
	});

	it('respects dense or spacious support, another response, and existing arrivals', () => {
		const { params, infos } = fixture(4);
		const cases: Array<[string, (info: BarInfo) => BarInfo]> = [
			['reserved_space', (info) => ({ ...info, ensemble: { ...info.ensemble!, bass: { ...info.ensemble!.bass, ornamentScale: 0.35 } } })],
			['reserved_space', (info) => ({ ...info, ensemble: { ...info.ensemble!, phraseIntent: 'leave_space' } })],
			['reserved_space', (info) => ({ ...info, ensemble: { ...info.ensemble!, phraseIntent: 'release' } })],
			['response_reserved', (info) => ({ ...info, ensemble: { ...info.ensemble!, responseOwner: 'piano' } })],
			['arrival_reserved', (info) => ({ ...info, ensemble: { ...info.ensemble!, coordinatedAccent: { id: 'other', targetBarIndex: 6, beatOffset: 0, strength: 1, participants: ['bass', 'drums'] } } })]
		];
		for (const [reason, change] of cases) {
			const reserved = infos.map((info, bar) => bar === 6 ? change(info) : info);
			const result = generateBassLine(harmony, 4, params, reserved);
			expect(result.turnaroundTrace?.find((entry) => entry.arrivalBar === 8)).toMatchObject({ status: 'skipped', reason, notes: [] });
			expect(result.events.filter((event) => event.absBeat >= 24 && event.absBeat < 32 && Number.isInteger(event.absBeat))).toHaveLength(8);
		}
	});

	it('requires actual coordinated roles and explicit following choruses, without changing ordinary generation', () => {
		const { params, infos, ordinary } = fixture(4);
		const withoutForm = { ...params, performanceForm: undefined };
		expect(generateBassLine(harmony, 4, params, ordinary)).toEqual(generateBassLine(harmony, 4, withoutForm, ordinary));
		expect(generateBassLine(harmony, 4, withoutForm, infos).turnaroundTrace).toBeUndefined();
		const single = buildPerformanceForm({ totalBars: 12, sectionMap: [], choruses: [{ startBar: 0, endBarExclusive: 12, role: 'head' }] });
		expect(generateBassLine(harmony, 4, { ...params, performanceForm: single }, infos).turnaroundTrace ?? []).toEqual([]);
		const two = generateBassLine(harmony, 4, params, infos, 'two');
		expect(two.turnaroundTrace?.every((entry) => entry.status === 'skipped' && entry.reason === 'non_walking')).toBe(true);
	});

	it('replays deterministically and keeps path evidence immutable after JSON cache recovery', () => {
		const { params, infos } = fixture(4);
		const first = generateBassLine(harmony, 4, params, infos);
		generateBassLine(harmony, 4, fixture(71).params, infos);
		expect(generateBassLine(harmony, 4, params, infos)).toEqual(first);
		const trace = first.turnaroundTrace!;
		expect(trace).toBeDefined();
		const replay = freezeBassTurnaroundTrace(JSON.parse(JSON.stringify(trace)));
		expect(replay).toEqual(trace);
		for (const value of [trace, replay]) {
			expect(Object.isFrozen(value)).toBe(true);
			for (const entry of value) {
				expect(Object.isFrozen(entry)).toBe(true);
				expect(Object.isFrozen(entry.notes)).toBe(true);
				for (const note of entry.notes) expect(Object.isFrozen(note)).toBe(true);
			}
		}
	});

	it('does not let later solo-conditioned budgets rewrite an accepted earlier path', () => {
		for (let seed = 0; seed < 20; seed++) {
			const { params, infos } = fixture(seed);
			const earlier = generateBassLine(harmony, 4, params, infos);
			const later = infos.map((info, bar) => bar === 7 ? { ...info, ensemble: { ...info.ensemble!,
				responseOwner: 'piano' as const, bass: { ...info.ensemble!.bass, ornamentScale: 0.35 } } } : info);
			const changed = generateBassLine(harmony, 4, params, later);
			expect(changed.events.filter((event) => event.absBeat < 28)).toEqual(earlier.events.filter((event) => event.absBeat < 28));
			expect(changed.turnaroundTrace).toEqual(earlier.turnaroundTrace);
		}
	});

	it('declines rounded harmonic gaps, overlaps, zero arrival durations and missing start anchors', () => {
		const { params, infos } = fixture(4);
		for (const duration of [[3, 8], [5, 8]] as const) {
			const broken = harmony.map((segment) => segment.startOffset[0] === 24 ? { ...segment, duration: [...duration] as [number, number] } : segment);
			expect(generateBassLine(broken, 4, params, infos).turnaroundTrace?.find((entry) => entry.arrivalBar === 8))
				.toMatchObject({ status: 'skipped', reason: 'unsupported_harmony' });
		}
		const zeroArrival = harmony.map((segment) => segment.startOffset[0] === 32 ? { ...segment, duration: [0, 1] as [number, number] } : segment);
		expect(generateBassLine(zeroArrival, 4, params, infos).turnaroundTrace?.find((entry) => entry.arrivalBar === 8))
			.toMatchObject({ status: 'skipped', reason: 'unsupported_harmony' });
		const heldStart = harmony.filter((segment) => segment.startOffset[0] !== 24).map((segment) => segment.startOffset[0] === 20 ? { ...segment, duration: [6, 4] as [number, number] } : segment);
		expect(generateBassLine(heldStart, 4, params, infos).turnaroundTrace?.find((entry) => entry.arrivalBar === 8))
			.toMatchObject({ status: 'skipped', reason: 'missing_start_anchor' });
	});

	it('does not create a new abrupt departure after one-, two-, or four-beat arrival chords across keys', () => {
		const roots: PitchClass[] = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
		let accepted = 0;
		for (const arrivalLength of [1, 2, 4]) for (let transpose = 0; transpose < 12; transpose++) for (let seed = 0; seed < 12; seed++) {
			const { params, infos } = fixture(seed);
			const chart = harmony.flatMap((segment) => {
				if (segment.startOffset[0] % 16 !== 0 || arrivalLength === 4) return [segment];
				return [{ ...segment, duration: [arrivalLength, 4] as [number, number] },
					{ ...segment, chord: { root: 'A' as PitchClass, quality: '7' as ChordQuality }, scaleId: 'major.mixolydian',
						startOffset: [segment.startOffset[0] + arrivalLength, 4] as [number, number], duration: [4 - arrivalLength, 4] as [number, number] }];
			}).map((segment) => ({ ...segment, chord: { ...segment.chord, root: roots[(pitchClassToNumber(segment.chord.root) + transpose) % 12] } }));
			const result = generateBassLine(chart, 4, params, infos);
			const baseline = generateBassLine(chart, 4, { ...params, performanceForm: undefined }, infos);
			for (const launch of result.turnaroundTrace ?? []) {
				if (launch.status !== 'planned') continue;
				accepted++;
				const pair = [0, 1].map((offset) => result.events.find((event) => event.absBeat === launch.arrivalBar * 4 + offset)!.midi);
				if (Math.abs(pair[1] - pair[0]) > 7) {
					expect(pair, `arrival chord ${arrivalLength}, key ${transpose}, seed ${seed}`).toEqual(
						[0, 1].map((offset) => baseline.events.find((event) => event.absBeat === launch.arrivalBar * 4 + offset)!.midi));
				}
			}
		}
		expect(accepted).toBeGreaterThan(0);
	});
});
