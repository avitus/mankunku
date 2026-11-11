/** Shared live/bounce output: boost after compression to preserve its response. */
export const BACKING_OUTPUT_GAIN = 10 ** (6 / 20);
export function backingOutputGain(master = 1, reference = BACKING_OUTPUT_GAIN): number {
 return (Number.isFinite(reference) ? Math.max(0, reference) : BACKING_OUTPUT_GAIN) * (Number.isFinite(master) ? Math.max(0, Math.min(3, master)) : 1);
}
export function connectBackingOutput(compressor: AudioNode, destination: AudioNode, master = 1): GainNode {
 const output = compressor.context.createGain();
 output.gain.value = backingOutputGain(master);
 compressor.connect(output);
 output.connect(destination);
 return output;
}
