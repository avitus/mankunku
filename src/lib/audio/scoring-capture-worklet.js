// @ts-nocheck — plain JS asset loaded into AudioWorkletGlobalScope.
/** Microphone PCM on the shared audio clock; never outputs audible audio. */
class ScoringCaptureProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.start = null;
		this.end = null;
		this.chunks = [];
		this.stopped = false;
		this.limit = sampleRate * 180;
		this.port.onmessage = ({ data }) => {
			if (data.type === 'start') this.start = data.frame;
			if (data.type === 'stop') this.end = data.frame;
			if (data.type === 'dispose') { this.chunks = []; this.stopped = true; }
		};
	}

	process(inputs, outputs) {
		if (this.stopped) return false;
		if (this.start === null) return true;
		const input = inputs[0]?.[0];
		const frames = outputs[0][0].length;
		const end = Math.min(currentFrame + frames, this.end ?? Infinity);
		if (end - this.start > this.limit) {
			this.port.postMessage({ failed: true });
			this.chunks = [];
			return false;
		}
		// Store by absolute sample position, preserving silence and any delay
		// delivering the start message. Sample zero stays at the arm instant.
		for (let frame = Math.max(currentFrame, this.start); frame < end; frame++) {
			const offset = frame - this.start;
			const index = Math.floor(offset / sampleRate);
			const chunk = this.chunks[index] ??= new Float32Array(sampleRate);
			chunk[offset % sampleRate] = input?.[frame - currentFrame] ?? 0;
		}
		if (this.end !== null && currentFrame + frames >= this.end) {
			const samples = new Float32Array(Math.max(0, this.end - this.start));
			for (let i = 0; i < this.chunks.length; i++) {
				const chunk = this.chunks[i];
				if (chunk && i * sampleRate < samples.length) {
					samples.set(chunk.subarray(0, samples.length - i * sampleRate), i * sampleRate);
				}
			}
			this.port.postMessage({ samples }, [samples.buffer]);
			this.chunks = [];
			return false;
		}
		return true;
	}
}
registerProcessor('scoring-capture', ScoringCaptureProcessor);
