import { INSTRUMENTS, CONCERT_INSTRUMENT_IDS, isConcertInstrument } from '$lib/types/instruments';
import { createBackingSampleLoader, createSampleStorage } from './backing-sample-loader';
import { loadBackingBass } from './backing-bass-instrument';
import { extendMelodyBassRange } from './backing-bass-samples';
import { SAMPLE_OPTIONS, SOUNDFONT_OPTIONS, SOUNDFONT_REFERENCE, SAMPLE_CHANNEL_REFERENCE } from './mixer-policy';

const voices = {
	piano: 'grand',
	concert: 'grand',
	bass: 'upright',
	guitar: 'electric_guitar_jazz',
	trombone: 'trombone',
	flute: 'flute',
	vibraphone: 'vibraphone',
	violin: 'violin',
	voice: 'voice_oohs'
} as const satisfies Record<typeof CONCERT_INSTRUMENT_IDS[number], string>;
type Voice = typeof voices[keyof typeof voices];

export function earTrainingVoice(id: string): Voice | undefined {
	return isConcertInstrument(id) ? voices[id] : undefined;
}

/** A player owned by Melody, independent of the accompaniment's transport and fader. */
export async function loadEarTrainingVoice(context: AudioContext, destination: GainNode, voice: Voice) {
	const { Soundfont, SplendidGrandPiano, Smolken, CacheStorage } = await import('smplr');
	const storage = createSampleStorage(CacheStorage);
	const loader = createBackingSampleLoader(context, storage);
	if (voice === 'upright') {
		return loadBackingBass(context, Smolken, {
			instrument: 'Pizzicato', destination, storage, loader
		}, preset => extendMelodyBassRange(preset, Math.max(...INSTRUMENTS.bass.highNotePresets)));
	}
	const player = voice === 'grand'
		? new SplendidGrandPiano(context, { ...SAMPLE_OPTIONS, destination, storage, loader })
		: new Soundfont(context, { ...SOUNDFONT_OPTIONS, kit: 'MusyngKite', instrument: voice, loadLoopData: true, destination, storage });
	try {
		await player.load;
		const trim = context.createGain();
		trim.gain.value = voice === 'grand' ? SAMPLE_CHANNEL_REFERENCE : SOUNDFONT_REFERENCE;
		player.output.addInsert(trim);
		return player;
	} catch (error) {
		player.disconnect();
		throw error;
	}
}
