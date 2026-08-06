/**
 * Swing drum vocabulary: composable per-bar passes that turn the fixed
 * spang-a-lang ostinato into a drummer.
 *
 * Built top-down the way the instrument is played: the ride pattern is the
 * foundation and VARIES per bar (quarters-only breathing bars, extra skip
 * strokes, broken patterns) without losing the time; the hi-hat foot keeps
 * 2 & 4; the feathered kick stays felt-not-heard; the snare speaks in
 * sparse ghosts and accents IN DIALOGUE with the comp and bass rather than
 * on a schedule; fills and setups mark the 4/8-bar form; the crash
 * punctuates section arrivals.
 *
 * Anti-clutter is structural: an occupancy ledger caps ADDED (non-
 * ostinato) voices at one per beat offset, and `generateDrums`' existing
 * loudest-wins dedupe remains the final guard. All randomness flows
 * through the caller's per-bar `drums` / `drum-fill` streams.
 */

import type { SeededRng } from './generation-rng';
import type { DrumHitSpec, GenerationContext } from './backing-styles';

export type RideMode = 'standard' | 'quarters-only' | 'skip-plus' | 'broken';

/**
 * Choose this bar's ride flavor. Weights are static across the form until
 * the intensity increment wires chorus arcs in.
 */
export function chooseRideMode(rng: SeededRng): RideMode {
	return rng.weighted<RideMode>([
		{ value: 'standard', weight: 5 },
		{ value: 'quarters-only', weight: 2 },
		{ value: 'skip-plus', weight: 1.5 },
		{ value: 'broken', weight: 1 }
	]);
}

/**
 * The ride line for one bar. Quarters on every beat (velocity favoring the
 * backbeats — that's where the time lives, with a light long-cycle shade
 * on every 4th bar's downbeat); skip eighths per the chosen mode:
 * standard = after 2 and 4; skip-plus adds one after 1 or 3; broken drops
 * one backbeat skip and speaks after 1 instead.
 */
export function rideBar(
	mode: RideMode,
	barIndex: number,
	beatsPerBar: number,
	rng: SeededRng
): DrumHitSpec[] {
	const hits: DrumHitSpec[] = [];
	for (let b = 0; b < beatsPerBar; b++) {
		const backbeat = b % 2 === 1;
		const shade = b === 0 && barIndex % 4 === 0 ? 0.05 : 0;
		hits.push({
			drum: 'ride',
			beatOffset: b,
			velocity: (backbeat ? 0.42 : 0.36) + rng.float() * 0.06 + shade
		});
	}
	if (mode === 'quarters-only') return hits;

	const skip = (b: number, velocity: number): void => {
		if (b + 0.5 < beatsPerBar) hits.push({ drum: 'ride', beatOffset: b + 0.5, velocity });
	};
	const skipVel = (): number => 0.26 + rng.float() * 0.1;

	if (mode === 'broken') {
		// Drop one backbeat skip, speak after 1 instead — same density,
		// different sentence.
		const dropAfter = rng.chance(0.5) ? 1 : 3;
		for (let b = 1; b < beatsPerBar; b += 2) {
			if (b !== dropAfter) skip(b, skipVel());
		}
		skip(0, skipVel());
		return hits;
	}

	for (let b = 1; b < beatsPerBar; b += 2) skip(b, skipVel());
	if (mode === 'skip-plus') {
		skip(rng.chance(0.5) ? 0 : 2, skipVel());
	}
	return hits;
}

/** Hi-hat foot on 2 & 4 — the one non-negotiable. */
export function hihatBar(beatsPerBar: number, rng: SeededRng): DrumHitSpec[] {
	const hits: DrumHitSpec[] = [];
	for (let b = 1; b < beatsPerBar; b += 2) {
		hits.push({ drum: 'hihat', beatOffset: b, velocity: 0.42 + rng.float() * 0.13 });
	}
	return hits;
}

