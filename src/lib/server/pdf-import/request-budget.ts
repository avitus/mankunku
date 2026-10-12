/** A streamed response needs a whole-operation deadline, not only an HTTP header timeout. */
export async function withRecognitionDeadline<T>(
	parent: AbortSignal,
	milliseconds: number,
	work: (signal: AbortSignal) => Promise<T>
): Promise<T> {
	const controller = new AbortController();
	const cancel = () => controller.abort(parent.reason);
	if (parent.aborted) cancel();
	else parent.addEventListener('abort', cancel, { once: true });
	const timer = setTimeout(
		() => controller.abort(new Error('Recognition time budget exhausted')),
		milliseconds
	);
	try {
		return await work(controller.signal);
	} finally {
		clearTimeout(timer);
		parent.removeEventListener('abort', cancel);
	}
}
