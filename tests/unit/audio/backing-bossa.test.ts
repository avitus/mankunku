import { describe, it, expect } from 'vitest';
import type { HarmonicSegment, PitchClass, ChordQuality } from '$lib/types/music';
import {
	generateBacking,
	chordToneIntervalsForBass,
	type BackingGenerationParams
} from '$lib/audio/backing-generation';
import { BACKING_STYLES, BACKING_STYLE_IDS } from '$lib/audio/backing-styles';
import { pitchClassToNumber } from '$lib/audio/voicings';

/** One-bar-per-chord 4/4 harmony builder. */
function bars(...chords: Array<[PitchClass, ChordQuality]>): HarmonicSegment[] {
	return chords.map(([root, quality], i) => ({
		chord: { root, quality },
		scaleId: 'major.ionian',
		startOffset: [i, 1] as [number, number],
		duration: [1, 1] as [number, number]
	}));
}

const HARMONY = bars(['D', 'min7'], ['G', '7'], ['C', 'maj7'], ['A', '7']);

function params(overrides: Partial<BackingGenerationParams> = {}): BackingGenerationParams {
	return {
		phraseId: 'bossa-probe',
		tempo: 130,
		ppq: 480,
		beatsPerBar: 4,
		swing: 0.5,
		...overrides
	};
}

function gen(overrides: Partial<BackingGenerationParams> = {}) {
	return generateBacking(HARMONY, BACKING_STYLES['bossa-nova'], params(overrides));
}

const pc = (midi: number) => ((midi % 12) + 12) % 12;
const offsetInBar = (absBeat: number) => absBeat % 4;

const CLAVE_THREE = [0, 1.5, 3];
const CLAVE_TWO = [1, 2.5];

describe('bossa drums', () => {
	it('is deterministic', () => {
		expect(gen()).toEqual(gen());
	});

	it('keeps one clave phase for the whole phrase, rim pattern exact per side', () => {
		const { drumEvents } = gen();
		const rimByBar = new Map<number, number[]>();
		for (const e of drumEvents) {
			if (e.drum !== 'crossstick') continue;
			const bar = Math.floor(e.absBeat / 4);
			rimByBar.set(bar, [...(rimByBar.get(bar) ?? []), offsetInBar(e.absBeat)].sort((a, b) => a - b));
		}
		expect(rimByBar.size).toBe(4);
		// Every bar is exactly one clave side, and sides strictly alternate.
		const sideOf = (offs: number[]): 'three' | 'two' | null => {
			const key = offs.join(',');
			if (key === CLAVE_THREE.join(',')) return 'three';
			if (key === CLAVE_TWO.join(',')) return 'two';
			return null;
		};
		const sides = [0, 1, 2, 3].map((b) => sideOf(rimByBar.get(b) ?? []));
		expect(sides).not.toContain(null);
		expect(sides[0]).not.toBe(sides[1]);
		expect(sides[0]).toBe(sides[2]);
		expect(sides[1]).toBe(sides[3]);
	});

	it('draws both clave phases across phrase ids', () => {
		const firstSides = new Set<number>();
		for (let seed = 0; seed < 12; seed++) {
			const { drumEvents } = gen({ phraseId: `bossa-probe-${seed}` });
			const barZeroRims = drumEvents
				.filter((e) => e.drum === 'crossstick' && e.absBeat < 4)
				.map((e) => e.absBeat);
			firstSides.add(barZeroRims.length); // 3-side = 3 hits, 2-side = 2 hits
		}
		expect(firstSides).toEqual(new Set([2, 3]));
	});

	it('rides steady eighth hats over the surdo kick pattern', () => {
		const { drumEvents } = gen();
		for (let bar = 0; bar < 4; bar++) {
			const hats = drumEvents
				.filter((e) => e.drum === 'hihat' && Math.floor(e.absBeat / 4) === bar)
				.map((e) => offsetInBar(e.absBeat))
				.sort((a, b) => a - b);
			expect(hats).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
			const kicks = drumEvents
				.filter((e) => e.drum === 'kick' && Math.floor(e.absBeat / 4) === bar)
				.map((e) => offsetInBar(e.absBeat))
				.sort((a, b) => a - b);
			expect(kicks).toEqual([0, 1.5, 2, 3.5]);
		}
		// The swing kit's voices stay out of the bossa.
		expect(drumEvents.some((e) => e.drum === 'ride' || e.drum === 'snare' || e.drum === 'crash')).toBe(
			false
		);
	});
});

