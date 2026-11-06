// @ts-nocheck — plain JS asset loaded into AudioWorkletGlobalScope.
class RecordTakeProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.samples = null;
		this.length = 0;
		this.stopped = false;
		this.activeFrames = 0;
		this.lastActivity = -Infinity;
		this.port.onmessage = ({ data }) => {
			if (data.type === 'arm') {
				this.start = data.start;
				this.samples = new Float32Array(data.frames);
				this.length = 0;
			} else if (data.type === 'finish') {
				const samples = this.samples?.subarray(0, this.length);
				this.port.postMessage({ samples, start: this.start }, samples ? [samples.buffer] : []);
				this.samples = null;
				this.stopped = true;
			} else if (data.type === 'dispose') {
				this.samples = null;
				this.stopped = true;
			}
		};
	}

	process(inputs) {
		const input = inputs[0]?.[0];
		if (input && this.samples) {
			const offset = currentFrame - this.start;
			const from = Math.max(0, -offset);
			const to = Math.min(input.length, this.samples.length - offset);
			if (to > from) {
				this.samples.set(input.subarray(from, to), offset + from);
				this.length = offset + to;
				let energy = 0;
				for (let j = from; j < to; j++) energy += input[j] * input[j];
				this.activeFrames = energy > (to - from) * 0.00005 ? this.activeFrames + to - from : 0;
				if (this.activeFrames > sampleRate * 0.10 && currentFrame - this.lastActivity > sampleRate * 0.25) {
					this.port.postMessage({ activity: true });
					this.lastActivity = currentFrame;
				}
			}
		}
		// Leave the output silent. Connecting it to the destination keeps
		// this capture pulled on engines that suspend inaudible branches.
		return !this.stopped;
	}
}
registerProcessor('record-take-pcm', RecordTakeProcessor);
