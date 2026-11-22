import { INSTRUMENTS, CONCERT_INSTRUMENT_IDS, isConcertInstrument, isInstrumentId, type InstrumentId } from '$lib/types/instruments';
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

// Fixed amplitude trims relative to the recorded tenor sax. Measured by
// integrated loudness across the four calls in docs/maintenance/audio-mixer/ear-training-levels.md.
const trimDb = {
	'tenor-sax': 0, 'alto-sax': -2.5, 'soprano-sax': -6.3, trumpet: -4,
	piano: -13.4, concert: -13.4, bass: -16.3, guitar: -9.2, trombone: -3,
	flute: -4.7, vibraphone: -4.4, violin: -10.5, voice: -9.4
} satisfies Record<InstrumentId, number>;

const fallbackTrimDb = { 'tenor-sax': -8.4, 'alto-sax': -10.1, 'soprano-sax': -6.1 };

export function earTrainingGain(id: string, usingSaxSoundfont: boolean): number {
	const key = isInstrumentId(id) ? id : 'tenor-sax';
	const db = usingSaxSoundfont && (key === 'tenor-sax' || key === 'alto-sax' || key === 'soprano-sax')
		? fallbackTrimDb[key] : trimDb[key];
	return 10 ** (db / 20);
}

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
		: new Soundfont(context, { ...SOUNDFONT_OPTIONS, kit: voice === 'violin' ? 'FluidR3_GM' : 'MusyngKite', instrument: voice, loadLoopData: true, destination, storage });
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
