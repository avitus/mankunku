import { describe, expect, it, vi } from 'vitest';
import { Scheduler as NativeScheduler, type NoteEvent, type Scheduler } from 'smplr';
import { getBackingNativeArming } from '$lib/audio/backing-native-arming';

function fixture() {
	let now = 1;
	const sources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; end: () => void }[] = [];
	const actual = {
		get currentTime() { expect(this).toBe(actual); return now; },
		sampleRate: 48000,
		destination: {},
		createBufferSource: vi.fn(function (this: unknown) {
			expect(this).toBe(actual);
			const source = Object.assign(new EventTarget(), { start: vi.fn(), stop: vi.fn() });
			sources.push({ start: source.start, stop: source.stop, end: () => { source.dispatchEvent(new Event('ended')); } });
			return source;
		}),
		createGain: vi.fn(function (this: unknown) { expect(this).toBe(actual); return { gain: 1 }; }),
		decodeAudioData: vi.fn(function (this: unknown, ...args: unknown[]) { expect(this).toBe(actual); return args; })
	};
	const scheduledStop = vi.fn();
	const delegate = { schedule: vi.fn(function (this: unknown) { expect(this).toBe(delegate); return scheduledStop; }),
		stop: vi.fn(function (this: unknown) { expect(this).toBe(delegate); }) };
	const factory = vi.fn(() => delegate as Scheduler);
	const context = actual as unknown as BaseAudioContext;
	return { actual, context, sources, factory, delegate, scheduledStop, setNow: (time: number) => { now = time; } };
}

