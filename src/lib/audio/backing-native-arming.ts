/** Synchronous native scheduling for a renderer-owned, cancellable backing hit. */
import type { Scheduler } from 'smplr';

export interface BackingNativeArming {
	/** Instrument-only facade; native methods and getters use the actual context. */
	readonly context: BaseAudioContext;
	/** Each instrument owns its queue so disconnect cannot clear another bank. */
	createScheduler(): Scheduler;
	/** start must synchronously create its sources and return its normal stop function. */
	arm(start: () => () => void): () => void;
}

const armingByContext = new WeakMap<BaseAudioContext, BackingNativeArming>();

/**
 * Share one facade and arming scope per actual context without changing it.
 * Outside arm(), the public smplr scheduler retains its normal queue semantics.
 * Inside arm(), dispatch immediately: the instrument still passes the original
 * future note time to native source.start(), so Web Audio owns that deadline.
 *
 * A duration-bearing smplr voice can already consider itself stopping and ignore
 * a later ordinary stop. Keeping the synchronously created native sources lets
 * cancellation supersede that future stop through the public source.stop API.
 * This scope intentionally rejects reentrancy; it cannot safely own sources
 * created asynchronously after start returns.
 */
export function getBackingNativeArming(
	context: BaseAudioContext,
	createScheduler: (context: BaseAudioContext) => Scheduler
): BackingNativeArming {
	const existing = armingByContext.get(context);
	if (existing) return existing;
	let activeSources: AudioBufferSourceNode[] | null = null;
	const createBufferSource = () => {
		const source = context.createBufferSource();
		if (activeSources) {
			activeSources.push(source);
			const nativeStart = source.start.bind(source);
			// Allocation and instrument setup can consume the remaining lead time.
			// Check at the actual native start boundary, not only before the batch;
			// a stale time must fail closed instead of becoming an immediate burst.
			Object.defineProperty(source, 'start', { configurable: true, writable: true,
				value: (...args: Parameters<AudioBufferSourceNode['start']>) => {
					const when = args[0];
					const now = context.currentTime;
					if (typeof when !== 'number' || !Number.isFinite(when) || !Number.isFinite(now) || when < now) {
						throw new Error('Backing native source missed its audio deadline');
					}
					return nativeStart(...args);
				}
			});
		}
		return source;
	};
	const boundMethods = new Map<Function, Function>();
	const facade = new Proxy(context, {
		get(target, property) {
			if (property === 'createBufferSource') return createBufferSource;
			// Browser Web IDL getters and methods reject a Proxy as their receiver.
			const value = Reflect.get(target, property, target);
			if (typeof value !== 'function') return value;
			let bound = boundMethods.get(value);
			if (!bound) { bound = value.bind(target); boundMethods.set(value, bound!); }
			return bound;
		}
	});
	function instrumentScheduler(): Scheduler {
		const delegate = createScheduler(context);
		return {
			schedule(event, callback) {
				if (!activeSources) return delegate.schedule(event, callback);
				callback(event);
				return () => {}; // Dispatch has happened; arm owns native cancellation.
			},
			stop() { delegate.stop(); }
		};
	}
	function stopSources(sources: AudioBufferSourceNode[]): void {
		for (const source of sources) {
			try { source.stop(context.currentTime); }
			catch { /* An ended or never-started source must not strand other voices. */ }
		}
	}
	const result: BackingNativeArming = Object.freeze({ context: facade, createScheduler: instrumentScheduler,
		arm(start: () => () => void): () => void {
			if (activeSources) throw new Error('Reentrant backing native arming is not supported');
			const sources: AudioBufferSourceNode[] = [];
			activeSources = sources;
			let stop: () => void;
			try {
				stop = start();
				if (typeof stop !== 'function') throw new TypeError('Backing native arming requires a synchronous stop function');
			} catch (error) {
				stopSources(sources);
				throw error;
			} finally { activeSources = null; }
			let stopped = false;
			return () => {
				if (stopped) return;
				stopped = true;
				try { stop(); }
				finally { stopSources(sources); }
			};
		}
	});
	armingByContext.set(context, result);
	return result;
}
