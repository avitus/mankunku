import { load, save } from '$lib/persistence/storage';
import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
import type { BackingStyle } from '$lib/types/instruments';
import type { TunePracticeMode, TunePracticeStrictness } from '$lib/state/tune-practice-plan';
import { isBackingStyle } from './backing-style';

export interface TunePracticePreferences {
	mode: TunePracticeMode;
	strictness: TunePracticeStrictness;
	playHead: boolean;
}

/** Validate stored choices before they reach the session planner. */
export function savedTunePracticePreferences(): TunePracticePreferences {
	const value = load<Partial<TunePracticePreferences>>('tune-practice-options');
	return {
		mode: value?.mode === 'points' || value?.mode === 'freestyle' ? value.mode : 'suggest',
		strictness: value?.strictness === 'standard' || value?.strictness === 'solo' ? value.strictness : 'guided',
		playHead: typeof value?.playHead === 'boolean' ? value.playHead : true
	};
}

/** Persist the setup choices only, excluding transient session state. */
export function saveTunePracticePreferences(value: TunePracticePreferences): void {
	save('tune-practice-options', { mode: value.mode, strictness: value.strictness, playHead: value.playHead });
}

/** Concert pitch stays consistent when the instrument changes, on either page. */
export function savedTuneKey(tuneId: string, fallback: PitchClass): PitchClass {
	const value = load<unknown>(`tune-key:${tuneId}`);
	return PITCH_CLASSES.includes(value as PitchClass) ? value as PitchClass : fallback;
}

/** Store a per-tune concert key in the active user’s local namespace. */
export function saveTuneKey(tuneId: string, key: PitchClass): void {
	save(`tune-key:${tuneId}`, key);
}

/** Use this tune’s saved practice feel, rejecting invalid stored style IDs. */
export function savedTunePracticeStyle(tuneId: string, fallback: BackingStyle): BackingStyle {
	const value = load<unknown>(`tune-practice-style:${tuneId}`);
	return isBackingStyle(value) ? value : fallback;
}

/** Store a practice-only feel for this tune and active user. */
export function saveTunePracticeStyle(tuneId: string, style: BackingStyle): void {
	save(`tune-practice-style:${tuneId}`, style);
}

type TuneDisplayPreference = 'harmony-colors' | 'focus' | 'practice-focus' | 'practice-options-open' | 'options-open';
/** Restore a display choice while preserving an explicitly saved false. */
export function savedTuneDisplay(preference: TuneDisplayPreference, fallback: boolean): boolean {
	const value = load<unknown>(`tune-display:${preference}`);
	return typeof value === 'boolean' ? value : fallback;
}
/** Remember a chart display choice and return it for immediate UI updates. */
export function saveTuneDisplay(preference: TuneDisplayPreference, enabled: boolean): boolean {
	save(`tune-display:${preference}`, enabled);
	return enabled;
}
