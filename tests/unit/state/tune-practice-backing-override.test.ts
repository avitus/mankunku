import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveTunePlayback, savedTunePlayback } from '$lib/tunes/playback-preferences';
import { setActiveUid } from '$lib/persistence/namespace';
import { TunePlayer } from '$lib/state/tune-player.svelte';
import { settings } from '$lib/state/settings.svelte';
import {
	tunePractice,
	initTunePractice,
	resetTunePractice,
	setTunePracticeBacking,
	setTunePracticeMelody,
	setTunePracticeMetronome
} from '$lib/state/tune-practice.svelte';
import { sheet } from '../../helpers/tune-fixtures';

describe('remembered tune playback preferences', () => {
	const tune = sheet({ id: 'override-tune', title: 'Override Tune' });
	const other = sheet({ id: 'other-tune', title: 'Other Tune' });

	beforeEach(() => {
		const values = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
			removeItem: (key: string) => values.delete(key),
			get length() { return values.size; },
			key: (index: number) => [...values.keys()][index] ?? null
		});
		setActiveUid(null);
		settings.backingTrackEnabled = true;
	});
	afterEach(() => { setActiveUid(null); vi.unstubAllGlobals(); });

	it('seeds the session switch from the global setting', () => {
		settings.backingTrackEnabled = false;
		initTunePractice(tune);
		expect(tunePractice.config.backingTrackEnabled).toBe(false);

		settings.backingTrackEnabled = true;
		initTunePractice(tune);
		expect(tunePractice.config.backingTrackEnabled).toBe(true);
	});

	it('leaves the global setting untouched when the session switch is flipped', () => {
		settings.backingTrackEnabled = false;
		initTunePractice(tune);

		setTunePracticeBacking(true);

		expect(settings.backingTrackEnabled).toBe(false);
	});

	it('retains the choice on a return visit to the same tune', () => {
		settings.backingTrackEnabled = false;
		initTunePractice(tune);
		setTunePracticeBacking(true);

		// Leaving and reopening the same tune keeps the saved choice.
		initTunePractice(tune);

		expect(tunePractice.config.backingTrackEnabled).toBe(true);
	});

	it('retains the choice when returning to setup after a take', () => {
		settings.backingTrackEnabled = false;
		initTunePractice(tune);
		setTunePracticeBacking(true);

		// "Practice again" returns to setup without re-initialising the tune,
		// and the zombie-phase guard takes the same path.
		resetTunePractice();

		expect(tunePractice.config.backingTrackEnabled).toBe(true);
	});

	it('retains the choice when a different tune is set up', () => {
		settings.backingTrackEnabled = false;
		initTunePractice(tune);
		setTunePracticeBacking(true);

		initTunePractice(other);

		expect(tunePractice.config.backingTrackEnabled).toBe(true);
	});
	it('shares the saved setting with the main tune player', () => {
		setTunePracticeBacking(true);
		const player = new TunePlayer();
		player.restorePlaybackPreferences();
		expect(player.backing).toBe(true);
		player.setBacking(false);
		resetTunePractice();
		expect(tunePractice.config.backingTrackEnabled).toBe(false);
		player.dispose();
	});

	it('remembers off even when the global setting is on, with separate choices per account', () => {
		setActiveUid('first-player');
		setTunePracticeBacking(false);
		initTunePractice(tune);
		expect(tunePractice.config.backingTrackEnabled).toBe(false);
		setActiveUid('second-player');
		expect(savedTunePlayback('backing', true)).toBe(true);
		saveTunePlayback('backing', true);
		setActiveUid('first-player');
		expect(savedTunePlayback('backing', true)).toBe(false);
	});

	it.each([
		['melody', 'melodyEnabled', true, setTunePracticeMelody],
		['metronome', 'metronomeEnabled', false, setTunePracticeMetronome]
	] as const)('shares and restores %s on both pages, across tunes and accounts', (name, field, fallback, setPractice) => {
		initTunePractice(tune);
		expect(tunePractice.config[field]).toBe(fallback);
		setPractice(!fallback);
		initTunePractice(other);
		expect(tunePractice.config[field]).toBe(!fallback);
		const player = new TunePlayer();
		player.restorePlaybackPreferences();
		expect(player[name]).toBe(!fallback);
		if (name === 'melody') player.setMelody(fallback);
		else player.setMetronome(fallback);
		resetTunePractice();
		expect(tunePractice.config[field]).toBe(fallback);
		setActiveUid('other-player');
		setPractice(!fallback);
		setActiveUid(null);
		initTunePractice(tune);
		expect(tunePractice.config[field]).toBe(fallback);
		player.dispose();
	});
});

/**
 * The saved choice must drive the SESSION value read by the audio and the
 * scoring read. A source sweep rather than a behavioural test because the
 * reads live in the route's audio orchestration, which has no Node seam: the
 * bleed-evidence call is the one that matters most and is the hardest to
 * observe — a comp grid claimed but not sounding suppresses real onsets as
 * bleed, silently costing the player notes.
 */
describe('tune-practice route reads the captured session setting', () => {
	const route = readFileSync(
		join(__dirname, '../../../src/routes/tunes/[id]/practice/+page.svelte'),
		'utf8'
	);

	it('never reads global backing or metronome enablement', () => {
		const hits = [...route.matchAll(/settings\.(backingTrackEnabled|metronomeEnabled)/g)];
		expect(
			hits,
			'the route must read the session override everywhere the global could differ — note the sweep is textual, so a comment spelling the global out trips it too'
		).toHaveLength(0);
	});

	it.each(['backingTrackEnabled', 'metronomeEnabled'])('passes session %s to playback and bleed evidence', (field) => {
		const hits = [...route.matchAll(new RegExp(`${field}: tunePractice\\.config\\.${field}`, 'g'))];
		expect(hits).toHaveLength(2);
	});
});
