/**
 * adapter-node re-bundles Vite's server output with Rollup, and its
 * `manualChunks` forces every Vite server file to stay its own chunk. Rollup
 * then tree-shakes browser-only code out of the server bundle — the screen
 * wake lock, the IndexedDB recording store, SvelteKit's own env stub — and
 * warns once per chunk it left empty. The warning is true and unactionable
 * (2026-09-18: three lines on every build, one of them for a module the app
 * does not own), so the adapter step runs with that ONE message dropped.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Adapter, Builder } from '@sveltejs/kit';
import { withoutEmptyChunkWarnings } from '../../../scripts/quiet-empty-chunks.js';

const builder = {} as Builder;

/** An adapter whose build step emits the given console warnings. */
function adapterWarning(...messages: unknown[][]): Adapter {
	return {
		name: 'fake-adapter',
		supports: { read: () => true },
		async adapt() {
			for (const args of messages) console.warn(...args);
		}
	};
}

describe('withoutEmptyChunkWarnings', () => {
	afterEach(() => vi.restoreAllMocks());

	it('drops Rollup\'s empty-chunk warning and nothing else', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await withoutEmptyChunkWarnings(
			adapterWarning(
				['Generated an empty chunk: "chunks/env.js".'],
				['Generated an empty chunk: "chunks/wake-lock.js".'],
				['Circular dependency: a.js -> b.js -> a.js'],
				['an empty chunk was mentioned mid-sentence: Generated an empty chunk: "x".'],
				[{ message: 'Generated an empty chunk: "not-a-string".' }],
				['two', 'arguments']
			)
		).adapt(builder);
		expect(warn.mock.calls).toEqual([
			['Circular dependency: a.js -> b.js -> a.js'],
			['an empty chunk was mentioned mid-sentence: Generated an empty chunk: "x".'],
			[{ message: 'Generated an empty chunk: "not-a-string".' }],
			['two', 'arguments']
		]);
	});

	it('restores console.warn once the adapter step ends', async () => {
		const original = console.warn;
		await withoutEmptyChunkWarnings(adapterWarning()).adapt(builder);
		expect(console.warn).toBe(original);
	});

	it('restores console.warn when the adapter step throws, and rethrows', async () => {
		const original = console.warn;
		const failing: Adapter = {
			name: 'failing-adapter',
			async adapt() {
				throw new Error('rollup failed');
			}
		};
		await expect(withoutEmptyChunkWarnings(failing).adapt(builder)).rejects.toThrow('rollup failed');
		expect(console.warn).toBe(original);
	});

	it('keeps the adapter\'s identity and capabilities, and hands it the builder', async () => {
		const adapt = vi.fn(async () => {});
		const inner: Adapter = { name: '@sveltejs/adapter-node', supports: { read: () => true }, adapt };
		const wrapped = withoutEmptyChunkWarnings(inner);
		expect(wrapped.name).toBe('@sveltejs/adapter-node');
		expect(wrapped.supports).toBe(inner.supports);
		await wrapped.adapt(builder);
		expect(adapt).toHaveBeenCalledWith(builder);
	});
});

describe('svelte.config.js', () => {
	it('builds with adapter-node behind the empty-chunk filter', async () => {
		const { default: config } = await import('../../../svelte.config.js');
		const configured = config.kit?.adapter;
		expect(configured?.name).toBe('@sveltejs/adapter-node');
		// The wrapper's adapt is its own function, not adapter-node's.
		const { default: adapterNode } = await import('@sveltejs/adapter-node');
		expect(String(configured?.adapt)).not.toBe(String(adapterNode().adapt));
	});
});
