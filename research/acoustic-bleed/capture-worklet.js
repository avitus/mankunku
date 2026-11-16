class PairedCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.blocks = [];
    this.frames = 0;
    this.port.onmessage = ({ data }) => {
      if (data === 'start') { this.active = true; this.start = currentFrame; }
      if (data === 'stop') {
        this.active = false;
        const channels = [0,1,2].map(c => {
          const out = new Float32Array(this.frames); let offset = 0;
          for (const block of this.blocks) { out.set(block[c], offset); offset += block[c].length; }
          return out;
        });
        this.blocks = [];
        this.port.postMessage({ channels, start: this.start, frames: this.frames, sampleRate }, channels.map(c => c.buffer));
        this.frames = 0;
      }
    };
  }
  process(inputs, outputs) {
    // Output stays silent: the mic is never monitored through the speakers.
    if (this.active) {
      const n = outputs[0][0].length;
      if (this.frames + n > sampleRate*120) { this.active = false; this.port.postMessage({ error: 'Two-minute capture limit reached' }); }
      else {
        this.blocks.push([inputs[0][0], inputs[1][0], inputs[1][1] ?? inputs[1][0]]
          .map(c => c ? c.slice() : new Float32Array(n)));
        this.frames += n;
      }
    }
    return true;
  }
}
registerProcessor('paired-research-capture', PairedCapture);
