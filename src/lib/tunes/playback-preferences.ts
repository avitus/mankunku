import { load, save } from '$lib/persistence/storage';

type TunePlaybackPreference = 'backing' | 'melody' | 'metronome';

/** Shared by tune playback and lick practice, in the active user's local storage. */
export function savedTunePlayback(preference: TunePlaybackPreference, fallback: boolean): boolean {
	const value = load<unknown>(`tune-${preference}-enabled`);
	return typeof value === 'boolean' ? value : fallback;
}

export function saveTunePlayback(preference: TunePlaybackPreference, enabled: boolean): boolean {
	save(`tune-${preference}-enabled`, enabled);
	return enabled;
}
