/**
 * Exact per-bar rhythm validation for the parse route's system mode — the
 * Audiveris `Voice.checkDuration` loop: with rests reported alongside notes,
 * a bar's events must tile the meter exactly, in rational arithmetic (no
 * float drift on triplets). Violations become precise per-bar feedback for
 * the model's retry, and bars that survive both attempts carry them as
 * import warnings.
 */
import type { Fraction } from '$lib/types/music';

/** Rational snap over the duration ladder (triplets included); shared with
 * the route's per-bar rhythm validation. */
export function toFraction(value: number): Fraction {
	for (const den of [1, 2, 3, 4, 6, 8, 12, 16, 24]) {
		const num = Math.round(value * den);
		if (Math.abs(num / den - value) < 1e-9) return [num, den];
	}
	return [Math.round(value * 24), 24];
}

/** One system-mode melody entry: [beat, durationBeats, pitch, tied?, articulation?]. */
export type BarMelody = Array<[number, number, string, boolean?, 'staccato'?]>;

/** Rests travel in the melody list with this pitch. */
export function isRestPitch(pitch: string): boolean {
	return pitch.trim().toLowerCase() === 'rest';
}

/**
 * All ladder denominators divide 48, so beats map to exact integer units;
 * comparisons below are integer comparisons.
 */
const UNITS = 48;
function toUnits(value: number): number {
	const [num, den] = toFraction(value);
	return Math.round((num * UNITS) / den);
}
const fromUnits = (u: number): number => Math.round((u / UNITS) * 1000) / 1000;

/**
 * Check that a bar's notes + rests tile `beats` exactly. Returns issue
 * strings naming the 1-based bar and the precise delta — empty when clean.
 * `allowLeadingGap` is for pickup bars, whose leading silence is not
 * printed.
 */
export function barTilingIssues(
	melody: BarMelody,
	barIndex: number,
	beats: number,
	opts: { allowLeadingGap?: boolean } = {}
): string[] {
	const issues: string[] = [];
	const label = `bar ${barIndex + 1}`;
	const barUnits = beats * UNITS;

	if (melody.length === 0) {
		if (!opts.allowLeadingGap) {
			issues.push(`${label}: empty — report the printed rest(s) filling the bar`);
		}
		return issues;
	}

	const events = melody
		.map(([beat, dur]) => ({ start: toUnits(beat), end: toUnits(beat) + toUnits(dur) }))
		.sort((a, b) => a.start - b.start);

	if (events[0].start > 0 && !opts.allowLeadingGap) {
		issues.push(
			`${label}: gap of ${fromUnits(events[0].start)} beat(s) at beat 0 — include the printed rest`
		);
	}
	for (let i = 1; i < events.length; i++) {
		const prev = events[i - 1];
		const cur = events[i];
		if (cur.start < prev.end) {
			issues.push(`${label}: overlapping events at beat ${fromUnits(cur.start)}`);
		} else if (cur.start > prev.end) {
			issues.push(
				`${label}: gap of ${fromUnits(cur.start - prev.end)} beat(s) at beat ${fromUnits(prev.end)} — include the printed rest`
			);
		}
	}
	const end = Math.max(...events.map((e) => e.end));
	if (end !== barUnits) {
		// No "/4" clause: only the numerator is known here, and the caller's
		// meter can be 6/8 etc. — naming a denominator would mislead the model.
		issues.push(
			`${label}: sums to ${fromUnits(end)} beats — the bar must fill exactly ${beats} beats`
		);
	}
	return issues;
}

/** A fully tiled pickup starts at its first printed note or rest, after the unprinted prefix. */
export function printedPickupBeats(melody: BarMelody, beats: number): number | undefined {
	if (!melody.length || barTilingIssues(melody, 0, beats, { allowLeadingGap: true }).length) {
		return undefined;
	}
	const firstBeat = Math.min(...melody.map(([beat]) => toUnits(beat)));
	return firstBeat > 0 ? beats - firstBeat / UNITS : undefined;
}
