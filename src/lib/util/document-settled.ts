/**
 * "This document has finished loading what it started."
 *
 * Used before a re-home reload issued at boot (hooks.client.ts `init` →
 * `reconcileBeforeHydration`): a reload aborts every load still in flight, and
 * engines log some of those aborts as errors — Firefox writes `downloadable
 * font: download failed … status=2152398850` (NS_BINDING_ABORTED) for a web font
 * the first layout had requested. Waiting costs almost nothing: the reload asks
 * for the same URL, so the document it is about to replace is fetching exactly
 * the chunks, styles and fonts the next one needs, and they land in the cache
 * it reads from.
 *
 * Settled = the window `load` event has fired (subresources, preloads, and the
 * fonts the first layout requested) AND no font load is pending
 * (`document.fonts.ready`). Capped, so one stalled request can't hold the
 * re-home hostage: past the cap the reload proceeds and an abort is only noise.
 */

/** The slice of `Document` this reads — structural, so tests can pass a stub. */
export interface SettlingDocument {
	readonly readyState: DocumentReadyState;
	readonly fonts?: { readonly ready: PromiseLike<unknown> };
}

/** The slice of `Window` this listens on. */
export interface LoadEventSource {
	addEventListener(type: 'load', listener: () => void, options?: { once?: boolean }): void;
}

/** Upper bound on the wait, in ms. */
export const DOCUMENT_SETTLE_CAP_MS = 5000;

const noop = (): void => {};

/**
 * Resolve once `doc` has finished loading — its `load` event, then its pending
 * web fonts — or after `capMs`, whichever comes first. Never rejects.
 *
 * @param doc - the document whose loads to wait out
 * @param win - where its `load` event fires
 * @param capMs - the longest to wait
 * @returns a promise that resolves when settled or capped
 */
export function documentSettled(
	doc: SettlingDocument,
	win: LoadEventSource,
	capMs: number = DOCUMENT_SETTLE_CAP_MS
): Promise<void> {
	const loaded =
		doc.readyState === 'complete'
			? Promise.resolve()
			: new Promise<void>((resolve) => win.addEventListener('load', () => resolve(), { once: true }));
	const settled = loaded.then(() => doc.fonts?.ready).then(noop, noop);

	let timer: ReturnType<typeof setTimeout> | undefined;
	const capped = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, capMs);
	});
	return Promise.race([settled, capped]).finally(() => clearTimeout(timer));
}
