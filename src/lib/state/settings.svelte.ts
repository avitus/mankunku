import { MIXER_DEFAULTS } from '$lib/audio/mixer-policy';
import type { InstrumentConfig, BackingInstrument, BackingStyle } from '$lib/types/instruments';
import type { Tonality } from '$lib/tonality/tonality';
import { INSTRUMENTS, isInstrumentId } from '$lib/types/instruments';
import { save, load } from '$lib/persistence/storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';
import { syncSettingsToCloud, loadSettingsFromCloud as fetchSettingsFromCloud } from '$lib/persistence/sync';
import { getScopeGeneration } from '$lib/persistence/user-scope';
import { enqueue } from '$lib/persistence/outbox';
import { BACKING_STYLE_IDS } from '$lib/audio/backing-styles';
import { cleanTuneBackingStyles } from '$lib/tunes/backing-style';
import { cleanTuneTempos, clampTuneTempo } from '$lib/tunes/tune-tempo';
import { STRAIGHT_SWING, MAX_SWING } from '$lib/music/swing';

const STORAGE_KEY = 'settings';
const VALID_BACKING_STYLES = new Set<string>(BACKING_STYLE_IDS);

/** Saved settings over the defaults, with out-of-range or unknown values cleaned. */
function loadSettings() {
	const saved = load<typeof defaultSettings>(STORAGE_KEY);
	const result = saved ? { ...defaultSettings, ...saved } : { ...defaultSettings };
	// Clamp swing to valid range (0.5 straight → 0.8 heavy swing)
	result.swing = Math.max(STRAIGHT_SWING, Math.min(MAX_SWING, result.swing));
	if (!VALID_BACKING_STYLES.has(result.backingStyle)) {
		result.backingStyle = 'swing';
	}
	result.tuneBackingStyles = cleanTuneBackingStyles(result.tuneBackingStyles);
	result.tuneTempos = cleanTuneTempos(result.tuneTempos);
	return result;
}

