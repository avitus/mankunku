import type { InstrumentConfig } from '$lib/types/instruments.ts';
import { INSTRUMENTS } from '$lib/types/instruments.ts';
import { save, load } from '$lib/persistence/storage.ts';

const STORAGE_KEY = 'settings';

function loadSettings() {
	const saved = load<typeof defaultSettings>(STORAGE_KEY);
	return saved ? { ...defaultSettings, ...saved } : { ...defaultSettings };
}

const defaultSettings = {
	instrumentId: 'tenor-sax',
	defaultTempo: 100,
	metronomeEnabled: true,
	metronomeVolume: 0.7,
	swing: 0.5,
	theme: 'dark' as 'dark' | 'light',
	onboardingComplete: false
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
