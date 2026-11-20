// @ts-nocheck — loaded directly by AudioWorkletGlobalScope.
class RoomCalibrationCapture extends AudioWorkletProcessor {
	constructor({ processorOptions: { start, frames } }) {
		super();
		this.start = start;
		this.frames = frames;
		this.channels = Array.from({ length: 3 }, () => new Float32Array(frames));
	}
	process(inputs, outputs) {
		if (!this.channels) return false;
		const n = outputs[0][0].length;
		const from = Math.max(0, this.start - currentFrame);
		const to = Math.min(n, this.start + this.frames - currentFrame);
		if (to > from) {
			const sources = [inputs[0][0], inputs[1][0], inputs[1][1]];
			for (let i = 0; i < 3; i++) {
				if (sources[i])
					this.channels[i].set(sources[i].subarray(from, to), currentFrame + from - this.start);
			}
		}
		if (currentFrame + n < this.start + this.frames) return true;
		this.port.postMessage(
			this.channels,
			this.channels.map((x) => x.buffer)
		);
		this.channels = null;
		return false;
	}
}
registerProcessor('room-calibration-capture', RoomCalibrationCapture);
