import { OUTPUT_CEILING } from './mixer-policy';

/** A latency-free sample ceiling; inactive below -1 dBFS, not a true-peak limiter. */
export function createOutputProtection(context: BaseAudioContext): WaveShaperNode {
	const protection = context.createWaveShaper();
	const curve = new Float32Array(65537);
	for (let i = 0; i < curve.length; i++) {
		curve[i] = Math.max(-OUTPUT_CEILING, Math.min(OUTPUT_CEILING, 2 * i / (curve.length - 1) - 1));
	}
	protection.curve = curve;
	return protection;
}
