const contexts = new WeakMap<AudioContext, Map<string, Promise<void>>>();

/** Register a processor once per context. A cancelled or stalled download can be retried. */
export async function loadWorklet(
	context: AudioContext,
	url: URL,
	signal?: AbortSignal
): Promise<void> {
	signal?.throwIfAborted();
	let modules = contexts.get(context);
	if (!modules) {
		modules = new Map();
		contexts.set(context, modules);
	}
	let loading = modules.get(url.href);
	if (!loading) {
		loading = context.audioWorklet.addModule(url);
		modules.set(url.href, loading);
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	let interrupt: (() => void) | undefined;
	try {
		await Promise.race([
			loading,
			new Promise<never>((_, reject) => {
				interrupt = () => reject(signal?.reason);
				signal?.addEventListener('abort', interrupt, { once: true });
				timer = setTimeout(() => reject(new Error('Audio worklet load timed out')), 5000);
			})
		]);
	} catch (error) {
		if (modules.get(url.href) === loading) modules.delete(url.href);
		throw error;
	} finally {
		clearTimeout(timer);
		if (interrupt) signal?.removeEventListener('abort', interrupt);
	}
}
