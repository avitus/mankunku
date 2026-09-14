import type { BackingInstrument, BackingStyle } from './instruments';

export interface DetectedNote {
	/** MIDI note number (concert pitch) */
	midi: number;
	/** Cents deviation from nearest MIDI note (-50 to +50) */
	cents: number;
	/** Onset time relative to recording start, in seconds */
	onsetTime: number;
	/** Duration in seconds */
	duration: number;
	/** Pitch detection clarity (0-1) */
	clarity: number;
}

export type MicPermissionState = 'prompt' | 'granted' | 'denied' | 'unavailable';

export type AudioEngineState = 'uninitialized' | 'loading' | 'ready' | 'playing' | 'recording' | 'error';

export interface PlaybackOptions {
	/** BPM */
	tempo: number;
	/** Swing ratio: 0.5 = straight, 0.67 = triplet, 0.8 = heavy */
	swing: number;
	/** Count-in beats before recording */
	countInBeats: number;
	/** Enable metronome click */
	metronomeEnabled: boolean;
	/** Metronome volume (0-1) */
	metronomeVolume: number;
	/** Enable backing track accompaniment */
	backingTrackEnabled?: boolean;
	/** Comping instrument: piano or organ */
	backingInstrument?: BackingInstrument;
	/** Backing track volume (0-1) */
	backingTrackVolume?: number;
	/** Backing track musical style */
	backingStyle?: BackingStyle;
}
