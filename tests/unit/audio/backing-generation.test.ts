import { describe, it, expect } from 'vitest';
import type { HarmonicSegment, PitchClass, ChordQuality } from '$lib/types/music';
import {
	buildBarInfos,
	chordToneIntervalsForBass,
	generateBacking,
	type BackingGenerationParams
} from '$lib/audio/backing-generation';
import { BACKING_STYLES, type GenerationContext } from '$lib/audio/backing-styles';
import { COMP_FIGURES } from '$lib/audio/backing-comp-figures';
import { SWING_TIMING } from '$lib/audio/backing-timing';
import { createRng } from '$lib/audio/generation-rng';
import { pitchClassToNumber } from '$lib/audio/voicings';

const PPQ = 480;

/** One-bar-per-chord 4/4 harmony builder. */
function bars(...chords: Array<[PitchClass, ChordQuality]>): HarmonicSegment[] {
	return chords.map(([root, quality], i) => ({
		chord: { root, quality },
		scaleId: 'major.ionian',
		startOffset: [i, 1] as [number, number],
		duration: [1, 1] as [number, number]
	}));
}

function params(overrides: Partial<BackingGenerationParams> = {}): BackingGenerationParams {
	return {
		phraseId: 'gen-probe',
		tempo: 120,
		ppq: PPQ,
		beatsPerBar: 4,
		swing: 0.67,
		...overrides
	};
}

const ticksOf = (e: { time: string }) => parseInt(e.time);
const pc = (midi: number) => ((midi % 12) + 12) % 12;

// ── Bar contexts ─────────────────────────────────────────────

