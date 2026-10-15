import type { SampleLoader, SampleLoaderLoadOptions, SmplrPreset, Storage } from 'smplr';

/**
 * smplr 1.0's default loader selects codecs from media/UA hints and silently
 * omits decode failures. Pitched readiness needs actual decoded samples:
 * WebKit can decode these libraries' OGG files while its selected M4A fails.
 * Use the public SampleLoader contract so live and offline rendering share
 * the same capability check without changing browser globals or instruments.
 */
export function createBackingSampleLoader(context: BaseAudioContext, storage?: Storage): SampleLoader {
	const decoded = new Map<string, Promise<AudioBuffer>>();
	async function decode(rawUrl: string): Promise<AudioBuffer> {
		// smplr sample names contain literal sharps/spaces (e.g. "PP D#0").
		// Match its load-audio path normalization before cache lookup/fetch;
		// encodeURI would leave # as a fragment and double-encode existing %.
		const url = rawUrl.replace(/#/g, '%23').replace(/ /g, '%20').replace(/([^:]\/)\/+/g, '$1');
		const existing = decoded.get(url);
		if (existing) return existing;
		const pending = (async () => {
			const response = await (storage ? storage.fetch(url) : fetch(url));
			if (response.status < 200 || response.status >= 300) throw new Error(`Sample HTTP ${response.status}`);
			const buffer = await context.decodeAudioData(await response.arrayBuffer());
			if (!buffer.length || !buffer.numberOfChannels) throw new Error('Empty decoded sample');
			return buffer;
		})();
		decoded.set(url, pending);
		try { return await pending; }
		catch (error) {
			// A transient fetch/decode failure must not poison the next attempt.
			if (decoded.get(url) === pending) decoded.delete(url);
			throw error;
		}
	}

	return {
		async load(preset: SmplrPreset, options?: SampleLoaderLoadOptions | ((loaded: number, total: number) => void)) {
			const { buffers, onProgress } = typeof options === 'function' ? { onProgress: options, buffers: undefined } : options ?? {};
			const names = [...new Set(preset.groups.flatMap((group) => group.regions.map((region) => region.sample)))];
			if (!names.length) throw new Error('No playable samples declared for backing instrument');
			const result = new Map<string, AudioBuffer>();
			for (const name of names) {
				const buffer = buffers?.get(name);
				if (buffer?.length && buffer.numberOfChannels) result.set(name, buffer);
			}
			const missing = names.filter((name) => !result.has(name));
			const base = preset.samples.baseUrl.replace(/\/$/, '');
			const formats = [...new Set(preset.samples.formats)];
			const loadSample = async (name: string, candidates: readonly string[]) => {
				const path = preset.samples.map?.[name] ?? name;
				for (const format of candidates) {
					try { return { format, buffer: await decode(`${base}/${path}.${format}`) }; }
					catch { /* Try the next encoding of this same sample. */ }
				}
				throw new Error(`No playable sample for ${preset.meta?.name ?? 'backing instrument'}: ${name} (${candidates.join(', ') || 'no encodings'})`);
			};
			if (missing.length) {
				// Probe one real library sample before fetching the full bank. A
				// failed codec therefore costs one request, not every region.
				const first = await loadSample(missing[0], formats);
				result.set(missing[0], first.buffer);
				const preferred = [first.format, ...formats.filter((format) => format !== first.format)];
				onProgress?.(result.size, names.length);
				await Promise.all(missing.slice(1).map(async (name) => {
					const sample = await loadSample(name, preferred);
					result.set(name, sample.buffer);
					onProgress?.(result.size, names.length);
				}));
			} else onProgress?.(result.size, names.length);
			// Every referenced sample is required. A partial/empty map must not
			// resolve instrument readiness and leave silent notes or layers.
			return result;
		}
	};
}
