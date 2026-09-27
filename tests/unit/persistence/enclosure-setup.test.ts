import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnclosureSetup, saveEnclosureSetup, wasEnclosureSetupActive } from '$lib/persistence/enclosure-setup';
import { save } from '$lib/persistence/storage';
import { __resetNamespaceCacheForTests, setActiveUid } from '$lib/persistence/namespace';
import type { LickPracticeConfig } from '$lib/types/lick-practice';

beforeEach(() => {
	const data = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => data.set(key, value),
		removeItem: (key: string) => data.delete(key),
		key: (index: number) => [...data.keys()][index] ?? null,
		get length() { return data.size; }
	});
	__resetNamespaceCacheForTests();
	setActiveUid('alice');
});

const config: LickPracticeConfig = {
	sessionType: 'trick', trickId: 'enclosures', progressionType: 'ii-V-I-major',
	durationMinutes: 15, practiceMode: 'call-response', backingStyle: 'bossa-nova',
	trickProgressionType: 'ii-V-I-minor-long',
	trickParameters: { type: 'minor', noteCount: '2', shape: 'above-below', targetTone: 'third', beatPlacement: 'offbeat' }
};

describe('enclosure setup preferences', () => {
	it('keeps the setup when another practice mode is selected without reopening enclosures on reload', () => {
		saveEnclosureSetup(config);
		expect(wasEnclosureSetupActive()).toBe(true);
		saveEnclosureSetup({ ...config, sessionType: 'daily' });
		expect(wasEnclosureSetupActive()).toBe(false);
		expect(loadEnclosureSetup()).toEqual({
			trickParameters: config.trickParameters, trickProgressionType: config.trickProgressionType,
			practiceMode: config.practiceMode, backingStyle: config.backingStyle
		});
	});

	it('isolates saved setups between users', () => {
		saveEnclosureSetup(config);
		setActiveUid('bob');
		expect(loadEnclosureSetup()).toBeNull();
		expect(wasEnclosureSetupActive()).toBe(false);
		setActiveUid('alice');
		expect(loadEnclosureSetup()?.trickParameters).toEqual(config.trickParameters);
	});

	it('ignores invalid saved parameters and falls back for unsupported beds', () => {
		save('enclosure-setup', { ...config, trickParameters: { noteCount: '999' } });
		expect(loadEnclosureSetup()).toBeNull();
		save('enclosure-setup', { ...config, trickProgressionType: 'removed-progression' });
		expect(loadEnclosureSetup()?.trickProgressionType).toBe('minor-vamp');
	});
});
