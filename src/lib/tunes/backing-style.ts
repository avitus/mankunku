import type { BackingStyle } from '$lib/types/instruments';
import type { Tune } from '$lib/types/tune';

export const TUNE_STYLE_DESCRIPTIONS: Record<BackingStyle, string> = {
	swing: 'Walking bass, light comping and a swinging ride.',
	'bossa-nova': 'A relaxed Latin pulse with straight eighths.',
	ballad: 'An open, unhurried accompaniment with a gentle swing.',
	straight: 'An even eighth-note pulse with a steady rhythm section.'
};

/** Validate persisted and community data before it reaches the audio engine. */
export function isBackingStyle(value: unknown): value is BackingStyle {
	return value === 'swing' || value === 'bossa-nova' || value === 'ballad' || value === 'straight';
}

/** Keep only valid personal choices when settings are read from storage or cloud. */
export function cleanTuneBackingStyles(value: unknown): Record<string, BackingStyle> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return Object.fromEntries(Object.entries(value).filter(([, style]) => isBackingStyle(style)));
}

/** Stable tune choice, independent of the last global practice style. */
export function tuneBackingStyle(
	tune: Pick<Tune, 'style' | 'backingStyle'> & { id?: string },
	personal: Record<string, BackingStyle> = {}
): BackingStyle {
	const override = tune.id && Object.hasOwn(personal, tune.id) ? personal[tune.id] : undefined;
	if (isBackingStyle(override)) return override;
	if (isBackingStyle(tune.backingStyle)) return tune.backingStyle;
	const marking = tune.style?.toLowerCase() ?? '';
	if (/\bbossa\b/.test(marking)) return 'bossa-nova';
	if (/\bballad\b/.test(marking)) return 'ballad';
	if (/\b(straight|rock|funk|latin)\b/.test(marking)) return 'straight';
	return 'swing';
}