describe('buildBarInfos', () => {
	it('falls back to flat bars without a sectionMap', () => {
		const infos = buildBarInfos(4);
		expect(infos).toHaveLength(4);
		for (let b = 0; b < 4; b++) {
			expect(infos[b].sectionIndex).toBeUndefined();
			expect(infos[b].chorusIndex).toBeUndefined();
			expect(infos[b].isSectionFinalBar).toBe(false);
			expect(infos[b].isFinalBar).toBe(b === 3);
		}
	});

	it('assigns sections and marks their final bars', () => {
		const infos = buildBarInfos(8, [
			{ sourceSection: 0, barOffset: 0 },
			{ sourceSection: 1, barOffset: 4 }
		]);
		expect(infos.map((i) => i.sectionIndex)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
		expect(infos.map((i) => i.isSectionFinalBar)).toEqual([
			false, false, false, true,
			false, false, false, true
		]);
		expect(infos.map((i) => i.chorusIndex)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
	});

	it('starts a new chorus when the sourceSection sequence restarts', () => {
		// body, ending 1, body again, ending 2 — the expanded-repeat shape.
		const infos = buildBarInfos(16, [
			{ sourceSection: 0, barOffset: 0 },
			{ sourceSection: 1, barOffset: 4 },
			{ sourceSection: 0, barOffset: 8 },
			{ sourceSection: 2, barOffset: 12 }
		]);
		expect(infos[0].chorusIndex).toBe(0);
		expect(infos[4].chorusIndex).toBe(0);
		expect(infos[8].chorusIndex).toBe(1);
		expect(infos[12].chorusIndex).toBe(1);
	});

	it('extends the last section over a harmony tail', () => {
		const infos = buildBarInfos(6, [{ sourceSection: 0, barOffset: 0 }]);
		expect(infos[5].sectionIndex).toBe(0);
		expect(infos[5].isSectionFinalBar).toBe(true);
		expect(infos[3].isSectionFinalBar).toBe(false);
	});
});

// ── Bass chord tones ─────────────────────────────────────────

describe('chordToneIntervalsForBass', () => {
	it('reads true tones for every tricky quality', () => {
		expect(chordToneIntervalsForBass('min7b5')).toEqual({ third: 3, fifth: 6, seventh: 10 });
		expect(chordToneIntervalsForBass('dim7')).toEqual({ third: 3, fifth: 6, seventh: 9 });
		expect(chordToneIntervalsForBass('aug7')).toEqual({ third: 4, fifth: 8, seventh: 10 });
		expect(chordToneIntervalsForBass('sus4')).toEqual({ third: 5, fifth: 7, seventh: 10 });
		expect(chordToneIntervalsForBass('sus2')).toEqual({ third: 2, fifth: 7, seventh: 10 });
		expect(chordToneIntervalsForBass('min7')).toEqual({ third: 3, fifth: 7, seventh: 10 });
		expect(chordToneIntervalsForBass('7')).toEqual({ third: 4, fifth: 7, seventh: 10 });
	});

	it('prefers the natural 5th when the definition also carries a colour tone', () => {
		expect(chordToneIntervalsForBass('7#11').fifth).toBe(7);
		expect(chordToneIntervalsForBass('7b13').fifth).toBe(7);
	});

	it('walks the 6th of 6th chords in the seventh slot', () => {
		expect(chordToneIntervalsForBass('maj6').seventh).toBe(9);
		expect(chordToneIntervalsForBass('min6').seventh).toBe(9);
	});

	it('reports no seventh for plain triads', () => {
		expect(chordToneIntervalsForBass('aug').seventh).toBeNull();
		expect(chordToneIntervalsForBass('dim').seventh).toBeNull();
	});
});

// ── Walking bass ─────────────────────────────────────────────

describe('generateBacking', () => {
	const FORM = bars(
		['D', 'min7'], ['G', '7'], ['C', 'maj7'], ['C', 'maj7'],
		['D', 'min7'], ['G', '7'], ['C', 'maj7'], ['C', 'maj7']
	);
	const TWO_CHORUSES = [
		{ sourceSection: 0, barOffset: 0 },
		{ sourceSection: 0, barOffset: 4 }
	];

	it('is fully deterministic', () => {
		const a = generateBacking(FORM, BACKING_STYLES.swing, params({ sectionMap: TWO_CHORUSES }));
		const b = generateBacking(FORM, BACKING_STYLES.swing, params({ sectionMap: TWO_CHORUSES }));
		expect(a).toEqual(b);
	});

	it('varies repeated bars across the timeline (chorus 2 differs from chorus 1)', () => {
		const { bassEvents, compEvents } = generateBacking(
			FORM,
			BACKING_STYLES.swing,
			params({ sectionMap: TWO_CHORUSES })
		);
		const bassLine = (from: number, to: number) =>
			bassEvents.filter((e) => e.absBeat >= from && e.absBeat < to).map((e) => e.midi);
		expect(bassLine(0, 16)).not.toEqual(bassLine(16, 32));

		const compShape = (from: number, to: number) =>
			compEvents
				.filter((e) => e.absBeat >= from && e.absBeat < to)
				.map((e) => `${e.absBeat - from}:${e.notes.join(',')}`);
		expect(compShape(0, 16)).not.toEqual(compShape(16, 32));
	});

	it('keeps comp voicings on legal tones for the sounding chord', () => {
		const harmony = bars(['D', 'min7'], ['D', 'min7'], ['D', 'min7'], ['D', 'min7']);
		const { compEvents } = generateBacking(harmony, BACKING_STYLES.swing, params());
		// Union of every voicing shape this engine can choose for Dm7:
		// shell/drop2 chord tones + rootless 9th (E) and 13th slot (B is
		// unused for min7 — the B-form tops with the 5th).
		const allowed = new Set([2, 5, 9, 0, 4]);
		expect(compEvents.length).toBeGreaterThan(0);
		for (const e of compEvents) {
			for (const note of e.notes) expect(allowed).toContain(pc(note));
		}
	});

	it('anticipates the coming chord on pushes across the bar line', () => {
		const alternating = bars(...Array.from({ length: 48 }, (_, i): [PitchClass, ChordQuality] =>
			i % 2 === 0 ? ['D', 'min7'] : ['G', '7']
		));
		const { compEvents } = generateBacking(alternating, BACKING_STYLES.swing, params());
		const allowedByRoot: Record<string, Set<number>> = {
			D: new Set([0, 2, 4, 5, 9]),
			G: new Set([2, 4, 5, 7, 9, 11])
		};
		const crossings = compEvents.filter((e) => e.absBeat % 4 === 3.5);
		expect(crossings.length).toBeGreaterThan(0);
		for (const e of crossings) {
			const nextBar = Math.floor(e.absBeat / 4) + 1;
			const nextRoot = nextBar < 48 ? (nextBar % 2 === 0 ? 'D' : 'G') : null;
			if (nextRoot === null) continue;
			for (const note of e.notes) {
				expect(allowedByRoot[nextRoot]).toContain(pc(note));
			}
		}
	});

	it('swings all off-beat eighths late, stays near the grid when swing is 0.5', () => {
		// Per-role deviation allowance: ensemble offset + triangular jitter
		// bound (SWING_TIMING, in ms), converted to ticks at the test tempo.
		const msTicks = (ms: number) => (ms / (60_000 / 120)) * PPQ;
		const allowance = (role: 'bass' | 'comp' | import('$lib/audio/backing-styles').DrumVoice) =>
			msTicks(Math.abs(SWING_TIMING[role].offsetMs) + SWING_TIMING[role].jitterMs) + 1;
		const roleOf = (e: { drum?: string }, fallback: 'bass' | 'comp') =>
			((e as { drum?: string }).drum ?? fallback) as 'bass' | 'comp';

		const swung = generateBacking(FORM, BACKING_STYLES.swing, params());
		const offBeats = [...swung.bassEvents, ...swung.compEvents, ...swung.drumEvents].filter(
			(e) => e.absBeat % 1 !== 0
		);
		expect(offBeats.length).toBeGreaterThan(0);
		for (const e of offBeats) {
			// Swing shift at 0.67 is ~82 ticks; even the widest role personality
			// cannot pull an off-beat back near the straight grid.
			expect(ticksOf(e) - e.absBeat * PPQ).toBeGreaterThanOrEqual(60);
		}

		const straightGen = generateBacking(FORM, BACKING_STYLES.swing, params({ swing: 0.5 }));
		for (const e of straightGen.bassEvents) {
			expect(Math.abs(ticksOf(e) - e.absBeat * PPQ)).toBeLessThanOrEqual(allowance('bass'));
		}
		for (const e of straightGen.compEvents) {
			expect(Math.abs(ticksOf(e) - e.absBeat * PPQ)).toBeLessThanOrEqual(allowance('comp'));
		}
		for (const e of straightGen.drumEvents) {
			expect(Math.abs(ticksOf(e) - e.absBeat * PPQ)).toBeLessThanOrEqual(allowance(roleOf(e, 'comp')));
		}
	});

	it('keeps ride quarters and 2-and-4 hats in every bar; skips breathe per mode', () => {
		const { drumEvents } = generateBacking(FORM, BACKING_STYLES.swing, params());
		let barsWithSkips = 0;
		for (let bar = 0; bar < 8; bar++) {
			const inBar = drumEvents.filter((e) => e.absBeat >= bar * 4 && e.absBeat < (bar + 1) * 4);
			const rides = inBar.filter((e) => e.drum === 'ride').map((e) => e.absBeat - bar * 4);
			// The time never stops: a ride quarter on every beat (beat 1 may be
			// replaced by a crash on section arrivals — none in this flat form).
			for (const b of [0, 1, 2, 3]) expect(rides).toContain(b);
			if (rides.some((b) => b % 1 !== 0)) barsWithSkips++;
			const hats = inBar.filter((e) => e.drum === 'hihat').map((e) => e.absBeat - bar * 4);
			expect(hats).toContain(1);
			expect(hats).toContain(3);
		}
		// Ride modes vary the skips (quarters-only bars breathe), but the
		// spang-a-lang remains the dominant sentence.
		expect(barsWithSkips).toBeGreaterThanOrEqual(4);
	});

	it('never triggers the same drum voice twice at one beat position', () => {
		// The feathered-kick quarters, the comp-onset accent kicks, and the
		// section-final setup figures can all land a kick on the same offset;
		// two sampler starts at the identical tick read as one doubled hit.
		// Sweep many section-final bars so the colliding branches actually
		// co-occur somewhere in the deterministic stream.
		const manySections = bars(...Array.from({ length: 64 }, (): [PitchClass, ChordQuality][] =>
			[['D', 'min7'], ['G', '7'], ['C', 'maj7'], ['C', 'maj7']]
		).flat());
		const sectionMap = Array.from({ length: 64 }, (_, i) => ({
			sourceSection: 0,
			barOffset: i * 4
		}));
		const { drumEvents } = generateBacking(
			manySections,
			BACKING_STYLES.swing,
			params({ sectionMap })
		);
		const seen = new Set<string>();
		for (const e of drumEvents) {
			const key = `${e.drum}:${e.absBeat}`;
			expect(seen.has(key), `duplicate ${key}`).toBe(false);
			seen.add(key);
		}
	});

	it('keeps any feathered kick quarters at whisper level', () => {
		const { drumEvents } = generateBacking(FORM, BACKING_STYLES.swing, params());
		// No sectionMap-driven setups here; integer-beat kicks are feathering.
		const kicks = drumEvents.filter((e) => e.drum === 'kick' && e.absBeat % 1 === 0);
		expect(kicks.length).toBeGreaterThan(0);
		for (const e of kicks) expect(e.velocity).toBeLessThan(0.2);
	});
});

// ── Style pattern units ──────────────────────────────────────

function ctxFor(overrides: Partial<GenerationContext> = {}): GenerationContext {
	return {
		barIndex: 1,
		beatsPerBar: 4,
		isSectionFirstBar: false,
		isSectionFinalBar: false,
		isFinalBar: false,
		intensity: 0.5,
		swing: 0.67,
		rng: createRng(42),
		...overrides
	};
}

describe('swing style patterns', () => {
	it('adds a setup figure on section-final bars without touching the timekeeping', () => {
		const plain = BACKING_STYLES.swing.drumPattern(ctxFor({ rng: createRng(7), fillRng: createRng(7) }));
		const finalBar = BACKING_STYLES.swing.drumPattern(
			ctxFor({
				rng: createRng(7),
				fillRng: createRng(7),
				isSectionFinalBar: true,
				sectionIndex: 0,
				chorusIndex: 0
			})
		);
		// The setup ADDS activity in the bar's last-beat region...
		const lateHits = (hits: typeof plain) => hits.filter((h) => h.beatOffset >= 2.5).length;
		expect(lateHits(finalBar)).toBeGreaterThan(lateHits(plain));
		// ...while the ostinato (ride quarters + hats), drawn from the same
		// timekeeping stream, is identical — fills live on their own stream.
		const timekeeping = (hits: typeof plain) =>
			hits.filter((h) => (h.drum === 'ride' || h.drum === 'hihat') && h.beatOffset % 1 === 0);
		expect(timekeeping(finalBar)).toEqual(timekeeping(plain));
	});

	it('never lets the comp anticipate past the final bar (end-to-end)', () => {
		for (let seed = 0; seed < 30; seed++) {
			const harmony = bars(['D', 'min7'], ['G', '7'], ['C', 'maj7']);
			const { compEvents } = generateBacking(harmony, BACKING_STYLES.swing, params({ phraseId: `final-probe#${seed}` }));
			const lastBarStart = 2 * 4;
			for (const e of compEvents) {
				if (e.absBeat >= lastBarStart) expect(e.absBeat - lastBarStart).toBeLessThan(3.5);
			}
			// ...and the final bar is never silent.
			expect(compEvents.some((e) => e.absBeat >= lastBarStart)).toBe(true);
		}
	});

	it('always states the harmony early in the very first bar (end-to-end)', () => {
		for (let seed = 0; seed < 30; seed++) {
			const harmony = bars(['D', 'min7'], ['G', '7'], ['C', 'maj7'], ['C', 'maj7']);
			const { compEvents } = generateBacking(harmony, BACKING_STYLES.swing, params({ phraseId: `early-probe#${seed}` }));
			expect(compEvents.some((e) => e.absBeat <= 1)).toBe(true);
		}
	});

	it('realizes every planned figure with sane velocity, length and articulation', () => {
		for (const figure of COMP_FIGURES) {
			for (let seed = 0; seed < 20; seed++) {
				const hits = BACKING_STYLES.swing.compPattern(
					ctxFor({
						rng: createRng(seed),
						plannedComp: { hits: figure.hits[0], tags: figure.tags, guideTones: false }
					})
				);
				for (const h of hits) {
					expect(h.beatOffset).toBeGreaterThanOrEqual(0);
					expect(h.beatOffset).toBeLessThan(4);
					expect(h.durationBeats).toBeGreaterThan(0);
					expect(h.velocity).toBeGreaterThanOrEqual(1);
					expect(h.velocity).toBeLessThanOrEqual(127);
					// Pushes must hold long enough to audibly tie across the barline.
					if (figure.tags.includes('push') && h.beatOffset >= 3.5) {
						expect(h.durationBeats).toBeGreaterThanOrEqual(1.1);
					}
				}
			}
		}
	});

	it('aligns kick accents with off-beat comp onsets often enough to hear', () => {
		let aligned = 0;
		for (let seed = 0; seed < 100; seed++) {
			const hits = BACKING_STYLES.swing.drumPattern(
				ctxFor({ rng: createRng(seed), compOnsets: [1.5] })
			);
			if (hits.some((h) => h.drum === 'kick' && h.beatOffset === 1.5)) aligned++;
		}
		expect(aligned).toBeGreaterThan(15);
		expect(aligned).toBeLessThan(60);
	});
});

describe('other styles under the context signature', () => {
	const styles = ['bossa-nova', 'ballad', 'straight'] as const;

	it.each(styles)('%s produces in-bar drum and comp hits', (name) => {
		const style = BACKING_STYLES[name];
		for (let seed = 0; seed < 20; seed++) {
			for (const hit of style.drumPattern(ctxFor({ rng: createRng(seed) }))) {
				expect(hit.beatOffset).toBeGreaterThanOrEqual(0);
				expect(hit.beatOffset).toBeLessThan(4);
				expect(hit.velocity).toBeGreaterThan(0);
				expect(hit.velocity).toBeLessThanOrEqual(1);
			}
			for (const hit of style.compPattern(ctxFor({ rng: createRng(seed) }))) {
				expect(hit.beatOffset).toBeGreaterThanOrEqual(0);
				expect(hit.beatOffset).toBeLessThan(4);
				expect(hit.velocity).toBeGreaterThanOrEqual(1);
				expect(hit.velocity).toBeLessThanOrEqual(127);
			}
		}
	});

	it('bossa keeps its on-beat clave shape (no swung eighths)', () => {
		const style = BACKING_STYLES['bossa-nova'];
		const comp = style.compPattern(ctxFor({ rng: createRng(1) }));
		expect(comp.map((h) => h.beatOffset)).toEqual([0, 2, 3]);
	});

	it('ballad stays sparse: one soft kick, ride quarters', () => {
		const style = BACKING_STYLES.ballad;
		const drums = style.drumPattern(ctxFor({ rng: createRng(1) }));
		expect(drums.filter((h) => h.drum === 'kick')).toHaveLength(1);
		expect(drums.filter((h) => h.drum === 'ride')).toHaveLength(4);
		expect(drums.filter((h) => h.drum === 'hihat')).toHaveLength(0);
	});
});

describe('generateBackingCached', () => {
	it('returns events deep-equal to the uncached path, as fresh objects', async () => {
		const { generateBackingCached } = await import('$lib/audio/backing-generation');
		const harmony = bars(['D', 'min7'], ['G', '7'], ['C', 'maj7'], ['C', 'maj7']);
		const p = params();
		const direct = generateBacking(harmony, BACKING_STYLES.swing, p);
		const first = generateBackingCached(harmony, BACKING_STYLES.swing, p);
		const second = generateBackingCached(harmony, BACKING_STYLES.swing, p);
		expect(first).toEqual(direct);
		expect(second).toEqual(direct);
		// A hit must hand out fresh objects — callers must not be able to
		// corrupt the cache (or each other) through a shared reference.
		expect(second).not.toBe(first);
		expect(second.drumEvents).not.toBe(first.drumEvents);
	});

	it('misses on any key ingredient changing', async () => {
		const { generateBackingCached } = await import('$lib/audio/backing-generation');
		const harmony = bars(['D', 'min7'], ['G', '7'], ['C', 'maj7'], ['C', 'maj7']);
		const base = generateBackingCached(harmony, BACKING_STYLES.swing, params());
		const otherTempo = generateBackingCached(harmony, BACKING_STYLES.swing, params({ tempo: 200 }));
		const otherStyle = generateBackingCached(harmony, BACKING_STYLES.straight, params());
		const otherHarmony = generateBackingCached(
			bars(['F', 'maj7'], ['F', 'maj7'], ['F', 'maj7'], ['F', 'maj7']),
			BACKING_STYLES.swing,
			params()
		);
		expect(otherTempo).not.toEqual(base);
		expect(otherStyle.drumEvents).not.toEqual(base.drumEvents);
		expect(otherHarmony.bassEvents).not.toEqual(base.bassEvents);
	});
});
