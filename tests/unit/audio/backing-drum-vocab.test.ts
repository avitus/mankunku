import { describe, it, expect } from 'vitest';
import { generateBacking, buildBarInfos } from '$lib/audio/backing-generation';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { BACKING_LAB_PRESETS, labPhraseWithSeed } from '$lib/audio/backing-lab-presets';
import { capAdditionsPerOffset } from '$lib/audio/backing-drum-vocab';
import type { BackingGenerationParams } from '$lib/audio/backing-generation';

const aaba = BACKING_LAB_PRESETS.find((p) => p.id === 'lab-aaba-c')!;
const infos = buildBarInfos(aaba.bars, aaba.phrase.sectionMap);

function gen(seed: number, tempo = 160) {
	const phrase = labPhraseWithSeed(aaba, seed);
	const params: BackingGenerationParams = {
		phraseId: phrase.id,
		tempo,
		ppq: 192,
		beatsPerBar: 4,
		swing: 0.733,
		sectionMap: phrase.sectionMap
	};
	return generateBacking(phrase.harmony, BACKING_STYLES.swing, params);
}

const seeds = [0, 1, 2, 3, 4];

describe('drum vocabulary properties (3-chorus AABA, many seeds)', () => {
	it('hats sit on 2 and 4, feather stays under the felt-not-heard ceiling', () => {
		for (const seed of seeds) {
			const { drumEvents } = gen(seed);
			for (const e of drumEvents) {
				if (e.drum === 'hihat') {
					// Timekeeping hats live on 2 & 4; the one exception is the
					// PR-201 hat-hat-kick setup figure on section-final bars.
					const bar = Math.floor(e.absBeat / 4);
					if (!infos[bar].isSectionFinalBar) {
						expect(e.absBeat % 4 === 1 || e.absBeat % 4 === 3, `hat at ${e.absBeat}`).toBe(true);
					}
				}
				if (e.drum === 'kick' && e.absBeat % 1 === 0 && e.velocity < 0.2) {
					expect(e.velocity).toBeLessThanOrEqual(0.13);
				}
			}
		}
	});

	it('the time never stops: a ride quarter (or crash on one) on every beat', () => {
		for (const seed of seeds) {
			const { drumEvents } = gen(seed);
			for (let bar = 0; bar < aaba.bars; bar++) {
				for (let b = 0; b < 4; b++) {
					const abs = bar * 4 + b;
					const covered = drumEvents.some(
						(e) => e.absBeat === abs && (e.drum === 'ride' || (b === 0 && e.drum === 'crash'))
					);
					expect(covered, `no timekeeping at beat ${abs} (seed ${seed})`).toBe(true);
				}
			}
		}
	});

	it('crashes land only on section-first downbeats and replace that ride', () => {
		for (const seed of seeds) {
			const { drumEvents } = gen(seed);
			for (const e of drumEvents) {
				if (e.drum !== 'crash') continue;
				const bar = Math.floor(e.absBeat / 4);
				expect(e.absBeat % 4).toBe(0);
				expect(infos[bar].isSectionFirstBar, `crash mid-section at bar ${bar}`).toBe(true);
				expect(
					drumEvents.some((r) => r.drum === 'ride' && r.absBeat === e.absBeat),
					`crash and ride doubled at ${e.absBeat}`
				).toBe(false);
			}
		}
	});

	it('snare activity is sparse dialogue, never a backbeat habit', () => {
		for (const seed of seeds) {
			const { drumEvents } = gen(seed);
			const snares = drumEvents.filter((e) => e.drum === 'snare');
			// Sparse: comfortably under a backbeat's 2 hits/bar...
			expect(snares.length / aaba.bars).toBeLessThan(1.4);
			// ...but present — the drummer does talk.
			expect(snares.length).toBeGreaterThan(4);
			// Ghosts dominate accents.
			const ghosts = snares.filter((e) => e.velocity < 0.25).length;
			expect(ghosts / snares.length).toBeGreaterThan(0.5);
			// No habit: no single within-bar offset carries a plurality.
			const byOffset = new Map<number, number>();
			for (const e of snares) {
				const o = e.absBeat % 4;
				byOffset.set(o, (byOffset.get(o) ?? 0) + 1);
			}
			for (const [o, count] of byOffset) {
				expect(count / snares.length, `snare habit at offset ${o}`).toBeLessThan(0.4);
			}
		}
	});

	it('fills and setups mark the form only', () => {
		for (const seed of seeds) {
			const { drumEvents } = gen(seed);
			for (const e of drumEvents) {
				// Triplet offsets only appear in section-final setups.
				if (Math.abs((e.absBeat % 1) - 1 / 3) < 1e-9 || Math.abs((e.absBeat % 1) - 2 / 3) < 1e-9) {
					const bar = Math.floor(e.absBeat / 4);
					expect(infos[bar].isSectionFinalBar, `triplet fill mid-phrase at ${e.absBeat}`).toBe(true);
				}
				// Snare accents (non-ghost) only in the form-marking last-beat
				// region or the and-of-4 group setup.
				if (e.drum === 'snare' && e.velocity >= 0.3) {
					const bar = Math.floor(e.absBeat / 4);
					const inBar = e.absBeat - bar * 4;
					const boundary = infos[bar].isSectionFinalBar || (bar + 1) % 4 === 0;
					expect(boundary && inBar >= 2.5, `snare accent off-form at ${e.absBeat}`).toBe(true);
				}
			}
		}
	});

	it('every section-final bar carries a setup figure', () => {
		for (const seed of seeds) {
			const { drumEvents } = gen(seed);
			for (let bar = 0; bar < aaba.bars; bar++) {
				if (!infos[bar].isSectionFinalBar || infos[bar].isFinalBar) continue;
				const late = drumEvents.filter(
					(e) => e.absBeat > bar * 4 + 2 && e.absBeat < (bar + 1) * 4 && e.velocity >= 0.24
				);
				expect(late.length, `bare section-final bar ${bar} (seed ${seed})`).toBeGreaterThan(0);
			}
		}
	});

	it('bass-pickup kick coupling actually occurs across seeds', () => {
		let coupled = 0;
		for (const seed of seeds) {
			const { drumEvents, bassEvents } = gen(seed);
			const pickupBeats = new Set(
				bassEvents.filter((e) => e.absBeat % 1 !== 0).map((e) => e.absBeat)
			);
			// The pickup-double's fixed 0.3 velocity is the marker (comp-catch
			// kicks draw from 0.26–0.34 and could coincide with a pickup beat,
			// so a wide band would let them masquerade as bass coupling). If a
			// future change jitters this velocity, the test fails loudly —
			// update the marker with it.
			coupled += drumEvents.filter(
				(e) =>
					e.drum === 'kick' &&
					Math.abs(e.velocity - 0.3) < 1e-9 &&
					pickupBeats.has(e.absBeat)
			).length;
		}
		expect(coupled).toBeGreaterThan(0);
	});

	it('is deterministic, and fills never reshuffle the timekeeping stream', () => {
		expect(gen(0)).toEqual(gen(0));
		// Same phrase with a sectionMap vs without: section-dependent fills
		// change, but ride/hat draws on ordinary mid-section bars survive
		// because fills live on the dedicated drum-fill stream.
		const withMap = gen(1).drumEvents;
		const params: BackingGenerationParams = {
			phraseId: labPhraseWithSeed(aaba, 1).id,
			tempo: 160,
			ppq: 192,
			beatsPerBar: 4,
			swing: 0.733
		};
		const flat = generateBacking(aaba.phrase.harmony, BACKING_STYLES.swing, params).drumEvents;
		const ordinaryBar = 1; // mid-section in both
		const key = (e: { drum: string; absBeat: number }) => `${e.drum}@${e.absBeat}`;
		// Ride, hats, and feather kicks only: coupling kicks react to comp
		// onsets, and comp PLANNING is section-aware, so they are legitimately
		// not invariant between the mapped and flat runs.
		const timekeeping = (events: typeof withMap) =>
			events
				.filter(
					(e) =>
						Math.floor(e.absBeat / 4) === ordinaryBar &&
						(e.drum === 'ride' || e.drum === 'hihat' || (e.drum === 'kick' && e.velocity < 0.2))
				)
				.map(key)
				.sort();
		expect(timekeeping(withMap)).toEqual(timekeeping(flat));
	});
});

describe('capAdditionsPerOffset', () => {
	it('keeps the first addition per offset and all ostinato hits', () => {
		const ostinato = [
			{ drum: 'ride' as const, beatOffset: 0, velocity: 0.4 },
			{ drum: 'ride' as const, beatOffset: 1.5, velocity: 0.3 }
		];
		const additions = [
			{ drum: 'kick' as const, beatOffset: 1.5, velocity: 0.3 },
			{ drum: 'snare' as const, beatOffset: 1.5, velocity: 0.2 },
			{ drum: 'snare' as const, beatOffset: 2.5, velocity: 0.2 }
		];
		const out = capAdditionsPerOffset(ostinato, additions);
		expect(out).toHaveLength(4);
		expect(out.filter((h) => h.beatOffset === 1.5)).toHaveLength(2); // ride + kick, snare dropped
	});
});
