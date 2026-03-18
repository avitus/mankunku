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

export interface AudioState {
	engineState: AudioEngineState;
	micPermission: MicPermissionState;
	/** Current input level (0-1) for mic meter */
	inputLevel: number;
	/** Real-time detected pitch during recording */
	currentPitch: number | null;
	/** Real-time clarity during recording */
	currentClarity: number;
	/** Sample rate of the AudioContext */
	sampleRate: number;
}

export interface PlaybackOptions {
	/** BPM */
	tempo: number;
	/** Swing ratio (0.5 = straight, 0.67 = triplet swing) */
	swing: number;
	/** Count-in beats before recording */
	countInBeats: number;
	/** Enable metronome click */
	metronomeEnabled: boolean;
	/** Metronome volume (0-1) */
	metronomeVolume: number;
}