/** Feathered kick: quarters felt, never heard. Some bars sit out entirely. */
export function featherBar(beatsPerBar: number, rng: SeededRng): DrumHitSpec[] {
	if (!rng.chance(0.7)) return [];
	const hits: DrumHitSpec[] = [];
	for (let b = 0; b < beatsPerBar; b++) {
		hits.push({ drum: 'kick', beatOffset: b, velocity: 0.07 + rng.float() * 0.06 });
	}
	return hits;
}

/**
 * Snare comping: sparse, conversational. A bar speaks with nothing, a
 * single ghost, a ghost pair, or an and-of-4 accent that only fires when
 * the NEXT bar starts a 4-bar group (it is a setup, not a habit). On top,
 * each off-beat comp onset may get an echo ghost one beat later — the
 * drummer answering the piano.
 */
export function snareBar(ctx: GenerationContext, rng: SeededRng): DrumHitSpec[] {
	const { beatsPerBar } = ctx;
	const hits: DrumHitSpec[] = [];
	const ghostVel = (): number => 0.15 + rng.float() * 0.07;

	const preGroupEnd = (ctx.barIndex + 1) % 4 === 0;
	type SnareChoice = 'none' | 'ghost' | 'pair' | 'accent4';
	const choice = rng.weighted<SnareChoice>([
		{ value: 'none', weight: 4.25 },
		{ value: 'ghost', weight: 3 },
		{ value: 'pair', weight: 1.2 },
		{ value: 'accent4', weight: preGroupEnd && beatsPerBar === 4 ? 1 : 0 }
	]);

	if (choice === 'ghost') {
		// Meter guard: in 2/4 the 2.5 slot falls outside the bar.
		const slots = [0.5, 1.5, 2.5].filter((o) => o < beatsPerBar);
		hits.push({ drum: 'snare', beatOffset: rng.pick(slots), velocity: ghostVel() });
	} else if (choice === 'pair') {
		// Both hits off-beat ("and of 1 + and of 3" / "and of 2 + and of 4");
		// the answer is dropped rather than leaked past a short bar's barline.
		const first = rng.pick([0.5, 1.5]);
		hits.push({ drum: 'snare', beatOffset: first, velocity: ghostVel() });
		if (first + 2 < beatsPerBar) {
			hits.push({ drum: 'snare', beatOffset: first + 2, velocity: ghostVel() + 0.03 });
		}
	} else if (choice === 'accent4') {
		hits.push({ drum: 'snare', beatOffset: 3.5, velocity: 0.4 });
	}

	// Dialogue: echo an off-beat comp push one beat later, as a ghost.
	for (const onset of ctx.compOnsets ?? []) {
		if (onset % 1 !== 0 && onset + 1 < beatsPerBar && rng.chance(0.25)) {
			hits.push({ drum: 'snare', beatOffset: onset + 1, velocity: ghostVel() });
		}
	}
	return hits;
}

/**
 * Bass/comp coupling: kick catches an off-beat comp push (the drummer
 * hearing the piano) and doubles a swung bass pickup (locking with the
 * bassist's lead-in).
 */
export function couplingBar(ctx: GenerationContext, rng: SeededRng): DrumHitSpec[] {
	const hits: DrumHitSpec[] = [];
	for (const onset of ctx.compOnsets ?? []) {
		if (onset % 1 !== 0 && rng.chance(0.35)) {
			hits.push({ drum: 'kick', beatOffset: onset, velocity: 0.26 + rng.float() * 0.08 });
		}
	}
	for (const onset of ctx.bassOnsets ?? []) {
		// Swung eighth pickups only (x.5): the bass's triplet ornaments and
		// their 1/3-beat offsets are left alone — doubling those would clutter,
		// and off-grid floats would collide unreliably in the occupancy ledger.
		if (onset % 1 === 0.5 && rng.chance(0.25)) {
			hits.push({ drum: 'kick', beatOffset: onset, velocity: 0.3 });
		}
	}
	return hits;
}

