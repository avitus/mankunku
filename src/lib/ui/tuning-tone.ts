import { IN_TUNE_CENTS } from '$lib/scoring/tuning-summary';

const TUNING_TIERS = [
	{ name: 'Gold', maxCents: IN_TUNE_CENTS, color: 'var(--accuracy-gold)', cap: 'var(--metal-gold)' },
	{ name: 'Silver', maxCents: 10, color: 'var(--accuracy-silver)', cap: 'var(--metal-silver)' },
	{ name: 'Bronze', maxCents: 19, color: 'var(--accuracy-bronze)', cap: 'var(--metal-bronze)' },
	{ name: 'Blue-green', maxCents: Infinity, color: 'var(--accuracy-teal)', cap: 'var(--accuracy-teal)' }
] as const;

/** Grade the same whole-cent distance the fader prints, in either direction. */
export function tuningTier(cents: number): (typeof TUNING_TIERS)[number] {
	const distance = Math.round(Math.abs(cents));
	return TUNING_TIERS.find(tier => distance <= tier.maxCents) ?? TUNING_TIERS[3];
}

/** Whole cents with a sign: "+22", "−12" (a real minus), "±0". */
export function signedCents(cents: number): string {
	const r = Math.sign(cents) * Math.round(Math.abs(cents));
	if (r === 0) return '±0';
	return r > 0 ? `+${r}` : `−${-r}`;
}