describe('bossa bass (pattern engine)', () => {
	it('anchors every bar on the root and the quality-aware fifth', () => {
		const { bassEvents } = gen();
		for (let bar = 0; bar < 4; bar++) {
			const seg = HARMONY[bar];
			const rootPc = pitchClassToNumber(seg.chord.root);
			const fifthPc = (rootPc + chordToneIntervalsForBass(seg.chord.quality).fifth) % 12;
			const inBar = bassEvents.filter((e) => Math.floor(e.absBeat / 4) === bar);
			const downbeat = inBar.find((e) => offsetInBar(e.absBeat) === 0);
			expect(downbeat, `bar ${bar} has a downbeat`).toBeDefined();
			expect(pc(downbeat!.midi)).toBe(rootPc);
			const beat3 = inBar.find((e) => offsetInBar(e.absBeat) === 2);
			if (beat3) expect(pc(beat3.midi)).toBe(fifthPc);
			for (const e of inBar) {
				expect([0, 1.5, 2, 3.5]).toContain(offsetInBar(e.absBeat));
				expect(e.midi).toBeGreaterThanOrEqual(28);
				expect(e.midi).toBeLessThanOrEqual(55);
			}
		}
	});

	it('turns the and-of-4 pickup into an approach at chord changes', () => {
		// Across seeds, collect segment-final pickups and check each leads the
		// next chord (chromatic neighbour of its root, or its fifth).
		let checked = 0;
		for (let seed = 0; seed < 8; seed++) {
			const { bassEvents } = gen({ phraseId: `bossa-appr-${seed}` });
			for (let bar = 0; bar < 3; bar++) {
				const pickup = bassEvents.find(
					(e) => Math.floor(e.absBeat / 4) === bar && offsetInBar(e.absBeat) === 3.5
				);
				if (!pickup) continue;
				const nextRootPc = pitchClassToNumber(HARMONY[bar + 1].chord.root);
				const nextFifthPc =
					(nextRootPc + chordToneIntervalsForBass(HARMONY[bar + 1].chord.quality).fifth) % 12;
				const p = pc(pickup.midi);
				expect(
					[
						(nextRootPc + 1) % 12,
						(nextRootPc + 11) % 12,
						nextFifthPc
					].includes(p),
					`pickup pc ${p} approaches next root ${nextRootPc}`
				).toBe(true);
				checked++;
			}
		}
		expect(checked).toBeGreaterThan(8);
	});
});

describe('bossa comp', () => {
	it('tracks the clave side on the x.5 grid, anchor hit always present', () => {
		const { compEvents, drumEvents } = gen();
		for (let bar = 0; bar < 4; bar++) {
			const rims = drumEvents
				.filter((e) => e.drum === 'crossstick' && Math.floor(e.absBeat / 4) === bar)
				.map((e) => offsetInBar(e.absBeat));
			const side = rims.length === 3 ? 'three' : 'two';
			const allowed = side === 'three' ? [0, 1.5, 3] : [1, 2.5];
			const comps = compEvents
				.filter((e) => Math.floor(e.absBeat / 4) === bar)
				.map((e) => offsetInBar(e.absBeat));
			expect(comps.length).toBeGreaterThan(0);
			for (const o of comps) expect(allowed).toContain(o);
			expect(comps).toContain(allowed[0]); // the anchor never thins out
		}
	});
});

describe('style dispatch + plumbing', () => {
	it('falls back to the walking planner outside 4/4', () => {
		const waltz: HarmonicSegment[] = [
			{
				chord: { root: 'F', quality: 'maj7' },
				scaleId: 'major.ionian',
				startOffset: [0, 1],
				duration: [3, 2]
			}
		];
		const { bassEvents } = generateBacking(
			waltz,
			BACKING_STYLES['bossa-nova'],
			params({ beatsPerBar: 3 })
		);
		// The walking planner covers every beat; the bossa pattern never
		// emits integer offsets past the downbeat.
		expect(bassEvents.some((e) => e.absBeat % 3 === 1)).toBe(true);
	});

	it('exports the style ids in display order', () => {
		expect(BACKING_STYLE_IDS).toEqual(['swing', 'bossa-nova', 'ballad', 'straight']);
	});
});
