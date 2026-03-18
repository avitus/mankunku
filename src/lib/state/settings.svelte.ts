import type { InstrumentConfig } from '$lib/types/instruments.ts';
import { INSTRUMENTS } from '$lib/types/instruments.ts';

export const settings = $state({
	instrumentId: 'tenor-sax',
	defaultTempo: 100,
	metronomeEnabled: true,
	metronomeVolume: 0.7,
	swing: 0.5
});

export function getInstrument(): InstrumentConfig {
	return INSTRUMENTS[settings.instrumentId] ?? INSTRUMENTS['tenor-sax'];
}
