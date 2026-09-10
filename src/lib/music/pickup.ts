import type { Fraction, Note } from '$lib/types/music';
import type { Tune, TuneSection } from '$lib/types/tune';
import { compareFractions, fractionToFloat, gcd, subtractFractions } from './intervals';

/**
 * Pickup (anacrusis) bars for tunes — the ONE place that decides how long a
 * section's partial first bar prints.
 *
 * The timeline never has a short bar: a pickup occupies a full meter bar
 * with its melody right-aligned (leading silence), so playback, the backing
 * grid, the playhead and every `bars × barLength` consumer stay uniform.
 * Only notation and its hit geometry care about the PRINTED length, and they
 * all read it through {@link resolvePickupLength}:
 *
 *  1. the explicit `TuneSection.pickupLength` when it is consistent with the
 *     melody (no pitched note inside the silent prefix);
 *  2. otherwise, for the legacy shape every importer wrote before the field
 *     existed — the FIRST section, blank label, exactly one bar, with more
 *     sections after it (the section builder only ever splits a lone
 *     anacrusis off when a form follows; a single blank section is a lick's
 *     lead-sheet window, never a pickup) — the length inferred from the
 *     melody, so already-imported and community tunes render correctly with
 *     no re-import and no hydrate-time write (the same precedent as
 *     `pickupBars ?? detectPickupBars` for licks).
 *
 * Everything else (a labelled section whose first bar is a padded pickup,
 * as the curated Amazing Grace / Saints charts are entered) needs the field.
 */

const EPS = 1e-9;

function barLengthOf(timeSignature: [number, number]): Fraction {
	const g = gcd(timeSignature[0], timeSignature[1]);
	return [timeSignature[0] / g, timeSignature[1] / g];
}

function isPositiveFraction(f: unknown): f is Fraction {
	return (
		Array.isArray(f) &&
		f.length === 2 &&
		Number.isFinite(f[0]) &&
		Number.isFinite(f[1]) &&
		f[1] > 0 &&
		f[0] > 0
	);
}

/**
 * Infer the printed pickup length from bar 0's melody: the bar minus the
 * earliest PITCHED onset, floored to the beat unit (a note on the and-of-4
 * is still a one-beat pickup). Stored rests are ignored — an explicit
 * leading rest is how the editor writes the silent prefix back. Null when
 * bar 0 has no pitched note or the melody starts on the downbeat.
 */
export function pickupLengthFromMelody(
	notes: Note[],
	timeSignature: [number, number]
): Fraction | null {
	const barLength = barLengthOf(timeSignature);
	const bar = fractionToFloat(barLength);
	let earliest = Infinity;
	for (const n of notes) {
		if (n.pitch === null) continue;
		const off = fractionToFloat(n.offset);
		if (off >= bar - EPS) continue;
		if (off < earliest) earliest = off;
	}
	if (!Number.isFinite(earliest)) return null;
	// Beat unit = the meter's denominator note (1/den whole notes) — read
	// off the signature, since the reduced bar length loses it (4/4 → 1/1).
	const beatUnit = 1 / timeSignature[1];
	const flooredBeats = Math.floor(earliest / beatUnit + EPS);
	if (flooredBeats <= 0) return null;
	const prefix: Fraction = [flooredBeats, timeSignature[1]];
	const length = subtractFractions(barLength, prefix);
	return length[0] > 0 ? length : null;
}

function explicitIsValid(sec: TuneSection, barLength: Fraction): boolean {
	const L = sec.pickupLength;
	if (!isPositiveFraction(L)) return false;
	if (compareFractions(L, barLength) >= 0) return false;
	const prefix = fractionToFloat(barLength) - fractionToFloat(L);
	const bar = fractionToFloat(barLength);
	for (const n of sec.notes) {
		if (n.pitch === null) continue;
		const off = fractionToFloat(n.offset);
		if (off >= bar - EPS) continue;
		if (off < prefix - EPS) return false;
	}
	return true;
}

/**
 * True for the pre-field import shape: first section, blank label, one bar,
 * and a form after it.
 */
