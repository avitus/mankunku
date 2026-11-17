import { BACKING_OUTPUT_REFERENCE, BACKING_INPUT_REFERENCE, MIXER_DEFAULTS, clampGain } from './mixer-policy';
/** One post-compression level on every surface. The fader cannot change compression. */
export function backingOutputGain(volume: number = MIXER_DEFAULTS.backing): number {
 return BACKING_OUTPUT_REFERENCE * clampGain(volume) / BACKING_INPUT_REFERENCE;
}
/** Connect the shared post-compression calibration and backing fader. */
export function connectBackingOutput(compressor: AudioNode, destination: AudioNode, volume: number = MIXER_DEFAULTS.backing): GainNode {
 const output=compressor.context.createGain();
 output.gain.value=backingOutputGain(volume);
 compressor.connect(output); output.connect(destination);
 return output;
}
