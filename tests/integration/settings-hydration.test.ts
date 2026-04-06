/**
 * Integration tests for settings cloud hydration.
 *
 * Verifies that loadSettingsFromCloud fetches fresh data on every call
 * (no stale guard) and correctly merges cloud settings into reactive state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// Mock the sync module to control what "cloud" returns
const mockFetchSettings = vi.fn();
vi.mock('$lib/persistence/sync', () => ({
	syncSettingsToCloud: vi.fn().mockResolvedValue(undefined),
	loadSettingsFromCloud: (...args: unknown[]) => mockFetchSettings(...args)
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

describe('loadSettingsFromCloud', () => {
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
