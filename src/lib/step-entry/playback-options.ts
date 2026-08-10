import type { PlaybackOptions } from '$lib/types/audio';

/** Settings the lick-entry preview needs to play a lick back accurately. */
export interface EntryPlaybackSettings {
	/** BPM to preview at (user's default tempo). */
	tempo: number;
	/** Swing ratio (0.5 straight → 0.8 heavy). */
	swing: number;
	/** Metronome volume (0-1). Carried through so a click would honour the
	 *  user's setting if one is ever enabled during editing. */
	metronomeVolume: number;
}

/**
 * Build playback options for previewing a lick on the entry/edit page.
 *
 * Swing is the user's raw setting. This preview schedules no backing track,
 * so there is no band for it to disagree with and no style to defer to —
 * unlike the scored surfaces, which resolve swing against the selected
 * backing style (see `resolveMelodySwing`). On a ballad or bossa the same
 * lick will therefore preview here on a slightly different grid than it is
 * played on in a session. There is no count-in and
 * the metronome is off — the preview is a bare "hear what I just entered"
 * play — but the metronome volume still tracks the user's setting so a click
 * would sound at the right level if one is ever added here.
 */
export function buildEntryPlaybackOptions(settings: EntryPlaybackSettings): PlaybackOptions {
	return {
		tempo: settings.tempo,
		swing: settings.swing,
		countInBeats: 0,
		metronomeEnabled: false,
		metronomeVolume: settings.metronomeVolume
	};
}
