import type { InstrumentConfig } from '$lib/types/instruments.ts';
import type { Tonality } from '$lib/tonality/tonality.ts';
import { INSTRUMENTS } from '$lib/types/instruments.ts';
import { save, load } from '$lib/persistence/storage.ts';

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
	swing: 0.5,
	theme: 'dark' as 'dark' | 'light',
	onboardingComplete: false,
	/** User override for daily tonality. null = use auto-selected daily tonality. */
	tonalityOverride: null as Tonality | null
};

export const settings = $state(loadSettings());

export function saveSettings(): void {
	save(STORAGE_KEY, settings);
}

export function getInstrument(): InstrumentConfig {
	return INSTRUMENTS[settings.instrumentId] ?? INSTRUMENTS['tenor-sax'];
}

/**
 * Apply the current theme to the document.
 * Called from the layout component.
 */
export function applyTheme(): void {
	if (typeof document === 'undefined') return;
	document.documentElement.classList.toggle('light', settings.theme === 'light');
}
