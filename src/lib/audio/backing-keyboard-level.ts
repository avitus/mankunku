import type { BackingInstrument, BackingStyle } from '$lib/types/instruments';
import { BACKING_BASE_TRIMS } from './backing-mix';

/**
 * Balanced-dB fit to matched native short/held two-, three- and four-note comping phrases,
 * velocities 56–84, MIDI 53–74, including 2.4–2.7 second pads. The MusyngKite drawbar bank was 4.88–8.69 dB
 * below SplendidGrandPiano at the shared trim. This is output calibration,
 * not velocity remapping or per-note normalization; envelope/dynamics remain.
 */
export const ORGAN_OUTPUT_GAIN = 2.18;

/** Piano remains the reference. The user's fader is multiplied separately. */
export function backingKeyboardTrim(instrument: BackingInstrument | null, style?: BackingStyle): number {
 // Full-tune Ballad pads sustain more energy than the short-phrase reference.
 // Native seed 7 measured +2.71 dB in 0.11. The 0.15 complete AABA
 // measured +2.24 dB after the earlier 0.9 trim; 0.86 adds -0.40 dB
 // so long settled harmonies also stay within the existing 2 dB bound.
 // Short Bossa gates remain quieter in the drawbar bank: the 0.15 full-tune
 // matrix measured about -1.3 to -2.04 dB. +0.51 dB restores margin without
 // changing note dynamics, the user's fader, or other styles. Both modes and
 // live/bounce paths share this calibration.
 return BACKING_BASE_TRIMS.comp * (instrument === 'organ' ? ORGAN_OUTPUT_GAIN * (style === 'ballad' ? 0.86 : style === 'bossa-nova' ? 1.06 : 1) : 1);
}
