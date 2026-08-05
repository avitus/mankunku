import { describe, it, expect } from 'vitest';
import type { HarmonicSegment, PitchClass, ChordQuality } from '$lib/types/music';
import { generateBassLine } from '$lib/audio/backing-bass';
import {
	buildBarInfos,
	generateBacking,
	type BackingGenerationParams
} from '$lib/audio/backing-generation';
import { BACKING_STYLES, type StyleDefinition } from '$lib/audio/backing-styles';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';
import { getScale } from '$lib/music/scales';
import { realizeScale } from '$lib/music/keys';
import { pitchClassToNumber } from '$lib/audio/voicings';

const PPQ = 192;

function params(overrides: Partial<BackingGenerationParams> = {}): BackingGenerationParams {
	return {
		phraseId: 'bass-probe',
		tempo: 140,
		ppq: PPQ,
		beatsPerBar: 4,
		swing: 0.67,
		...overrides
	};
}

const pc = (midi: number) => ((midi % 12) + 12) % 12;

const blues = BACKING_LAB_PRESETS.find((p) => p.id === 'lab-blues-f')!;
const bluesInfos = buildBarInfos(blues.bars, blues.phrase.sectionMap);

/** Quarter-note line only (ghosts/pickups/triplets decorate, they aren't the line). */
function quarterLine(harmony: HarmonicSegment[], p: BackingGenerationParams) {
	const infos = buildBarInfos(
		Math.ceil(harmony.reduce((m, s) => Math.max(m, (s.startOffset[0] / s.startOffset[1] + s.duration[0] / s.duration[1]) * 4), 0) / 4),
		p.sectionMap
	);
	const { events } = generateBassLine(harmony, 4, p, infos);
	return events.filter((e) => e.absBeat % 1 === 0).sort((a, b) => a.absBeat - b.absBeat);
}

describe('generateBassLine properties (blues, many seeds)', () => {
	const seeds = [0, 1, 2, 3, 4, 5, 6, 7];

	it('stays in the upright band and never machine-guns a pitch', () => {
		const aabaPreset = BACKING_LAB_PRESETS.find((x) => x.id === 'lab-aaba-c')!;
		const forms: Array<[string, typeof blues]> = [
			['blues', blues],
			['aaba', aabaPreset]
		];
		for (const tempo of [90, 140, 160, 240])
		for (const [label, preset] of forms) for (const seed of seeds) {
			const p = params({
				phraseId: `bass-probe-${label}#${seed}`,
				tempo,
				sectionMap: preset.phrase.sectionMap
			});
			const line = quarterLine(preset.phrase.harmony, p);
			let run = 1;
			for (let i = 0; i < line.length; i++) {
				expect(line[i].midi).toBeGreaterThanOrEqual(28);
				expect(line[i].midi).toBeLessThanOrEqual(55);
				if (i > 0) {
					run = line[i].midi === line[i - 1].midi ? run + 1 : 1;
					expect(run, `${label}@${tempo}: pitch ${line[i].midi} repeated ${run}x at beat ${line[i].absBeat} (seed ${seed})`).toBeLessThanOrEqual(2);
				}
			}
		}
	});

	it('moves mostly stepwise with bounded leaps and damped oscillation', () => {
		const inDeviceZone = (absBeat: number): boolean =>
			blues.phrase.harmony.some((s) => {
				const start = (s.startOffset[0] / s.startOffset[1]) * 4;
				const dur = (s.duration[0] / s.duration[1]) * 4;
				return absBeat >= start + dur - 2 && absBeat < start + dur;
			});
		// Pool across seeds: single-seed walk-interval counts are small on a
		// device-heavy form, so per-seed ratios are statistical noise.
		let steps = 0;
		let walkIntervals = 0;
		for (const seed of seeds) {
			const p = params({ phraseId: `bass-probe#${seed}` });
			const line = quarterLine(blues.phrase.harmony, p);
			let aba = 0;
			for (let i = 1; i < line.length; i++) {
				const interval = Math.abs(line[i].midi - line[i - 1].midi);
				// The octave-drop approach device is, by design, an octave
				// leap resolving down a half step — a 13-semitone internal
				// drop is its signature. Everything else stays ≤ 12.
				expect(interval).toBeLessThanOrEqual(13);
				if (i >= 2 && line[i].midi === line[i - 2].midi && interval > 0) aba++;
				// Stepwise-ness is a property of the WALK; the approach-device
				// zones are deliberately leapy vocabulary.
				if (inDeviceZone(line[i].absBeat) || inDeviceZone(line[i - 1].absBeat)) continue;
				walkIntervals++;
				if (interval >= 1 && interval <= 2) steps++;
			}
			expect(aba / (line.length - 1)).toBeLessThan(0.25);
		}
		expect(walkIntervals).toBeGreaterThan(50);
		expect(steps / walkIntervals).toBeGreaterThan(0.55);
	});

	it('anchors downbeats on chord tones with the root strongly favored', () => {
		let roots = 0;
		let downbeats = 0;
		for (const seed of seeds) {
			const p = params({ phraseId: `bass-probe#${seed}` });
			const line = quarterLine(blues.phrase.harmony, p);
			for (const e of line) {
				if (e.absBeat % 4 !== 0) continue;
				const seg = blues.phrase.harmony.find((s) => {
					const start = (s.startOffset[0] / s.startOffset[1]) * 4;
					const dur = (s.duration[0] / s.duration[1]) * 4;
					return e.absBeat >= start && e.absBeat < start + dur;
				})!;
				const rootPc = pitchClassToNumber(seg.chord.root);
				downbeats++;
				if (pc(e.midi) === rootPc) roots++;
			}
		}
		expect(roots / downbeats).toBeGreaterThan(0.6);
		expect(roots / downbeats).toBeLessThan(0.95);
	});

	it('keeps interior quarters inside the segment scale (device zone exempt)', () => {
		for (const seed of seeds) {
			const p = params({ phraseId: `bass-probe#${seed}` });
			const line = quarterLine(blues.phrase.harmony, p);
			for (const e of line) {
				const seg = blues.phrase.harmony.find((s) => {
					const start = (s.startOffset[0] / s.startOffset[1]) * 4;
					const dur = (s.duration[0] / s.duration[1]) * 4;
					return e.absBeat >= start && e.absBeat < start + dur;
				})!;
				const start = (seg.startOffset[0] / seg.startOffset[1]) * 4;
				const dur = (seg.duration[0] / seg.duration[1]) * 4;
				// The last two beats of a segment are approach vocabulary —
				// deliberately chromatic (enclosures, double-chromatic runs).
				if (e.absBeat >= start + dur - 2) continue;
				const scale = getScale(seg.scaleId);
				const scalePcs = scale ? realizeScale(seg.chord.root, scale.intervals) : [];
				const inScale = scalePcs.includes(pc(e.midi));
				// Chromatic PASSING tones are legitimate walking vocabulary when
				// they connect by half step in the line itself.
				const i = line.indexOf(e);
				const chromaticInLine =
					(i > 0 && Math.abs(e.midi - line[i - 1].midi) === 1) ||
					(i < line.length - 1 && Math.abs(line[i + 1].midi - e.midi) === 1);
				expect(
					inScale || chromaticInLine,
					`interior beat ${e.absBeat} midi ${e.midi} (${seg.chord.root}${seg.chord.quality}, seed ${seed}) is neither in-scale nor a chromatic passing tone`
				).toBe(true);
			}
		}
	});

	it('announces every chord change: the beat before a new chord approaches it', () => {
		for (const seed of seeds) {
			const p = params({ phraseId: `bass-probe#${seed}` });
			const line = quarterLine(blues.phrase.harmony, p);
			const byBeat = new Map(line.map((e) => [e.absBeat, e.midi]));
			for (const seg of blues.phrase.harmony.slice(1)) {
				const start = (seg.startOffset[0] / seg.startOffset[1]) * 4;
				const before = byBeat.get(start - 1);
				const at = byBeat.get(start);
				if (before === undefined || at === undefined) continue;
				const legal =
					Math.abs(at - before) <= 2 || // chromatic/scalar step into the change
					pc(before) === (pc(at) + 7) % 12 || // dominant of the APPROACHED pitch
					pc(before) === pc(at) || // early arrival (enclosure second half)
					Math.abs(at - before) === 12; // octave drop device
				expect(legal, `no approach into beat ${start} (before=${before}, at=${at}, seed ${seed})`).toBe(true);
			}
		}
	});

	it('is deterministic and returns matching per-bar onsets', () => {
		const p = params();
		const a = generateBassLine(blues.phrase.harmony, 4, p, bluesInfos);
		const b = generateBassLine(blues.phrase.harmony, 4, p, bluesInfos);
		expect(a.events).toEqual(b.events);
		let counted = 0;
		for (const [bar, onsets] of a.onsetsByBar) {
			counted += onsets.length;
			for (const o of onsets) {
				expect(o).toBeGreaterThanOrEqual(0);
				expect(o).toBeLessThan(4);
				expect(a.events.some((e) => Math.abs(e.absBeat - (bar * 4 + o)) < 1e-9)).toBe(true);
			}
		}
		expect(counted).toBe(a.events.length);
	});
});

