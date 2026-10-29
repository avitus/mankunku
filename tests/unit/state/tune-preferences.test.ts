import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveUid } from '$lib/persistence/namespace';
import { save } from '$lib/persistence/storage';
import { savedTuneKey, savedTunePracticeStyle, savedTunePracticePreferences, savedTuneDisplay, saveTuneDisplay } from '$lib/tunes/preferences';
import { tunePractice, initTunePractice, resetTunePractice, setTunePracticeOptions, setTunePracticeKey, setTunePracticeStyle } from '$lib/state/tune-practice.svelte';
import { sheet } from '../../helpers/tune-fixtures';

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
});
afterEach(() => { setActiveUid(null); vi.unstubAllGlobals(); });

const first = sheet({ id: 'first', key: 'C', backingStyle: 'bossa-nova' });
const second = sheet({ id: 'second', key: 'G', backingStyle: 'ballad' });

describe('remembered tune settings', () => {
	it('restores mode, cues and head choice on a new visit and after a take', () => {
		initTunePractice(first);
		setTunePracticeOptions({ mode: 'points', strictness: 'solo', playHead: false });
		resetTunePractice();
		expect(tunePractice.config).toMatchObject({ mode: 'points', strictness: 'solo', playHead: false });
		// Simulate discarded module state, as after a reload.
		Object.assign(tunePractice.config, { mode: 'suggest', strictness: 'guided', playHead: true });
		initTunePractice(second);
		expect(tunePractice.config).toMatchObject({ mode: 'points', strictness: 'solo', playHead: false });
	});

	it('remembers keys and practice feel separately for each tune', () => {
		initTunePractice(first);
		expect(tunePractice.config.backingStyle).toBe('bossa-nova');
		setTunePracticeKey('Eb');
		setTunePracticeStyle('straight');
		initTunePractice(second);
		expect(tunePractice.config).toMatchObject({ concertKey: 'G', backingStyle: 'ballad' });
		setTunePracticeKey('A');
		setTunePracticeStyle('swing');
		initTunePractice(first);
		expect(tunePractice.config).toMatchObject({ concertKey: 'Eb', backingStyle: 'straight' });
		// The main tune page reads the same concert-pitch key.
		expect(savedTuneKey(first.id, first.key)).toBe('Eb');
	});

	it('isolates every new preference by account', () => {
		initTunePractice(first);
		setTunePracticeOptions({ mode: 'freestyle', strictness: 'standard', playHead: false });
		setTunePracticeKey('F');
		setTunePracticeStyle('straight');
		saveTuneDisplay('harmony-colors', false);
		saveTuneDisplay('focus', true);
		setActiveUid('another-player');
		initTunePractice(first);
		expect(tunePractice.config).toMatchObject({ mode: 'suggest', strictness: 'guided', playHead: true, concertKey: 'C', backingStyle: 'bossa-nova' });
		expect(savedTuneDisplay('harmony-colors', true)).toBe(true);
		expect(savedTuneDisplay('focus', false)).toBe(false);
		setActiveUid(null);
		initTunePractice(first);
		expect(tunePractice.config).toMatchObject({ mode: 'freestyle', strictness: 'standard', playHead: false, concertKey: 'F', backingStyle: 'straight' });
		expect(savedTuneDisplay('harmony-colors', true)).toBe(false);
		expect(savedTuneDisplay('focus', false)).toBe(true);
	});

	it('rejects invalid persisted values and preserves explicit false', () => {
		save('tune-practice-options', { mode: 'invalid', strictness: {}, playHead: false });
		save('tune-key:first', 'H');
		save('tune-practice-style:first', 'invalid');
		save('tune-display:focus', 'true');
		expect(savedTunePracticePreferences()).toEqual({ mode: 'suggest', strictness: 'guided', playHead: false });
		expect(savedTuneKey('first', 'C')).toBe('C');
		expect(savedTunePracticeStyle('first', 'ballad')).toBe('ballad');
		expect(savedTuneDisplay('focus', false)).toBe(false);
	});
});
