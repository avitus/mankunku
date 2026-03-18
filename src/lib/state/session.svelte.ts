import type { Phrase } from '$lib/types/music.ts';
import type { AudioEngineState, MicPermissionState } from '$lib/types/audio.ts';

export const session = $state<{
	phrase: Phrase | null;
	engineState: AudioEngineState;
	tempo: number;
	isLoadingInstrument: boolean;
	micPermission: MicPermissionState;
	inputLevel: number;
	currentPitchMidi: number | null;
	currentPitchCents: number;
	currentClarity: number;
	isDetecting: boolean;
}>({
	phrase: null,
	engineState: 'uninitialized',
	tempo: 100,
	isLoadingInstrument: false,
	micPermission: 'prompt',
	inputLevel: 0,
	currentPitchMidi: null,
	currentPitchCents: 0,
	currentClarity: 0,
	isDetecting: false
});
