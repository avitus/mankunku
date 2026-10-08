import { ALERT_CENTS } from '$lib/scoring/tuning';
import { IN_TUNE_CENTS } from '$lib/scoring/tuning-summary';

/**
 * Colour for a tuning offset: the text colour inside the in-tune zone, then
 * a step to half strength toward the sharp (brass) or flat (blue) pole the
 * moment a note leaves it, reaching full colour where the sharp/flat cue
 * speaks. A fade from zero made a 6¢ note indistinguishable from an in-tune
 * one.
 */
export function tuningTone(cents: number): string {
	const size = Math.abs(cents);
	if (size <= IN_TUNE_CENTS) return 'var(--color-text)';
	const t = Math.min(1, (size - IN_TUNE_CENTS) / (ALERT_CENTS - IN_TUNE_CENTS));
	const pole = cents > 0 ? 'var(--color-tune-sharp)' : 'var(--color-tune-flat)';
	return `color-mix(in oklab, ${pole} ${Math.round(45 + 55 * t)}%, var(--color-text))`;
}

/** Whole cents with a sign: "+22", "−12" (a real minus), "±0". */
export function signedCents(cents: number): string {
	const r = Math.round(cents);
	if (r === 0) return '±0';
	return r > 0 ? `+${r}` : `−${-r}`;
}
