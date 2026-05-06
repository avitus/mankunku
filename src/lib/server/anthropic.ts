import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';

/**
 * Server-only singleton for the Anthropic SDK.
 *
 * `ANTHROPIC_API_KEY` is read from the runtime environment so the value isn't
 * baked into the build. The lazy getter lets the build succeed even when no
 * key is configured — the chat endpoint surfaces the missing-key state to
 * the client with a friendly message.
 */

let client: Anthropic | null = null;
let attempted = false;

export function getAnthropicClient(): Anthropic | null {
	if (!attempted) {
		attempted = true;
		const key = env.ANTHROPIC_API_KEY;
		if (key && key.trim() && !key.startsWith('sk-ant-your')) {
			client = new Anthropic({ apiKey: key });
		} else {
			console.warn('[anthropic] ANTHROPIC_API_KEY not set — /api/chat will return 503');
		}
	}
	return client;
}

export function isAnthropicConfigured(): boolean {
	return getAnthropicClient() !== null;
}

/** Default Claude model used by the docs chat. Swap here to upgrade. */
export const ANTHROPIC_MODEL = 'claude-sonnet-4-6';

/** Cap on output tokens per chat response — keeps costs predictable. */
export const ANTHROPIC_MAX_TOKENS = 1024;
