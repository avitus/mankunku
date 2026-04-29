import { error, json, type RequestHandler } from '@sveltejs/kit';
import {
	getAnthropicClient,
	isAnthropicConfigured,
	ANTHROPIC_MODEL,
	ANTHROPIC_MAX_TOKENS
} from '$lib/server/anthropic';
import { getDocContext, getPageContext } from '$lib/docs/context';

interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

interface ChatRequestBody {
	message: string;
	history?: ChatMessage[];
	/** Slug of the doc the user is viewing — used to focus answers. */
	pageSlug?: string;
}

const SYSTEM_PROMPT = `You are the Mankunku docs assistant — a friendly, concise guide for users learning the Mankunku jazz ear-training app.

Mankunku is a SvelteKit PWA that plays a jazz phrase, listens via the user's mic as they play it back on their instrument, and scores pitch and rhythm accuracy in real time. It supports adaptive difficulty across 12 keys and a "Side B" lick-practice mode that rotates user-tagged licks through chord progressions.

Tone:
- Direct and practical. Short answers preferred over essays.
- Speak like a knowledgeable jazz musician (Coltrane references welcome) — not a corporate help bot.
- Cite docs by URL when answering, e.g. "/docs/user-guide#practice" or "/docs/architecture/scoring-algorithm".
- If the user asks something the docs don't cover, say so — don't fabricate.
- For bug reports or troubleshooting, point users to the docs' troubleshooting section if relevant; otherwise suggest they reach out to the maintainers.

Format:
- Use markdown lightly (bold, lists, code spans for identifiers).
- Avoid headings inside replies — single-paragraph answers are great.
- When pointing to a doc, format links as [page title](/docs/...).

Refuse:
- Topics unrelated to Mankunku, jazz practice, ear training, or the app's features.
- Generating long-form code or writing major features (the app already exists — users can read it).
- Anything that would require the user's API keys, credentials, or personal data.`;

// In-memory rate limit. Resets on server restart. Production-grade would use
// Redis/Upstash; this keeps deployment simple and is enough for the docs
// assistant's volume. Maps `keyForRequest` → array of request timestamps.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const rateLimitBuckets = new Map<string, number[]>();

// Cap carried-over chat history before passing it to Anthropic. Without this,
// every turn balloons the prompt size — eventually hitting context limits and
// turning a cheap interaction into an expensive one.
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 12_000;

function rateLimitKey(request: Request, getClientAddress: () => string): string {
	const sessionCookie = request.headers.get('cookie')?.match(/sb-[^=]+-auth-token=([^;]+)/)?.[1];
	if (sessionCookie) return `s:${sessionCookie.slice(0, 32)}`;
	try {
		return `ip:${getClientAddress()}`;
	} catch {
		return 'ip:unknown';
	}
}

function isRateLimited(key: string): boolean {
	const now = Date.now();
	const bucket = rateLimitBuckets.get(key) ?? [];
	const recent = bucket.filter((ts) => ts > now - RATE_LIMIT_WINDOW_MS);
	if (recent.length >= RATE_LIMIT_MAX) {
		rateLimitBuckets.set(key, recent);
		return true;
	}
	recent.push(now);
	rateLimitBuckets.set(key, recent);
	return false;
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	if (!isAnthropicConfigured()) {
		throw error(503, 'AI assistant is not configured. Set ANTHROPIC_API_KEY in the environment.');
	}

	const limitKey = rateLimitKey(request, getClientAddress);
	if (isRateLimited(limitKey)) {
		throw error(429, 'Too many requests. Take a breath, then try again in a minute.');
	}

	let body: ChatRequestBody;
	try {
		body = (await request.json()) as ChatRequestBody;
	} catch {
		throw error(400, 'Invalid JSON body.');
	}

	if (!body.message || typeof body.message !== 'string') {
		throw error(400, '`message` is required.');
	}
	if (body.message.length > 4000) {
		throw error(400, 'Message too long — keep it under 4000 characters.');
	}

	const history = (body.history ?? [])
		.filter(
			(m): m is ChatMessage =>
				m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
		)
		.slice(-MAX_HISTORY_MESSAGES);

	let totalHistoryChars = 0;
	const trimmedHistory: ChatMessage[] = [];
	for (const msg of [...history].reverse()) {
		totalHistoryChars += msg.content.length;
		if (totalHistoryChars > MAX_HISTORY_CHARS) break;
		trimmedHistory.push(msg);
	}
	trimmedHistory.reverse();

	const [docContext, pageContext] = await Promise.all([
		getDocContext(),
		getPageContext(body.pageSlug)
	]);

	const systemBlocks = [
		{ type: 'text' as const, text: SYSTEM_PROMPT },
		{
			type: 'text' as const,
			text: `<documentation>\n${docContext}\n</documentation>`,
			cache_control: { type: 'ephemeral' as const }
		}
	];

	const messages = [
		...trimmedHistory.map((m) => ({ role: m.role, content: m.content })),
		{
			role: 'user' as const,
			content: pageContext
				? `<page-context>\n${pageContext}\n</page-context>\n\n${body.message}`
				: body.message
		}
	];

	const client = getAnthropicClient();
	if (!client) {
		throw error(503, 'AI assistant is not configured.');
	}

	const encoder = new TextEncoder();
	// Hold the upstream Anthropic stream out here so the ReadableStream's
	// cancel callback can abort it when the client disconnects (closed tab,
	// navigation). Without this we keep consuming tokens long after the user
	// has gone.
	let upstream: ReturnType<typeof client.messages.stream> | null = null;
	const stream = new ReadableStream({
		async start(controller) {
			try {
				upstream = client.messages.stream({
					model: ANTHROPIC_MODEL,
					max_tokens: ANTHROPIC_MAX_TOKENS,
					system: systemBlocks,
					messages
				});

				for await (const event of upstream) {
					if (
						event.type === 'content_block_delta' &&
						event.delta.type === 'text_delta'
					) {
						const payload = JSON.stringify({ type: 'delta', text: event.delta.text });
						controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
					}
				}
				controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
			} catch (err) {
				console.error('[chat] stream error:', err);
				const message =
					err instanceof Error ? err.message : 'Unknown error generating response.';
				const payload = JSON.stringify({ type: 'error', message });
				controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
			} finally {
				controller.close();
			}
		},
		cancel() {
			upstream?.abort();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			'connection': 'keep-alive'
		}
	});
};

export const GET: RequestHandler = async () => {
	return json({
		configured: isAnthropicConfigured(),
		model: isAnthropicConfigured() ? ANTHROPIC_MODEL : null
	});
};
