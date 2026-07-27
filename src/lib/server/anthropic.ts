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
export const ANTHROPIC_MODEL = 'claude-opus-4-8';

/**
 * Model for tune PDF extraction. Music transcription is the hardest
 * vision task in the app — staff-position reading drove the melody error
 * rate on Opus 4.8 — so this rides the most capable tier independently of
 * the (cost-sensitive, high-volume) docs chat above.
 */
export const ANTHROPIC_TUNE_MODEL = 'claude-fable-5';

/** Cap on output tokens per chat response — keeps costs predictable. */
export const ANTHROPIC_MAX_TOKENS = 1024;

/**
 * Cap on output tokens for the tune PDF extraction. Bar-wise transcription
 * is verbose — ~40 bars × chords + melody tuples can exceed 8k output
 * tokens, and a truncated response means a JSON parse failure — so the
 * ceiling is high; it only bounds a runaway response.
 */
export const ANTHROPIC_TUNE_MAX_TOKENS = 32768;
