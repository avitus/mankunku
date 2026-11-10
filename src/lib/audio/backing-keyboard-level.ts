import type { BackingInstrument } from '$lib/types/instruments';
import { BACKING_BASE_TRIMS } from './backing-mix';

/**
 * Balanced-dB fit to matched native short/held two-, three- and four-note comping phrases,
 * velocities 56–84, MIDI 53–74, including 2.4–2.7 second pads. The MusyngKite drawbar bank was 4.88–8.69 dB
 * below SplendidGrandPiano at the shared trim. This is output calibration,
 * not velocity remapping or per-note normalization; envelope/dynamics remain.
 */
export const ORGAN_OUTPUT_GAIN = 2.18;

/** Piano remains the reference. The user's fader is multiplied separately. */
export function backingKeyboardTrim(instrument: BackingInstrument | null): number {
 return BACKING_BASE_TRIMS.comp * (instrument === 'organ' ? ORGAN_OUTPUT_GAIN : 1);
}
