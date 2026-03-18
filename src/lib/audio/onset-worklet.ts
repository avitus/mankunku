/**
 * AudioWorklet processor for onset detection.
 *
 * Uses energy-based detection with adaptive threshold — efficient enough
 * for the audio thread (~O(n) per 128-sample frame). For monophonic
 * instruments like saxophone this catches note attacks reliably.
 *
 * Algorithm:
 *   1. Compute short-term energy (RMS) per frame
 *   2. High-frequency content (HFC): weight samples by their index
 *      to emphasize transients (onsets have more HF energy)
 *   3. Compare HFC to exponential moving average
 *   4. If ratio exceeds threshold and cooldown elapsed → onset
 *
 * Posts onset timestamps to main thread via MessagePort.
 * Loaded via audioContext.audioWorklet.addModule().
 */

const ENERGY_SMOOTHING = 0.85;       // EMA smoothing factor (higher = slower adaptation)
const ONSET_THRESHOLD = 3.0;          // HFC must exceed EMA by this factor
const MIN_ONSET_INTERVAL = 0.06;      // 60ms cooldown between onsets
const SILENCE_THRESHOLD = 0.001;      // Minimum energy to consider (avoids noise triggers)

class OnsetDetectorProcessor extends AudioWorkletProcessor {
	private smoothedEnergy: number;
	private lastOnsetTime: number;
	private frameCount: number;

	constructor() {
		super();
		this.smoothedEnergy = 0;
		this.lastOnsetTime = -1;
		this.frameCount = 0;
	}

	process(
		inputs: Float32Array[][],
		_outputs: Float32Array[][],
		_parameters: Record<string, Float32Array>
	): boolean {
		const input = inputs[0]?.[0];
		if (!input || input.length === 0) return true;

		// Compute high-frequency content: sum of |sample[i]| * i
		// This naturally weights later samples in the frame and emphasizes
		// transients which have more high-frequency energy
		let hfc = 0;
		let energy = 0;
		const n = input.length;

		for (let i = 0; i < n; i++) {
			const s = input[i];
			energy += s * s;
			hfc += Math.abs(s) * (i + 1);
		}

		energy /= n; // RMS squared
		hfc /= n;

		// Skip near-silence
		if (energy < SILENCE_THRESHOLD) {
			// Decay smoothed energy during silence so next note triggers
			this.smoothedEnergy *= 0.95;
			this.frameCount++;
			return true;
		}

		// Let EMA settle for a few frames before detecting
		if (this.frameCount < 5) {
			this.smoothedEnergy = hfc;
			this.frameCount++;
			return true;
		}

		// Check for onset
		const ratio = this.smoothedEnergy > 0 ? hfc / this.smoothedEnergy : 0;
		const now = currentTime;

		if (
			ratio > ONSET_THRESHOLD &&
			now - this.lastOnsetTime > MIN_ONSET_INTERVAL
		) {
			this.lastOnsetTime = now;
			this.port.postMessage({ type: 'onset', time: now });
		}

		// Update EMA
		this.smoothedEnergy =
			ENERGY_SMOOTHING * this.smoothedEnergy + (1 - ENERGY_SMOOTHING) * hfc;

		this.frameCount++;
		return true;
	}
}

registerProcessor('onset-detector', OnsetDetectorProcessor);