describe('two-feel choruses', () => {
	const aaba = BACKING_LAB_PRESETS.find((p) => p.id === 'lab-aaba-c')!;
	const infos = buildBarInfos(aaba.bars, aaba.phrase.sectionMap);

	it('a two-feel first chorus rests the weak beats and later choruses walk in 4', () => {
		// Find a seed whose chorus 0 lands in two-feel (deterministic search).
		let found = false;
		for (let seed = 0; seed < 12 && !found; seed++) {
			const p = params({ phraseId: `two-probe#${seed}`, sectionMap: aaba.phrase.sectionMap });
			const { events } = generateBassLine(aaba.phrase.harmony, 4, p, infos);
			const chorus0 = events.filter((e) => e.absBeat < 16 && e.absBeat % 1 === 0);
			const weakBeats = chorus0.filter((e) => e.absBeat % 4 === 1 || e.absBeat % 4 === 3);
			if (weakBeats.length === 0 && chorus0.length > 0) {
				found = true;
				// Chorus 2 (bars 64+) must walk in 4: quarters on every beat.
				const lastChorusQuarters = events.filter(
					(e) => e.absBeat >= 64 * 4 && e.absBeat < 65 * 4 && e.absBeat % 1 === 0
				);
				expect(lastChorusQuarters.length).toBe(4);
			}
		}
		expect(found, 'no seed produced a two-feel first chorus in 12 tries (p≈0.65 each)').toBe(true);
	});
});

describe('stream isolation', () => {
	it('stubbing the comp pattern leaves the bass byte-identical', () => {
		const p = params({ sectionMap: blues.phrase.sectionMap });
		const real = generateBacking(blues.phrase.harmony, BACKING_STYLES.swing, p);
		const stubbed: StyleDefinition = {
			...BACKING_STYLES.swing,
			compPattern: () => []
		};
		const stubbedOut = generateBacking(blues.phrase.harmony, stubbed, p);
		expect(JSON.stringify(stubbedOut.bassEvents)).toBe(JSON.stringify(real.bassEvents));
	});
});
