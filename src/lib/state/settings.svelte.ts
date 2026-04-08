import type { InstrumentConfig, BackingInstrument } from '$lib/types/instruments';
import type { Tonality } from '$lib/tonality/tonality';
import { INSTRUMENTS } from '$lib/types/instruments';
import { save, load } from '$lib/persistence/storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';
import { syncSettingsToCloud, loadSettingsFromCloud as fetchSettingsFromCloud } from '$lib/persistence/sync';

const STORAGE_KEY = 'settings';

function loadSettings() {
	const saved = load<typeof defaultSettings>(STORAGE_KEY);
	const result = saved ? { ...defaultSettings, ...saved } : { ...defaultSettings };
	// Clamp swing to valid range (0.5 straight → 0.8 heavy swing)
	result.swing = Math.max(0.5, Math.min(0.8, result.swing));
	return result;
}

const defaultSettings = {
	instrumentId: 'tenor-sax',
	defaultTempo: 100,
	masterVolume: 0.8,
	metronomeEnabled: true,
	metronomeVolume: 0.7,
	backingTrackEnabled: true,
	backingInstrument: 'piano' as BackingInstrument,
	backingTrackVolume: 0.6,
	swing: 0.5,
	theme: 'dark' as 'dark' | 'light',
	onboardingComplete: false,
	/** User override for daily tonality. null = use auto-selected daily tonality. */
	tonalityOverride: null as Tonality | null,
	/** User-configured highest concert pitch MIDI. null = instrument default. */
	highestNote: null as number | null,
	/** When true, use bleed-filtered notes as the primary score (A/B testing toggle). */
	bleedFilterEnabled: false
};

export const settings = $state(loadSettings());

export function saveSettings(supabase?: SupabaseClient<Database>): void {
	save(STORAGE_KEY, settings);

	// Fire-and-forget cloud sync for authenticated users
	if (supabase) {
		syncSettingsToCloud(supabase, settings).catch((err) => {
			console.warn('Failed to sync settings to cloud:', err);
		});
	}
}

/**
 * Load settings from cloud for authenticated users.
 * Merges cloud settings with local, preferring cloud data when session exists.
 */
export async function loadSettingsFromCloud(supabase: SupabaseClient<Database>): Promise<void> {
	try {
		const cloudSettings = await fetchSettingsFromCloud(supabase);
		if (!cloudSettings) return; // No cloud data or not authenticated

		// Merge cloud settings with defaults, preferring cloud values
		const merged = { ...defaultSettings, ...cloudSettings };
		// Clamp swing to valid range (same as loadSettings)
		merged.swing = Math.max(0.5, Math.min(0.8, merged.swing as number));

		// Update the reactive state in place (preserves Svelte 5 $state reactivity)
		Object.assign(settings, merged);

		// Persist merged state locally for offline cache
		save(STORAGE_KEY, settings);

		// Re-apply theme in case it changed from cloud data
		applyTheme();
	} catch (err) {
		console.warn('Failed to load settings from cloud:', err);
	}
}

export function getInstrument(): InstrumentConfig {
	return INSTRUMENTS[settings.instrumentId] ?? INSTRUMENTS['tenor-sax'];
}

/**
 * Return the effective highest concert MIDI note.
 * If the user hasn't set one, default to instrument's concertRangeHigh - 1
 * (e.g. tenor sax: 76 - 1 = 75, concert Eb5 = written F6).
 */
export function getEffectiveHighestNote(): number {
	const inst = getInstrument();
	return settings.highestNote ?? (inst.concertRangeHigh - 1);
}

/**
 * Apply the current theme to the document.
 * Called from the layout component.
 */
export function applyTheme(): void {
	if (typeof document === 'undefined') return;
	document.documentElement.classList.toggle('light', settings.theme === 'light');
}