function isLegacyPickupShape(sheet: Pick<Tune, 'sections'>, secIdx: number): boolean {
	const sec = sheet.sections[secIdx];
	return (
		secIdx === 0 &&
		sheet.sections.length > 1 &&
		sec.bars === 1 &&
		sec.label.trim() === ''
	);
}

/**
 * The printed length of a section's first bar, or null when it is a full
 * bar. See the module comment for the two sources.
 */
export function resolvePickupLength(
	sheet: Pick<Tune, 'sections' | 'timeSignature'>,
	secIdx: number
): Fraction | null {
	const sec = sheet.sections[secIdx];
	if (!sec) return null;
	const barLength = barLengthOf(sheet.timeSignature);
	if (sec.pickupLength !== undefined) {
		return explicitIsValid(sec, barLength) ? sec.pickupLength : null;
	}
	if (!isLegacyPickupShape(sheet, secIdx)) return null;
	return pickupLengthFromMelody(sec.notes, sheet.timeSignature);
}

/** The silent lead-in before the printed pickup: one bar minus the length. */
export function pickupPrefix(pickupLength: Fraction, timeSignature: [number, number]): Fraction {
	return subtractFractions(barLengthOf(timeSignature), pickupLength);
}

/** Beat index (denominator-note beats, may be fractional) where printing starts. */
export function pickupFirstBeat(pickupLength: Fraction, timeSignature: [number, number]): number {
	return Math.round(fractionToFloat(pickupPrefix(pickupLength, timeSignature)) * timeSignature[1] * 1e6) / 1e6;
}

/** A blank-labelled one-bar section that IS the pickup (the import shape). */
export function isPickupOnlySection(
	sheet: Pick<Tune, 'sections' | 'timeSignature'>,
	secIdx: number
): boolean {
	const sec = sheet.sections[secIdx];
	return (
		sec !== undefined &&
		sec.bars === 1 &&
		sec.label.trim() === '' &&
		resolvePickupLength(sheet, secIdx) !== null
	);
}

/** Every eighth-note multiple strictly inside one bar — the editor's choices. */
export function pickupLengthOptions(timeSignature: [number, number]): Fraction[] {
	const bar = barLengthOf(timeSignature);
	const eighths = Math.round(fractionToFloat(bar) * 8);
	const out: Fraction[] = [];
	for (let n = 1; n < eighths; n++) {
		const g = gcd(n, 8);
		out.push([n / g, 8 / g]);
	}
	return out;
}

const BEAT_FRACTION_GLYPHS: Record<string, string> = {
	'1/2': '½',
	'1/4': '¼',
	'3/4': '¾',
	'1/3': '⅓',
	'2/3': '⅔',
	'1/8': '⅛',
	'3/8': '⅜',
	'5/8': '⅝',
	'7/8': '⅞',
	'1/6': '⅙',
	'5/6': '⅚'
};

/**
 * "½ beat", "1 beat", "1½ beats", "¼ beat" — a length named EXACTLY in the
 * meter's beats. The editor's options are eighth-note multiples, which are
 * half beats in 4/4 but quarter beats in 2/2, and an imported field can be
 * any fraction; nothing is rounded, and a remainder without a glyph is
 * spelled out ("1/16 beat") rather than dropped.
 */
export function pickupLengthLabel(length: Fraction, timeSignature: [number, number]): string {
	// Beats as an exact fraction: whole notes × the meter's denominator.
	const num = length[0] * timeSignature[1];
	const g = gcd(num, length[1]);
	const n = num / g;
	const d = length[1] / g;
	const whole = Math.floor(n / d);
	const rem = n - whole * d;
	const glyph = rem === 0 ? undefined : BEAT_FRACTION_GLYPHS[`${rem}/${d}`];
	const frac = rem === 0 ? '' : (glyph ?? `${rem}/${d}`);
	const number =
		whole === 0 ? frac : frac === '' ? `${whole}` : glyph ? `${whole}${glyph}` : `${whole} ${frac}`;
	return `${number} beat${n > d ? 's' : ''}`;
}