describe('native backing source arming', () => {
 it('keeps ordinary cancellation when no tracked source provides completion evidence', () => {
  const f = fixture(), arming = getBackingNativeArming(f.context, f.factory);
  const ordinaryStop = vi.fn(), ended = vi.fn();
  const stop = arming.arm(() => ordinaryStop, ended);
  expect(ended).not.toHaveBeenCalled();
  stop(); expect(ordinaryStop).toHaveBeenCalledOnce();
 });

 it('releases naturally ended sources from cancellation ownership without stopping a still-active sibling', () => {
  const f = fixture(), arming = getBackingNativeArming(f.context, f.factory);
  const ordinaryStop = vi.fn(), ended = vi.fn();
  const stop = arming.arm(() => {
   arming.context.createBufferSource().start(2);
   arming.context.createBufferSource().start(2);
   return ordinaryStop;
  }, ended);
  f.sources[0].end();
  expect(ended).not.toHaveBeenCalled();
  stop();
  expect(ordinaryStop).toHaveBeenCalledOnce();
  expect(f.sources[0].stop).not.toHaveBeenCalled();
  expect(f.sources[1].stop).toHaveBeenCalledExactlyOnceWith(1);
  f.sources[1].end();
  expect(ended).toHaveBeenCalledOnce();
 });

 it('notifies only after the last native source ends and makes a completed stop handle inert', () => {
  const f = fixture(), arming = getBackingNativeArming(f.context, f.factory);
  const ordinaryStop = vi.fn(), ended = vi.fn(), instrumentEnded = vi.fn();
  const stop = arming.arm(() => {
   const source = arming.context.createBufferSource();
   source.addEventListener('ended', instrumentEnded);
   source.start(2);
   arming.context.createBufferSource().start(2);
   return ordinaryStop;
  }, ended);
  f.sources[1].end(); expect(ended).not.toHaveBeenCalled();
  f.sources[0].end(); expect(ended).toHaveBeenCalledOnce();
  expect(instrumentEnded).toHaveBeenCalledOnce();
  stop(); expect(ordinaryStop).not.toHaveBeenCalled();
  for (const source of f.sources) expect(source.stop).not.toHaveBeenCalled();
 });

	it('rejects a deadline missed between source creation and native start, rolling back earlier voices', () => {
		const f = fixture(); const arming = getBackingNativeArming(f.context, f.factory);
		expect(() => arming.arm(() => {
			arming.context.createBufferSource().start(3);
			const second = arming.context.createBufferSource();
			f.setNow(2.5);
			second.start(2);
			return () => {};
		})).toThrow(/deadline/i);
		expect(f.sources[0].start).toHaveBeenCalledExactlyOnceWith(3);
		expect(f.sources[1].start).not.toHaveBeenCalled();
		for (const source of f.sources) expect(source.stop).toHaveBeenCalledExactlyOnceWith(2.5);
	});

	it.each([undefined, NaN, Infinity, -Infinity, .5])('rejects invalid or already late owned start time %s', (when) => {
		const f = fixture(); const arming = getBackingNativeArming(f.context, f.factory);
		expect(() => arming.arm(() => { arming.context.createBufferSource().start(when); return () => {}; })).toThrow(/deadline/i);
		expect(f.sources[0].start).not.toHaveBeenCalled();
		expect(f.sources[0].stop).toHaveBeenCalledExactlyOnceWith(1);
	});

	it('preserves native start arguments at an owned valid deadline and leaves normal sources unwrapped', () => {
		const f = fixture(); const arming = getBackingNativeArming(f.context, f.factory);
		const normal = arming.context.createBufferSource();
		expect(normal.start).toBe(f.sources[0].start);
		normal.start();
		arming.arm(() => {
			arming.context.createBufferSource().start(1, .2, .4);
			return () => {};
		});
		expect(f.sources[0].start).toHaveBeenCalledExactlyOnceWith();
		expect(f.sources[1].start).toHaveBeenCalledExactlyOnceWith(1, .2, .4);
	});

	it('gives each instrument a separate real scheduler queue and stop lifecycle on one context', () => {
		vi.useFakeTimers();
		const f = fixture();
		const factory = vi.fn((context: BaseAudioContext) => NativeScheduler(context));
		const arming = getBackingNativeArming(f.context, factory);
		const first = arming.createScheduler();
		const second = arming.createScheduler();
		try {
			const oldBank = vi.fn(); const survivingBank = vi.fn();
			first.schedule({ note: 60, time: 20 }, oldBank);
			second.schedule({ note: 64, time: 20 }, survivingBank);
			first.stop();
			f.setNow(19.9); vi.advanceTimersByTime(50);
			expect(oldBank).not.toHaveBeenCalled();
			expect(survivingBank).toHaveBeenCalledOnce();
			expect(factory).toHaveBeenCalledTimes(2);
		} finally { first.stop(); second.stop(); vi.useRealTimers(); }
	});

	it('leaves a real smplr queued event intact while an armed event bypasses its JS timer', () => {
		vi.useFakeTimers();
		const f = fixture();
		const arming = getBackingNativeArming(f.context, (context) => NativeScheduler(context));
		const scheduler = arming.createScheduler();
		try {
			const queued = vi.fn();
			const armed = vi.fn();
			scheduler.schedule({ note: 60, time: 30 }, queued);
			const stop = arming.arm(() => {
				scheduler.schedule({ note: 64, time: 40 }, (event) => {
					if (typeof event !== 'object') throw new Error('Expected an event object');
					armed(event);
					arming.context.createBufferSource().start(event.time);
				});
				return () => {};
			});
			expect(armed).toHaveBeenCalledExactlyOnceWith({ note: 64, time: 40 });
			expect(queued).not.toHaveBeenCalled();
			stop();
			expect(f.sources[0].stop).toHaveBeenCalledExactlyOnceWith(1);
			f.setNow(29.9);
			vi.advanceTimersByTime(50);
			expect(queued).toHaveBeenCalledExactlyOnceWith({ note: 60, time: 30 });
			expect(armed).toHaveBeenCalledOnce();
		} finally {
			scheduler.stop();
			vi.useRealTimers();
		}
	});

	it('caches by actual context and forwards native getters and bound methods without modifying it', () => {
		const f = fixture();
		const descriptors = Object.getOwnPropertyDescriptors(f.actual);
		const arming = getBackingNativeArming(f.context, f.factory);
		arming.createScheduler();
		expect(getBackingNativeArming(f.context, vi.fn())).toBe(arming);
		expect(f.factory).toHaveBeenCalledExactlyOnceWith(f.context);
		expect(arming.context).not.toBe(f.context);
		expect(arming.context.currentTime).toBe(1);
		f.setNow(2);
		expect(arming.context.currentTime).toBe(2);
		expect(arming.context.destination).toBe(f.actual.destination);
		expect(arming.context.sampleRate).toBe(48000);
		const gain = arming.context.createGain;
		expect(gain).toBe(arming.context.createGain);
		expect(gain()).toEqual({ gain: 1 });
		const bytes = new ArrayBuffer(2);
		arming.context.decodeAudioData(bytes);
		expect(f.actual.decodeAudioData).toHaveBeenCalledExactlyOnceWith(bytes);
		expect(Object.getOwnPropertyDescriptors(f.actual)).toEqual(descriptors);
	});

	it('preserves the delegated scheduler and unarmed source cancellation paths', () => {
		const f = fixture(); const arming = getBackingNativeArming(f.context, f.factory);
		const scheduler = arming.createScheduler();
		const event = { note: 60, time: 30 } satisfies NoteEvent;
		const callback = vi.fn();
		expect(scheduler.schedule(event, callback)).toBe(f.scheduledStop);
		expect(f.delegate.schedule).toHaveBeenCalledExactlyOnceWith(event, callback);
		expect(callback).not.toHaveBeenCalled();
		arming.context.createBufferSource();
		arming.arm(() => () => {})();
		expect(f.sources[0].stop).not.toHaveBeenCalled();
		scheduler.stop();
		expect(f.delegate.stop).toHaveBeenCalledOnce();
	});

	it('arms future native sources synchronously and cancels their scheduled duration at the current clock', () => {
		const f = fixture(); const arming = getBackingNativeArming(f.context, f.factory);
		const scheduler = arming.createScheduler();
		const originalStop = vi.fn();
		const event = { note: 60, time: 30 } satisfies NoteEvent;
		const stop = arming.arm(() => {
			const remove = scheduler.schedule(event, (received) => {
				if (typeof received !== 'object') throw new Error('Expected an event object');
				expect(received).toBe(event);
				for (let voice = 0; voice < 2; voice++) {
					const source = arming.context.createBufferSource();
					source.start(received.time);
					source.stop(32);
				}
			});
			remove(); // The event has already dispatched; queue removal cannot cancel voices.
			return originalStop; // Models smplr's already-stopping duration voice.
		});
		expect(f.delegate.schedule).not.toHaveBeenCalled();
		expect(f.sources).toHaveLength(2);
		for (const source of f.sources) expect(source.start).toHaveBeenCalledExactlyOnceWith(30);
		f.setNow(3);
		stop(); stop();
		expect(originalStop).toHaveBeenCalledOnce();
		for (const source of f.sources) expect(source.stop.mock.calls).toEqual([[32], [3]]);
	});

	it('stops every partially armed source on failure, preserves the initiating error, and restores normal scheduling', () => {
		const f = fixture(); const arming = getBackingNativeArming(f.context, f.factory);
		const scheduler = arming.createScheduler();
		const failure = new Error('second voice failed');
		expect(() => arming.arm(() => {
			arming.context.createBufferSource().start(30);
			arming.context.createBufferSource().start(30);
			f.sources[0].stop.mockImplementation(() => { throw new Error('already ended'); });
			throw failure;
		})).toThrow(failure);
		expect(f.sources[1].stop).toHaveBeenCalledExactlyOnceWith(1);
		const callback = vi.fn();
		scheduler.schedule({ note: 60, time: 40 }, callback);
		expect(f.delegate.schedule).toHaveBeenCalledOnce();
		expect(callback).not.toHaveBeenCalled();
		arming.arm(() => () => {})();
	});

	it('still cancels native sources if the original stop throws and never runs cleanup twice', () => {
		const f = fixture(); const arming = getBackingNativeArming(f.context, f.factory);
		arming.createScheduler();
		const failure = new Error('voice stop failed');
		const originalStop = vi.fn(() => { throw failure; });
		const stop = arming.arm(() => { arming.context.createBufferSource().start(20); return originalStop; });
		expect(stop).toThrow(failure);
		expect(f.sources[0].stop).toHaveBeenCalledExactlyOnceWith(1);
		expect(stop).not.toThrow();
		expect(originalStop).toHaveBeenCalledOnce();
	});

	it('rejects reentrant same-context scopes without transferring source ownership', () => {
		const f = fixture(); const arming = getBackingNativeArming(f.context, f.factory);
		arming.createScheduler();
		const nestedStart = vi.fn(() => () => {});
		const stop = arming.arm(() => {
			arming.context.createBufferSource().start(20);
			expect(() => arming.arm(nestedStart)).toThrow(/reentrant/i);
			arming.context.createBufferSource().start(22);
			return () => {};
		});
		expect(nestedStart).not.toHaveBeenCalled();
		stop();
		for (const source of f.sources) expect(source.stop).toHaveBeenCalledExactlyOnceWith(1);
	});

	it('isolates sequential arms and different contexts, including an independent nested context', () => {
		const f = fixture(); const other = fixture();
		const a = getBackingNativeArming(f.context, f.factory);
		const b = getBackingNativeArming(other.context, other.factory);
		let otherStop = () => {};
		const first = a.arm(() => {
			a.context.createBufferSource().start(20);
			otherStop = b.arm(() => { b.context.createBufferSource().start(25); return () => {}; });
			return () => {};
		});
		const second = a.arm(() => { a.context.createBufferSource().start(22); return () => {}; });
		first();
		expect(f.sources[0].stop).toHaveBeenCalledOnce();
		expect(f.sources[1].stop).not.toHaveBeenCalled();
		expect(other.sources[0].stop).not.toHaveBeenCalled();
		second(); otherStop();
		expect(f.sources[1].stop).toHaveBeenCalledOnce();
		expect(other.sources[0].stop).toHaveBeenCalledOnce();
	});

	it('rejects a non-synchronous cancellation result and rolls back its sources', () => {
		const f = fixture(); const arming = getBackingNativeArming(f.context, f.factory);
		arming.createScheduler();
		const invalidStart = () => { arming.context.createBufferSource().start(20); return undefined; };
		expect(() => arming.arm(invalidStart as unknown as () => () => void)).toThrow(/synchronous/i);
		expect(f.sources[0].stop).toHaveBeenCalledExactlyOnceWith(1);
	});
});