/**
 * Form punctuation from the dedicated `drum-fill` stream: light snare
 * fills at 4-bar boundaries, fuller setups into new sections (the two
 * PR-201 figures kept, plus two snare shapes incl. a swing-immune
 * triplet), and a crash on section arrivals that REPLACES the downbeat
 * ride (the caller removes it via the returned flag).
 */
export function fillBar(
	ctx: GenerationContext,
	fillRng: SeededRng
): { hits: DrumHitSpec[]; crashOnOne: boolean } {
	const { beatsPerBar } = ctx;
	const hits: DrumHitSpec[] = [];
	let crashOnOne = false;

	// Crash punctuates a section arrival — more often deeper into the form.
	if (ctx.isSectionFirstBar && ctx.barIndex > 0) {
		const p = (ctx.chorusIndex ?? 0) >= 1 ? 0.6 : 0.25;
		if (fillRng.chance(p)) {
			hits.push({ drum: 'crash', beatOffset: 0, velocity: 0.5 + fillRng.float() * 0.1 });
			crashOnOne = true;
		}
	}

	if (beatsPerBar < 3) return { hits, crashOnOne };
	const last = beatsPerBar - 1;

	if (ctx.isSectionFinalBar && !ctx.isFinalBar) {
		const setup = fillRng.int(0, 3);
		if (setup === 0) {
			// Snare triplet into the barline — offsets the swung grid never
			// touches (triplet fractions are swing-immune by construction).
			hits.push({ drum: 'snare', beatOffset: last, velocity: 0.3 });
			hits.push({ drum: 'snare', beatOffset: last + 1 / 3, velocity: 0.24 });
			hits.push({ drum: 'snare', beatOffset: last + 2 / 3, velocity: 0.4 });
		} else if (setup === 1) {
			hits.push({ drum: 'snare', beatOffset: last - 0.5, velocity: 0.28 });
			hits.push({ drum: 'kick', beatOffset: last, velocity: 0.32 });
			hits.push({ drum: 'snare', beatOffset: last + 0.5, velocity: 0.42 });
		} else if (setup === 2) {
			hits.push({ drum: 'hihat', beatOffset: last - 0.5, velocity: 0.35 });
			hits.push({ drum: 'hihat', beatOffset: last + 0.5, velocity: 0.55 });
			hits.push({ drum: 'kick', beatOffset: last, velocity: 0.35 });
		} else {
			hits.push({ drum: 'ride', beatOffset: last - 0.5, velocity: 0.5 });
			hits.push({ drum: 'kick', beatOffset: last + 0.5, velocity: 0.38 });
		}
	} else if (!ctx.isFinalBar && (ctx.barIndex + 1) % 4 === 0 && fillRng.chance(0.18)) {
		// Light 4-bar phrase marker.
		if (fillRng.chance(0.5)) {
			hits.push({ drum: 'snare', beatOffset: last + 0.5, velocity: 0.35 });
		} else {
			hits.push({ drum: 'snare', beatOffset: last, velocity: 0.3 });
			hits.push({ drum: 'kick', beatOffset: last + 0.5, velocity: 0.32 });
		}
	}

	return { hits, crashOnOne };
}

/**
 * Cap ADDED (non-ostinato) voices at one per beat offset — first addition
 * wins, so the caller's array order is the priority order (fills before
 * coupling before snare chatter: if the kick caught a comp push at an
 * offset, a ghost stays out of that slot). Ostinato hits (ride/hats/
 * feather quarters) don't count against the ledger — they're the fabric
 * the additions sit on.
 */
export function capAdditionsPerOffset(
	ostinato: DrumHitSpec[],
	additions: DrumHitSpec[]
): DrumHitSpec[] {
	const taken = new Set<number>();
	const kept: DrumHitSpec[] = [];
	for (const hit of additions) {
		if (taken.has(hit.beatOffset)) continue;
		taken.add(hit.beatOffset);
		kept.push(hit);
	}
	return [...ostinato, ...kept];
}
