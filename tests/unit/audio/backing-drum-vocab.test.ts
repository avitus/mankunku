import { describe, it, expect } from 'vitest';
import { generateBacking, buildBarInfos } from '$lib/audio/backing-generation';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { BACKING_LAB_PRESETS, labPhraseWithSeed } from '$lib/audio/backing-lab-presets';
import { capAdditionsPerOffset } from '$lib/audio/backing-drum-vocab';
import { createRng } from '$lib/audio/generation-rng';
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

	it('the time never stops: a ride quarter (or crash/bell on one) on every beat', () => {
		for (const seed of seeds) {
			const { drumEvents } = gen(seed);
			for (let bar = 0; bar < aaba.bars; bar++) {
				for (let b = 0; b < 4; b++) {
					const abs = bar * 4 + b;
					const covered = drumEvents.some(
						(e) =>
							e.absBeat === abs &&
							(e.drum === 'ride' ||
								(b === 0 && (e.drum === 'crash' || e.drum === 'ride-bell')))
					);
					expect(covered, `no timekeeping at beat ${abs} (seed ${seed})`).toBe(true);
				}
			}
		}
	});

	it('crashes land on section-first downbeats (ride replaced) or anticipate them', () => {
		let pushes = 0;
		for (const seed of seeds) {
			const { drumEvents } = gen(seed);
			for (const e of drumEvents) {
				if (e.drum !== 'crash') continue;
				const bar = Math.floor(e.absBeat / 4);
				// One right hand: no ride or hat stroke may share a crash's
				// instant, downbeat or anticipated (the cross-bar sweep).
				expect(
					drumEvents.some(
						(r) => (r.drum === 'ride' || r.drum === 'hihat') && r.absBeat === e.absBeat
					),
					`crash and ride/hat doubled at ${e.absBeat}`
				).toBe(false);
				if (e.absBeat % 4 === 0) {
					expect(infos[bar].isSectionFirstBar, `crash mid-section at bar ${bar}`).toBe(true);
				} else {
					// Anticipated push: the final and BEFORE a section arrival,
					// paired with the foot; the arrival keeps its ride and takes
					// no second crash.
					pushes++;
					expect(e.absBeat % 4, `crash off the form at ${e.absBeat}`).toBe(3.5);
					expect(infos[bar + 1]?.isSectionFirstBar, `push into mid-section ${bar + 1}`).toBe(
						true
					);
					expect(
						drumEvents.some((k) => k.drum === 'kick' && k.absBeat === e.absBeat),
						`push without its kick at ${e.absBeat}`
					).toBe(true);
					expect(
						drumEvents.some((r) => r.drum === 'ride' && r.absBeat === (bar + 1) * 4),
						`anticipated push lost the arrival ride at ${(bar + 1) * 4}`
					).toBe(true);
					expect(
						drumEvents.some((c) => c.drum === 'crash' && c.absBeat === (bar + 1) * 4),
						`double crash around the arrival at ${(bar + 1) * 4}`
					).toBe(false);
				}
			}
		}
		// The push actually occurs somewhere across the seed sweep.
		expect(pushes).toBeGreaterThan(0);
	});

	it('ride-bell accents land only on section-first downbeats and replace that ride', () => {
		let bells = 0;
		for (const seed of seeds) {
			const { drumEvents } = gen(seed);
			for (const e of drumEvents) {
				if (e.drum !== 'ride-bell') continue;
				bells++;
				const bar = Math.floor(e.absBeat / 4);
				expect(e.absBeat % 4).toBe(0);
				expect(infos[bar].isSectionFirstBar, `bell mid-section at bar ${bar}`).toBe(true);
				expect(
					drumEvents.some((r) => r.drum === 'ride' && r.absBeat === e.absBeat),
					`bell and ride doubled at ${e.absBeat}`
				).toBe(false);
			}
		}
		// The accent actually occurs somewhere across the seed sweep.
		expect(bells).toBeGreaterThan(0);
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

	it('the long fill lives only on chorus-final bars, rolling into the arrival', () => {
		// Signature: the roll's opening ghost — a snare on an and (x.5) at
		// exactly 0.24. Ghost chatter is drawn from [0.15, 0.25) and setup 0's
		// 0.24 stroke sits on a triplet offset, so the constant is unique to
		// the roll on the eighth grid.
		let rolls = 0;
		for (const seed of seeds) {
			const { drumEvents } = gen(seed);
			for (const e of drumEvents) {
				if (e.drum !== 'snare' || e.absBeat % 1 !== 0.5) continue;
				if (Math.abs(e.velocity - 0.24) > 1e-9) continue;
				rolls++;
				const bar = Math.floor(e.absBeat / 4);
				expect(infos[bar].isChorusFinalBar, `long fill off chorus-final at ${e.absBeat}`).toBe(
					true
				);
				// The build lands its foot on the final triplet partial.
				expect(
					drumEvents.some(
						(k) => k.drum === 'kick' && Math.abs(k.absBeat - (bar * 4 + 3 + 2 / 3)) < 1e-9
					),
					`roll without its landing foot in bar ${bar}`
				).toBe(true);
			}
		}
		expect(rolls).toBeGreaterThan(0);
	});

	it('the hand-to-foot triplet and the Philly Joe bomb both speak across seeds', () => {
		let handToFoot = 0;
		let bombs = 0;
		for (const seed of seeds) {
			const { drumEvents } = gen(seed);
			for (const e of drumEvents) {
				// 0.34 is shared by both new kicks and by nothing else: the
				// comp-catch band [0.26, 0.34) is upper-exclusive, coupling is
				// pinned at 0.30, setups use 0.32/0.35/0.36/0.38.
				if (e.drum !== 'kick' || Math.abs(e.velocity - 0.34) > 1e-9) continue;
				const frac = e.absBeat % 1;
				if (Math.abs(frac - 2 / 3) < 1e-9) handToFoot++;
				else if (frac === 0.5) bombs++;
			}
		}
		expect(handToFoot).toBeGreaterThan(0);
		expect(bombs).toBeGreaterThan(0);
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
		// Direct pattern calls: same `drums` stream, same intensity, only the
		// section context (and fill stream) differs. The ostinato — integer-
		// offset ride/hat draws and feather kicks — must be identical because
		// fills draw exclusively from the dedicated drum-fill stream. (A
		// mapped-vs-flat comparison via generateBacking cannot pin this:
		// intensity legitimately differs between those runs and may flip
		// ride-mode or feather outcomes.)
		const base = {
			barIndex: 3,
			beatsPerBar: 4,
			isSectionFirstBar: false,
			isSectionFinalBar: false,
			isFinalBar: false,
			intensity: 0.55,
			swing: 0.733,
			rng: createRng(11),
			fillRng: createRng(12)
		};
		const plain = BACKING_STYLES.swing.drumPattern(base);
		const sectionFinal = BACKING_STYLES.swing.drumPattern({
			...base,
			rng: createRng(11),
			fillRng: createRng(99),
			isSectionFinalBar: true
		});
		// Integer-offset ride/hat plus feather kicks, with velocities: setup
		// figures only add off-grid hits and kicks >= 0.32, so any difference
		// here is a genuine drums-stream reshuffle.
		const timekeeping = (hits: typeof plain) =>
			hits
				.filter(
					(h) =>
						((h.drum === 'ride' || h.drum === 'hihat') && h.beatOffset % 1 === 0) ||
						(h.drum === 'kick' && h.velocity < 0.2)
				)
				.map((h) => `${h.drum}@${h.beatOffset}:${h.velocity.toFixed(6)}`)
				.sort();
		expect(timekeeping(sectionFinal)).toEqual(timekeeping(plain));
		expect(timekeeping(plain).length).toBeGreaterThanOrEqual(6); // 4 ride quarters + 2 hats
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
