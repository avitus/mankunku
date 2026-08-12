import type { InstrumentConfig, BackingInstrument, BackingStyle } from '$lib/types/instruments';
import type { Tonality } from '$lib/tonality/tonality';
import { INSTRUMENTS } from '$lib/types/instruments';
import { save, load } from '$lib/persistence/storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';
import { syncSettingsToCloud, loadSettingsFromCloud as fetchSettingsFromCloud } from '$lib/persistence/sync';
import { getScopeGeneration } from '$lib/persistence/user-scope';
import { enqueue } from '$lib/persistence/outbox';
import { BACKING_STYLE_IDS } from '$lib/audio/backing-styles';
import { STRAIGHT_SWING, MAX_SWING } from '$lib/music/swing';

const STORAGE_KEY = 'settings';
const VALID_BACKING_STYLES = new Set<string>(BACKING_STYLE_IDS);

function loadSettings() {
	const saved = load<typeof defaultSettings>(STORAGE_KEY);
	const result = saved ? { ...defaultSettings, ...saved } : { ...defaultSettings };
	// Clamp swing to valid range (0.5 straight → 0.8 heavy swing)
	result.swing = Math.max(STRAIGHT_SWING, Math.min(MAX_SWING, result.swing));
	if (!VALID_BACKING_STYLES.has(result.backingStyle)) {
		result.backingStyle = 'swing';
	}
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
	backingStyle: 'swing' as BackingStyle,
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

/**
 * True once a cloud settings read has verifiably completed (row present OR
 * affirmatively empty). Gates the push: an ERRORED hydration leaves this false,
 * so a later edit can't clobber the cloud row with stale/default local settings
 * (mirrors `progressHydrationOk` in progress.svelte.ts).
 */
let settingsHydrationOk = false;

/**
 * Monotonic local-edit counter vs the highest revision successfully pushed.
 * `localRev > syncedRev` means there are unsynced local edits — a whole-blob
 * cloud read must NOT overwrite them, or a re-hydration (auth refresh) that
 * fires before the outbox flush would silently revert the user's edit.
 *
 * PERSISTED (per-user namespace) so the dirty state survives a restart: an edit
 * made just before a reload, still pending in the durable outbox, would
 * otherwise reset both counters to 0 and be clobbered by the next hydration.
 */
const LOCAL_REV_KEY = 'settings-local-rev';
const SYNCED_REV_KEY = 'settings-synced-rev';
let localRev = load<number>(LOCAL_REV_KEY) ?? 0;
let syncedRev = load<number>(SYNCED_REV_KEY) ?? 0;

export function saveSettings(supabase?: SupabaseClient<Database>): void {
	localRev++;
	save(LOCAL_REV_KEY, localRev);
	save(STORAGE_KEY, settings);

	// Queue a durable cloud sync for authenticated users.
	if (supabase) enqueue('settings');
}

/** Outbox flush handler: push current settings. Throws on failure so it retries. */
export async function flushSettingsToCloud(supabase: SupabaseClient<Database>): Promise<void> {
	// Never push over a cloud row we never successfully read — a failed hydration
	// would otherwise clobber it with stale/default local settings on the next edit.
	if (!settingsHydrationOk) throw new Error('settings not hydrated — deferring push');
	const rev = localRev;
	const ok = await syncSettingsToCloud(supabase, settings);
	if (!ok) throw new Error('settings push failed');
	syncedRev = Math.max(syncedRev, rev);
	save(SYNCED_REV_KEY, syncedRev);
}

/**
 * Load settings from cloud for authenticated users.
 * Merges cloud settings with local, preferring cloud data when session exists.
 * On a load ERROR (auth/network/query), local is kept untouched — never
 * clobbered back to defaults.
 */
export async function loadSettingsFromCloud(supabase: SupabaseClient<Database>): Promise<void> {
	const gen = getScopeGeneration();
	try {
		const result = await fetchSettingsFromCloud(supabase);
		if (result.status === 'error') return; // keep local — do not clobber, stay un-hydrated
		if (gen !== getScopeGeneration()) return; // User switched mid-flight
		// Cloud state is now verifiably known (row present or affirmatively empty) —
		// the push gate may open.
		settingsHydrationOk = true;
		if (result.status === 'empty') {
			// Brand-new cloud account: push the existing local settings up so they
			// adopt to other devices without waiting for the user's next edit.
			enqueue('settings');
			return;
		}
		// Unsynced local edits outrank a whole-blob cloud read: keep local and let
		// the pending outbox flush push it, rather than reverting the user's edit.
		if (localRev > syncedRev) {
			enqueue('settings');
			return;
		}
		const cloudSettings = result.data;

		// Merge cloud settings with defaults, preferring cloud values
		const merged = { ...defaultSettings, ...cloudSettings };
		// Clamp swing to valid range (same as loadSettings)
		merged.swing = Math.max(STRAIGHT_SWING, Math.min(MAX_SWING, merged.swing as number));
		if (!VALID_BACKING_STYLES.has(merged.backingStyle as string)) {
			merged.backingStyle = 'swing';
		}

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
