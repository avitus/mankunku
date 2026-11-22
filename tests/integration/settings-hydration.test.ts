/**
 * Integration tests for settings cloud hydration and the shipped defaults.
 *
 * Verifies that loadSettingsFromCloud fetches fresh data on every call
 * (no stale guard) and correctly merges cloud settings into reactive state,
 * plus the boot defaults (swing 0.62 above the 0.50 tempo-curve sentinel,
 * metronomeVolume 0.5) and their parity with the e2e SETTINGS_ONBOARDED
 * fixture.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { INSTRUMENTS } from '$lib/types/instruments';

// Mock localStorage
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: vi.fn((key: string) => store.get(key) ?? null),
	setItem: vi.fn((key: string, val: string) => store.set(key, val)),
	removeItem: vi.fn((key: string) => store.delete(key)),
	key: vi.fn((i: number) => [...store.keys()][i] ?? null),
	get length() { return store.size; },
	clear: vi.fn(() => store.clear())
});

// Mock the sync module to control what "cloud" returns. The sync-level
// loadSettingsFromCloud is now tri-state (CloudLoad<T>): tests drive it via
// mockFetchSettings returning a bare settings object (or null), and this wrapper
// adapts that to { status:'ok', data } / { status:'empty' }. On a non-'ok'
// result the state module leaves the reactive `settings` untouched.
const mockFetchSettings = vi.fn();
vi.mock('$lib/persistence/sync', () => ({
	syncSettingsToCloud: vi.fn().mockResolvedValue(true),
	loadSettingsFromCloud: async (...args: unknown[]) => {
		const data = await mockFetchSettings(...args);
		return data == null ? { status: 'empty' } : { status: 'ok', data };
	}
}));

let settingsModule: typeof import('$lib/state/settings.svelte');

beforeEach(async () => {
	vi.resetModules();
	store.clear();
	mockFetchSettings.mockReset();

	settingsModule = await import('$lib/state/settings.svelte');
});

function mockSupabase() {
	return {
		auth: { getUser: vi.fn() },
		from: vi.fn()
	};
}

describe('shipped defaults', () => {
	it('boots with metronome only, swing 0.62 and metronomeVolume 0.5', () => {
		expect(settingsModule.settings.backingTrackEnabled).toBe(false);
		expect(settingsModule.settings.metronomeEnabled).toBe(true);
		expect(settingsModule.settings.swing).toBe(0.62);
		expect(settingsModule.settings.metronomeVolume).toBe(0.5);
	});

	it('default swing pins the band to the knob; exactly 0.50 is the tempo-curve sentinel', async () => {
		// 0.5 doubles as resolveBackingSwing's "follow the tempo curve"
		// sentinel, so the shipped default must sit ABOVE it or the band
		// ignores the knob out of the box.
		const { resolveBackingSwing } = await import('$lib/audio/backing-generation');
		const { BACKING_STYLES } = await import('$lib/audio/backing-styles');
		const { swingForTempo, STRAIGHT_SWING } = await import('$lib/music/swing');
		const style = BACKING_STYLES.swing;

		expect(settingsModule.settings.swing).toBeGreaterThan(STRAIGHT_SWING);
		for (const tempo of [60, 140, 240]) {
			expect(resolveBackingSwing(settingsModule.settings.swing, style, tempo)).toBe(0.62);
			expect(resolveBackingSwing(STRAIGHT_SWING, style, tempo)).toBe(swingForTempo(tempo));
		}
	});

	it('the e2e SETTINGS_ONBOARDED fixture matches the shipped defaults', async () => {
		// The fixture claims "Shape matches defaultSettings" — and it once
		// drifted (swing 0.5 / metronomeVolume 0.7), which meant NO test,
		// unit or e2e, ever ran with the real defaults. Compare every field;
		// only onboardingComplete may differ (the fixture's whole point).
		const { SETTINGS_ONBOARDED } = await import('../e2e/fixtures/storage');
		const defaults = { ...settingsModule.settings } as Record<string, unknown>;
		const fixture = { ...SETTINGS_ONBOARDED, onboardingComplete: defaults.onboardingComplete };
		expect(fixture).toEqual(defaults);
	});
});

describe('loadSettingsFromCloud', () => {
	it('uploads an explicit null reset while ordinary no-op saves send nothing', async () => {
		mockFetchSettings.mockResolvedValue({ tonalityOverride: null });
		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);
		const { syncSettingsToCloud } = await import('$lib/persistence/sync');
		vi.mocked(syncSettingsToCloud).mockClear();
		settingsModule.saveSettings();
		await settingsModule.flushSettingsToCloud(mockSupabase() as any);
		expect(syncSettingsToCloud).not.toHaveBeenCalled();
		settingsModule.saveSettings(undefined, ['tonalityOverride']);
		await settingsModule.flushSettingsToCloud(mockSupabase() as any);
		expect(syncSettingsToCloud).toHaveBeenLastCalledWith(expect.anything(), { tonalityOverride: null });
	});

	it('keeps an edited range paired with its instrument across reload and cloud hydration', async () => {
		mockFetchSettings.mockResolvedValue({ instrumentId: 'tenor-sax', highestNote: null });
		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);
		settingsModule.settings.highestNote = 78;
		settingsModule.saveSettings();
		vi.resetModules();
		const reloaded = await import('$lib/state/settings.svelte');
		mockFetchSettings.mockResolvedValue({ instrumentId: 'soprano-sax', highestNote: 90, swing: .67 });
		await reloaded.loadSettingsFromCloud(mockSupabase() as any);
		expect(reloaded.settings).toMatchObject({ instrumentId: 'tenor-sax', highestNote: 78, swing: .67 });
		await reloaded.flushSettingsToCloud(mockSupabase() as any);
		const { syncSettingsToCloud } = await import('$lib/persistence/sync');
		expect(syncSettingsToCloud).toHaveBeenLastCalledWith(expect.anything(), { instrumentId: 'tenor-sax', highestNote: 78 });
	});

	it('keeps melody balance and chart styles on the device without sending a cloud patch', async () => {
		mockFetchSettings.mockResolvedValue({ instrumentId: 'tenor-sax' });
		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);
		const { syncSettingsToCloud } = await import('$lib/persistence/sync');
		vi.mocked(syncSettingsToCloud).mockClear();
		settingsModule.settings.melodyVolume = 0.3;
		settingsModule.settings.leadSheetHighlight = 'staff-wash';
		settingsModule.settings.soloHighlight = 'top-strip';
		settingsModule.saveSettings();
		await settingsModule.flushSettingsToCloud(mockSupabase() as any);
		expect(syncSettingsToCloud).not.toHaveBeenCalled();

		vi.resetModules();
		const reloaded = await import('$lib/state/settings.svelte');
		mockFetchSettings.mockResolvedValue({ instrumentId: 'soprano-sax' });
		await reloaded.loadSettingsFromCloud(mockSupabase() as any);
		expect(reloaded.settings).toMatchObject({ melodyVolume:0.3, leadSheetHighlight:'staff-wash', soloHighlight:'top-strip' });
		expect(reloaded.settings.instrumentId).toBe('soprano-sax');
	});

	it('loads the account instrument even when another setting was edited before hydration', async () => {
		settingsModule.settings.theme = 'light';
		settingsModule.saveSettings();
		mockFetchSettings.mockResolvedValue({ instrumentId: 'soprano-sax', highestNote: 87, theme: 'dark' });

		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);

		expect(settingsModule.settings.instrumentId).toBe('soprano-sax');
		expect(settingsModule.settings.highestNote).toBe(87);
		expect(settingsModule.settings.theme).toBe('light');
	});

	it('preserves only edited fields across a reload before the outbox drains', async () => {
		settingsModule.settings.defaultTempo = 144;
		settingsModule.saveSettings();
		vi.resetModules();
		const reloaded = await import('$lib/state/settings.svelte');
		mockFetchSettings.mockResolvedValue({ instrumentId: 'soprano-sax', defaultTempo: 100 });

		await reloaded.loadSettingsFromCloud(mockSupabase() as any);

		expect(reloaded.settings.instrumentId).toBe('soprano-sax');
		expect(reloaded.settings.defaultTempo).toBe(144);
	});

	it('a no-op save does not prevent loading account settings', async () => {
		settingsModule.saveSettings();
		mockFetchSettings.mockResolvedValue({ instrumentId: 'soprano-sax' });
		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);
		expect(settingsModule.settings.instrumentId).toBe('soprano-sax');
	});

	it('does not push an old instrument or swing when a browser changes only its volume', async () => {
		mockFetchSettings.mockResolvedValue({ instrumentId: 'tenor-sax', swing: 0.5 });
		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);
		settingsModule.settings.masterVolume = 0.4;
		settingsModule.saveSettings();
		await settingsModule.flushSettingsToCloud(mockSupabase() as any);
		const { syncSettingsToCloud } = await import('$lib/persistence/sync');
		expect(syncSettingsToCloud).toHaveBeenLastCalledWith(expect.anything(), { masterVolume: 0.4 });

		mockFetchSettings.mockResolvedValue({ instrumentId: 'soprano-sax', swing: 0.62, masterVolume: 0.4 });
		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);
		expect(settingsModule.settings.instrumentId).toBe('soprano-sax');
		expect(settingsModule.settings.swing).toBe(0.62);
	});

	it('keeps a pending edit when its flush finishes before an older read returns', async () => {
		mockFetchSettings.mockResolvedValue({ swing: 0.5 });
		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);
		settingsModule.settings.swing = 0.62;
		settingsModule.saveSettings();
		let answer!: (value: unknown) => void;
		mockFetchSettings.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
		const reading = settingsModule.loadSettingsFromCloud(mockSupabase() as any);
		await settingsModule.flushSettingsToCloud(mockSupabase() as any);
		answer({ instrumentId: 'soprano-sax', swing: 0.5 });
		await reading;
		expect(settingsModule.settings.swing).toBe(0.62);
		expect(settingsModule.settings.instrumentId).toBe('soprano-sax');
	});

	it('retains a newer edit made during a push, including after restarting', async () => {
		mockFetchSettings.mockResolvedValue({ swing: 0.5 });
		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);
		const { syncSettingsToCloud } = await import('$lib/persistence/sync');
		let finish!: (value: boolean) => void;
		vi.mocked(syncSettingsToCloud).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
		settingsModule.settings.swing = 0.62;
		settingsModule.saveSettings();
		const flushing = settingsModule.flushSettingsToCloud(mockSupabase() as any);
		settingsModule.settings.swing = 0.67;
		settingsModule.saveSettings();
		finish(true);
		await flushing;
		vi.resetModules();
		const reloaded = await import('$lib/state/settings.svelte');
		mockFetchSettings.mockResolvedValue({ instrumentId: 'soprano-sax', swing: 0.62 });
		await reloaded.loadSettingsFromCloud(mockSupabase() as any);
		expect(reloaded.settings.swing).toBe(0.67);
		expect(reloaded.settings.instrumentId).toBe('soprano-sax');
	});

	it('keeps legacy unsent edits when a returning browser has no per-field metadata yet', async () => {
		store.set('mankunku:settings', JSON.stringify({ instrumentId: 'soprano-sax', swing: 0.62 }));
		store.set('mankunku:settings-local-rev', '3');
		store.set('mankunku:settings-synced-rev', '2');
		vi.resetModules();
		const reloaded = await import('$lib/state/settings.svelte');
		mockFetchSettings.mockResolvedValue({ instrumentId: 'tenor-sax', swing: 0.5 });
		await reloaded.loadSettingsFromCloud(mockSupabase() as any);
		expect(reloaded.settings.instrumentId).toBe('soprano-sax');
		expect(reloaded.settings.swing).toBe(0.62);
	});

	it('sends the range reset with an instrument change even when it was already null locally', async () => {
		mockFetchSettings.mockResolvedValue({ instrumentId: 'tenor-sax', highestNote: null });
		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);
		settingsModule.settings.instrumentId = 'soprano-sax';
		settingsModule.saveSettings();
		await settingsModule.flushSettingsToCloud(mockSupabase() as any);
		const { syncSettingsToCloud } = await import('$lib/persistence/sync');
		expect(syncSettingsToCloud).toHaveBeenLastCalledWith(expect.anything(), {
			instrumentId: 'soprano-sax', highestNote: null
		});
	});

	it('merges cloud settings into reactive state', async () => {
		mockFetchSettings.mockResolvedValue({
			instrumentId: 'alto-sax',
			swing: 0.67,
			defaultTempo: 140,
			masterVolume: 0.9,
			metronomeEnabled: false,
			metronomeVolume: 0.5,
			backingTrackEnabled: true,
			backingInstrument: 'organ',
			backingTrackVolume: 0.7,
			theme: 'light',
			onboardingComplete: true,
			tonalityOverride: null,
			highestNote: null
		});

		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);

		expect(settingsModule.settings.instrumentId).toBe('alto-sax');
		expect(settingsModule.settings.backingTrackEnabled).toBe(true);
		expect(settingsModule.settings.swing).toBeCloseTo(0.67);
		expect(settingsModule.settings.defaultTempo).toBe(140);
		expect(settingsModule.settings.theme).toBe('light');
	});

	it('fetches fresh data on every call (no stale guard)', async () => {
		// First call: cloud returns swing 0.6
		mockFetchSettings.mockResolvedValue({
			swing: 0.6,
			instrumentId: 'tenor-sax',
			defaultTempo: 100,
			masterVolume: 0.8,
			metronomeEnabled: true,
			metronomeVolume: 0.7,
			backingTrackEnabled: true,
			backingInstrument: 'piano',
			backingTrackVolume: 0.6,
			theme: 'dark',
			onboardingComplete: false,
			tonalityOverride: null,
			highestNote: null
		});
		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);
		expect(settingsModule.settings.swing).toBeCloseTo(0.6);

		// Second call: cloud returns swing 0.75 (changed on another device)
		mockFetchSettings.mockResolvedValue({
			swing: 0.75,
			instrumentId: 'tenor-sax',
			defaultTempo: 120,
			masterVolume: 0.8,
			metronomeEnabled: true,
			metronomeVolume: 0.7,
			backingTrackEnabled: true,
			backingInstrument: 'piano',
			backingTrackVolume: 0.6,
			theme: 'dark',
			onboardingComplete: false,
			tonalityOverride: null,
			highestNote: null
		});
		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);
		expect(settingsModule.settings.swing).toBeCloseTo(0.75);
		expect(settingsModule.settings.defaultTempo).toBe(120);

		expect(mockFetchSettings).toHaveBeenCalledTimes(2);
	});

	it('clamps swing to valid range', async () => {
		mockFetchSettings.mockResolvedValue({
			swing: 0.95, // above max 0.8
			instrumentId: 'tenor-sax',
			defaultTempo: 100,
			masterVolume: 0.8,
			metronomeEnabled: true,
			metronomeVolume: 0.7,
			backingTrackEnabled: true,
			backingInstrument: 'piano',
			backingTrackVolume: 0.6,
			theme: 'dark',
			onboardingComplete: false,
			tonalityOverride: null,
			highestNote: null
		});
		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);
		expect(settingsModule.settings.swing).toBe(0.8);
	});

	it('clamps swing below minimum to 0.5', async () => {
		mockFetchSettings.mockResolvedValue({
			swing: 0.3, // below min 0.5
			instrumentId: 'tenor-sax',
			defaultTempo: 100,
			masterVolume: 0.8,
			metronomeEnabled: true,
			metronomeVolume: 0.7,
			backingTrackEnabled: true,
			backingInstrument: 'piano',
			backingTrackVolume: 0.6,
			theme: 'dark',
			onboardingComplete: false,
			tonalityOverride: null,
			highestNote: null
		});
		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);
		expect(settingsModule.settings.swing).toBe(0.5);
	});

	it('does nothing when cloud returns null', async () => {
		mockFetchSettings.mockResolvedValue(null);
		const swingBefore = settingsModule.settings.swing;

		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);

		expect(settingsModule.settings.swing).toBe(swingBefore);
	});

	it('handles cloud fetch errors gracefully', async () => {
		mockFetchSettings.mockRejectedValue(new Error('network error'));

		await expect(
			settingsModule.loadSettingsFromCloud(mockSupabase() as any)
		).resolves.toBeUndefined();
	});

	it('persists merged settings to localStorage', async () => {
		mockFetchSettings.mockResolvedValue({
			swing: 0.7,
			instrumentId: 'tenor-sax',
			defaultTempo: 100,
			masterVolume: 0.8,
			metronomeEnabled: true,
			metronomeVolume: 0.7,
			backingTrackEnabled: true,
			backingInstrument: 'piano',
			backingTrackVolume: 0.6,
			theme: 'dark',
			onboardingComplete: false,
			tonalityOverride: null,
			highestNote: null
		});

		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);

		const saved = store.get('mankunku:settings');
		expect(saved).toBeDefined();
		const parsed = JSON.parse(saved!);
		expect(parsed.swing).toBeCloseTo(0.7);
	});
});

describe('instrument lookups', () => {
	it('falls back to tenor sax for a stored instrument id the app no longer knows', () => {
		settingsModule.settings.instrumentId = 'kazoo' as typeof settingsModule.settings.instrumentId;
		expect(settingsModule.getInstrument()).toEqual(INSTRUMENTS['tenor-sax']);
	});

	it('the highest note defaults to one semitone under the instrument\'s concert ceiling; an explicit one wins', () => {
		settingsModule.settings.instrumentId = 'tenor-sax';
		expect(settingsModule.getEffectiveHighestNote()).toBe(INSTRUMENTS['tenor-sax'].concertRangeHigh - 1);
		settingsModule.settings.instrumentId = 'alto-sax';
		expect(settingsModule.getEffectiveHighestNote()).toBe(INSTRUMENTS['alto-sax'].concertRangeHigh - 1);

		settingsModule.settings.highestNote = 70;
		expect(settingsModule.getEffectiveHighestNote()).toBe(70);
	});
});

describe('personal tune backing choices', () => {
	it('hydrates valid styles from another device and drops unsupported values', async () => {
		mockFetchSettings.mockResolvedValue({ backingStyle: 'straight', tuneBackingStyles: { song: 'bossa-nova', corrupt: 'unknown' } });
		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);
		expect(settingsModule.settings.tuneBackingStyles).toEqual({ song: 'bossa-nova' });
		expect(settingsModule.settings.backingStyle).toBe('straight');
	});
	it('retains an unsynced local tune choice when a stale cloud hydration arrives', async () => {
		settingsModule.settings.tuneBackingStyles = { song: 'ballad' };
		settingsModule.saveSettings();
		mockFetchSettings.mockResolvedValue({ tuneBackingStyles: { song: 'swing' } });
		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);
		expect(settingsModule.settings.tuneBackingStyles).toEqual({ song: 'ballad' });
	});
});

describe('personal tune tempos', () => {
	it('hydrates valid tempos from another device and drops corrupt values', async () => {
		mockFetchSettings.mockResolvedValue({ tuneTempos: { song: 168, corrupt: 'fast' } });
		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);
		expect(settingsModule.settings.tuneTempos).toEqual({ song: 168 });
	});
	it('saveTuneTempo survives a reload and leaves other tunes alone', async () => {
		settingsModule.saveTuneTempo('song', 144);
		settingsModule.saveTuneTempo('other', 300);
		vi.resetModules();
		const reloaded = await import('$lib/state/settings.svelte');
		expect(reloaded.settings.tuneTempos).toEqual({ song: 144, other: 240 });
		expect(reloaded.settings.defaultTempo).toBe(100);
	});
	it('retains an unsynced local tempo when a stale cloud hydration arrives', async () => {
		settingsModule.saveTuneTempo('song', 144);
		mockFetchSettings.mockResolvedValue({ tuneTempos: { song: 100 } });
		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);
		expect(settingsModule.settings.tuneTempos).toEqual({ song: 144 });
	});
	it('discards a cloud read that an edit, already pushed, overtook while it was in flight', async () => {
		// A first hydration opens the push gate, as an earlier page load would have.
		mockFetchSettings.mockResolvedValue({ tuneTempos: { song: 100 } });
		await settingsModule.loadSettingsFromCloud(mockSupabase() as any);
		// A same-user auth refresh starts a second read ...
		let answer!: (value: unknown) => void;
		mockFetchSettings.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
		const reading = settingsModule.loadSettingsFromCloud(mockSupabase() as any);
		// ... the user sets a tempo and the outbox pushes it before the read returns.
		settingsModule.saveTuneTempo('song', 144);
		await settingsModule.flushSettingsToCloud(mockSupabase() as any);
		answer({ tuneTempos: { song: 100 } });
		await reading;
		expect(settingsModule.settings.tuneTempos).toEqual({ song: 144 });
	});
});
