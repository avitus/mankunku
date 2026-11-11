import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

interface Message { samples?: Float32Array; start?: number }
interface Processor {
	port: { onmessage: (event: { data: { type: string; start?: number; frames?: number } }) => void };
	process: (inputs: Float32Array[][]) => boolean;
}
function openProcessor() {
	const messages: Message[] = [];
	let ctor!: new () => Processor;
	const scope = {
		currentFrame: 100, sampleRate: 44100,
		registerProcessor: (_: string, processor: typeof ctor) => { ctor = processor; },
		AudioWorkletProcessor: class { port = { postMessage: (m: Message) => messages.push(m) }; }
	};
	runInNewContext(readFileSync(new URL('../../../src/lib/audio/record-take-worklet.js', import.meta.url), 'utf8'), scope);
	return { scope, processor: new ctor(), messages };
}

it('captures exactly the scheduled samples across block edges and stops at its cap', () => {
	const { scope, processor, messages } = openProcessor();
	processor.port.onmessage({ data: { type: 'arm', start: 102, frames: 4 } });
	expect(processor.process([[Float32Array.of(0, 1, 2, 3)]])).toBe(true);
	scope.currentFrame += 4;
	processor.process([[Float32Array.of(4, 5, 6, 7)]]);
	processor.port.onmessage({ data: { type: 'finish' } });
	expect(messages[0].start).toBe(102);
	expect([...messages[0].samples!]).toEqual([2, 3, 4, 5]);
	expect(processor.process([])).toBe(false);
});

it('stops collecting on cancellation during count-in', () => {
	const { processor, messages } = openProcessor();
	processor.port.onmessage({ data: { type: 'arm', start: 5000, frames: 400 } });
	processor.port.onmessage({ data: { type: 'dispose' } });
	expect(processor.process([])).toBe(false);
	expect(messages).toEqual([]);
});
