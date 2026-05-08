/**
 * Server-only Anthropic SDK wrapper — singleton, lazy-init, with a placeholder
 * key guard so the `.env.example` placeholder can't slip into production
 * undetected.  No test currently covers the singleton or the placeholder
 * rejection; this fills both gaps.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

function setEnv(key: string | undefined): void {
	// `$env/dynamic/private` exposes a mutable `env` object; tests configure
	// it through the same vi.mock factory each time.  Resetting modules
	// between tests forces re-import so the lazy `attempted` flag resets.
	vi.doMock('$env/dynamic/private', () => ({
		env: key === undefined ? {} : { ANTHROPIC_API_KEY: key }
	}));
}

beforeEach(() => {
	vi.resetModules();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('isAnthropicConfigured / getAnthropicClient', () => {
	it('rejects an unset key — returns null + warns once', async () => {
		setEnv(undefined);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const mod = await import('$lib/server/anthropic');
		expect(mod.isAnthropicConfigured()).toBe(false);
		// Second call must not re-log — the `attempted` gate caches the negative.
		expect(mod.getAnthropicClient()).toBeNull();
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it('rejects an empty string and warns once', async () => {
		setEnv('   ');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const mod = await import('$lib/server/anthropic');
		expect(mod.isAnthropicConfigured()).toBe(false);
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it('rejects the placeholder key shipped in .env.example (sk-ant-your...)', async () => {
		// This is the load-bearing guard: if someone ships .env.example values
		// into prod, the chat endpoint must surface the missing-key state
		// rather than authenticating to nothing.
		setEnv('sk-ant-your-key-here');
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		const mod = await import('$lib/server/anthropic');
		expect(mod.isAnthropicConfigured()).toBe(false);
	});

	it('initializes the client lazily for a real-looking key', async () => {
		setEnv('sk-ant-prod-real-looking-key');
		// Stub `console.warn` to silence anything else; we expect zero warns.
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const mod = await import('$lib/server/anthropic');
		expect(mod.isAnthropicConfigured()).toBe(true);
		// The same instance is returned across calls (singleton).
		expect(mod.getAnthropicClient()).toBe(mod.getAnthropicClient());
		expect(warn).not.toHaveBeenCalled();
	});

	it('exposes the configured model identifier and token cap', async () => {
		// These constants are read by /api/chat for cost predictability — pin
		// the names so silent renames (e.g. ANTHROPIC_MODEL → MODEL) get
		// caught at test time.
		setEnv('sk-ant-prod');
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const mod = await import('$lib/server/anthropic');
		expect(typeof mod.ANTHROPIC_MODEL).toBe('string');
		expect(mod.ANTHROPIC_MODEL.length).toBeGreaterThan(0);
		expect(mod.ANTHROPIC_MAX_TOKENS).toBeGreaterThan(0);
	});
});