const defaultSettings = {
	instrumentId: 'tenor-sax',
	defaultTempo: 100,
	masterVolume: MIXER_DEFAULTS.master,
	/** Device-local melody balance; cloud volume columns retain their amplitude meaning. */
	melodyVolume: MIXER_DEFAULTS.melody,
	metronomeEnabled: true,
	metronomeVolume: MIXER_DEFAULTS.click,
	backingTrackEnabled: false,
	backingInstrument: 'piano' as BackingInstrument,
	backingTrackVolume: MIXER_DEFAULTS.backing,
	backingStyle: 'swing' as BackingStyle,
	/** Personal accompaniment choices for curated and adopted tunes, keyed by stable tune id. */
	tuneBackingStyles: {} as Record<string, BackingStyle>,
	/** The tempo last chosen for each tune (desk or practice setup), keyed by stable tune id. */
	tuneTempos: {} as Record<string, number>,
	// Default to a moderate jazz swing rather than straight: melody demos and
	// the expected scoring grid should swing out of the box. Note 0.5 is also
	// resolveBackingSwing's "let the band follow the tempo curve" sentinel, so
	// with this default the band pins to the knob; dialing back to exactly
	// 0.50 restores the tempo-curve behaviour.
	swing: 0.62,
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

type Settings = typeof defaultSettings;
type SettingsKey = keyof Settings;
type FieldRevisions = Partial<Record<SettingsKey, number>>;
// Melody balance is device-local and must not enqueue an empty cloud patch.
const settingsKeys = (Object.keys(defaultSettings) as SettingsKey[]).filter(key => key !== 'melodyVolume');

// Track edits per field: an unsent volume change must not keep a fresh browser's
// default instrument or push it over the account's instrument on another device.
// Keep the old counters for returning browsers whose unsent edits predate this map.
const LOCAL_REV_KEY = 'settings-local-rev';
const SYNCED_REV_KEY = 'settings-synced-rev';
const PENDING_FIELDS_KEY = 'settings-pending-fields';
let localRev = load<number>(LOCAL_REV_KEY) ?? 0;
let syncedRev = load<number>(SYNCED_REV_KEY) ?? 0;
const pendingFields: FieldRevisions = load<FieldRevisions>(PENDING_FIELDS_KEY) ??
	(localRev > syncedRev ? Object.fromEntries(settingsKeys.map((key) => [key, localRev])) : {});
// Also remember already-sent edits for reads that began BEFORE those edits.
const lastEdited: FieldRevisions = { ...pendingFields };
let savedSnapshot: Settings = snapshotSettings();

function snapshotSettings(): Settings {
	return JSON.parse(JSON.stringify(settings)) as Settings;
}

export function saveSettings(supabase?: SupabaseClient<Database>): void {
	const snapshot = snapshotSettings();
	const changed = settingsKeys.filter((key) => JSON.stringify(snapshot[key]) !== JSON.stringify(savedSnapshot[key]));
	// A range reset belongs to the instrument choice, including null → null:
	// another browser may have saved an explicit range for the previous instrument.
	if (changed.includes('instrumentId') && !changed.includes('highestNote')) changed.push('highestNote');
	if (changed.length > 0) {
		localRev++;
		for (const key of changed) pendingFields[key] = lastEdited[key] = localRev;
		save(LOCAL_REV_KEY, localRev);
		save(PENDING_FIELDS_KEY, pendingFields);
	}
	savedSnapshot = snapshot;
	save(STORAGE_KEY, settings);

	// Queue a durable cloud sync for authenticated users.
	if (supabase && Object.keys(pendingFields).length > 0) enqueue('settings');
}

/** Remember a tune's tempo so the next visit opens at it. */
export function saveTuneTempo(tuneId: string, tempo: number, supabase?: SupabaseClient<Database>): void {
	settings.tuneTempos = { ...settings.tuneTempos, [tuneId]: clampTuneTempo(tempo) };
	saveSettings(supabase);
}

/** Outbox flush handler: push current settings. Throws on failure so it retries. */
export async function flushSettingsToCloud(supabase: SupabaseClient<Database>): Promise<void> {
	// Never push over a cloud row we never successfully read — a failed hydration
	// would otherwise clobber it with stale/default local settings on the next edit.
	if (!settingsHydrationOk) throw new Error('settings not hydrated — deferring push');
	const gen = getScopeGeneration();
	const rev = localRev;
	const sending = { ...pendingFields };
	const keys = settingsKeys.filter((key) => sending[key] !== undefined);
	if (keys.length === 0) return;
	const snapshot = snapshotSettings();
	const patch = Object.fromEntries(keys.map((key) => [key, snapshot[key]]));
	const ok = await syncSettingsToCloud(supabase, patch);
	if (gen !== getScopeGeneration()) return;
	if (!ok) throw new Error('settings push failed');
	for (const key of keys) {
		if (pendingFields[key] === sending[key]) delete pendingFields[key];
	}
	save(PENDING_FIELDS_KEY, pendingFields);
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
	const readLocalRev = localRev;
	const readPending = { ...pendingFields };
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
			for (const key of settingsKeys) pendingFields[key] ??= localRev;
			save(PENDING_FIELDS_KEY, pendingFields);
			enqueue('settings');
			return;
		}
		const cloudSettings = result.data;

		// Apply cloud values except for fields with unsent edits, or edits made
		// after this read started (even if a concurrent flush already sent them).
		const merged = { ...defaultSettings, ...cloudSettings, melodyVolume: settings.melodyVolume };
		for (const key of settingsKeys) {
			if (pendingFields[key] !== undefined || readPending[key] !== undefined || (lastEdited[key] ?? 0) > readLocalRev) {
				Object.assign(merged, { [key]: settings[key] });
			}
		}
		// Clamp swing to valid range (same as loadSettings)
		merged.swing = Math.max(STRAIGHT_SWING, Math.min(MAX_SWING, merged.swing as number));
		if (!VALID_BACKING_STYLES.has(merged.backingStyle as string)) {
			merged.backingStyle = 'swing';
		}

		merged.tuneBackingStyles = cleanTuneBackingStyles(merged.tuneBackingStyles);
		merged.tuneTempos = cleanTuneTempos(merged.tuneTempos);

		// Update the reactive state in place (preserves Svelte 5 $state reactivity)
		Object.assign(settings, merged);
		savedSnapshot = snapshotSettings();

		// Persist merged state locally for offline cache
		save(STORAGE_KEY, settings);
		if (Object.keys(pendingFields).length > 0) enqueue('settings');

		// Re-apply theme in case it changed from cloud data
		applyTheme();
	} catch (err) {
		console.warn('Failed to load settings from cloud:', err);
	}
}

export function getInstrument(): InstrumentConfig {
	return isInstrumentId(settings.instrumentId)
		? INSTRUMENTS[settings.instrumentId]
		: INSTRUMENTS['tenor-sax'];
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
