/**
 * Decode a complete sample layer or reject so playback can use its SoundFont
 * fallback. smplr's own URL loader silently accepts missing samples.
 */
export const loadSampleLayer = (urls: Record<string, string>) => async (
	context: BaseAudioContext,
	buffers: Record<string | number, AudioBuffer | undefined>
): Promise<void> => {
	const decoded = await Promise.all(Object.entries(urls).map(async ([note, url]) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const load = (async () => {
			const response = await fetch(url);
			if (!response.ok) throw new Error(`Could not load instrument sample ${url}: ${response.status}`);
			return context.decodeAudioData(await response.arrayBuffer());
		})();
		// Stop waiting without aborting: WebKit reports aborted requests
		// as console errors. A late result must never replace the fallback.
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error(`Timed out loading instrument sample ${url}`)), 15_000);
		});
		try {
			return [note, await Promise.race([load, timeout])] as const;
		} finally {
			clearTimeout(timer);
		}
	}));
	// Preserve the map's ascending pitch order, never download completion order.
	// smplr sorts pitch ranges but pairs them with source entries by index.
	// Publishing only after every decode also keeps failed layers unpublished.
	for (const [note, buffer] of decoded) buffers[note] = buffer;
};
