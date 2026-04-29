<script lang="ts">
	import { onMount } from 'svelte';
	import { renderMarkdown } from '$lib/docs/markdown';

	interface ChatMessage {
		role: 'user' | 'assistant';
		content: string;
	}

	interface Props {
		/** Slug of the doc page being viewed — sent with each request. */
		pageSlug?: string;
	}

	let { pageSlug }: Props = $props();

	let messages = $state<ChatMessage[]>([]);
	let input = $state('');
	let isStreaming = $state(false);
	let configChecked = $state(false);
	let configured = $state(false);
	let configError = $state('');
	let scrollEl: HTMLDivElement | undefined = $state();

	const SUGGESTIONS = [
		'How does the scoring system work?',
		'What is adaptive difficulty?',
		'How do I practice licks in all 12 keys?',
		"What does 'tagged' mean?"
	];

	onMount(async () => {
		try {
			const res = await fetch('/api/chat');
			if (res.ok) {
				const data = await res.json();
				configured = !!data.configured;
				if (!configured) {
					configError =
						'AI assistant unavailable. Set ANTHROPIC_API_KEY in the server environment to enable.';
				}
			} else {
				configError = `Could not reach assistant (HTTP ${res.status}).`;
			}
		} catch (err) {
			configError = 'Could not reach assistant — check your network.';
		} finally {
			configChecked = true;
		}
	});

	function scrollToBottom() {
		requestAnimationFrame(() => {
			if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
		});
	}

	async function sendMessage(text?: string) {
		const message = (text ?? input).trim();
		if (!message || isStreaming) return;

		input = '';
		messages.push({ role: 'user', content: message });
		messages.push({ role: 'assistant', content: '' });
		const assistantIdx = messages.length - 1;
		isStreaming = true;
		scrollToBottom();

		try {
			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					message,
					history: messages.slice(0, -2),
					pageSlug
				})
			});

			if (!res.ok || !res.body) {
				const errText = await res.text().catch(() => '');
				messages[assistantIdx].content = errText || `Request failed (${res.status}).`;
				isStreaming = false;
				return;
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let nl = buffer.indexOf('\n\n');
				while (nl !== -1) {
					const chunk = buffer.slice(0, nl);
					buffer = buffer.slice(nl + 2);
					const dataLine = chunk
						.split('\n')
						.find((l) => l.startsWith('data: '));
					if (dataLine) {
						try {
							const event = JSON.parse(dataLine.slice('data: '.length));
							if (event.type === 'delta' && typeof event.text === 'string') {
								messages[assistantIdx].content += event.text;
								scrollToBottom();
							} else if (event.type === 'error') {
								messages[assistantIdx].content +=
									(messages[assistantIdx].content ? '\n\n' : '') +
									`_Error: ${event.message}_`;
							}
						} catch {
							/* ignore malformed event */
						}
					}
					nl = buffer.indexOf('\n\n');
				}
			}
		} catch (err) {
			console.warn('[chat] request failed:', err);
			messages[assistantIdx].content = 'Connection lost. Please try again.';
		} finally {
			isStreaming = false;
			scrollToBottom();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			sendMessage();
		}
	}

	function clear() {
		messages = [];
	}
</script>

<div class="chat-root">
	<header class="chat-header">
		<div>
			<div class="smallcaps text-[var(--color-brass)]">Ask AI</div>
			<div class="font-display text-base font-semibold">Mankunku Assistant</div>
		</div>
		{#if messages.length > 0}
			<button type="button" onclick={clear} class="chat-clear" aria-label="Clear conversation">
				Clear
			</button>
		{/if}
	</header>

	<div bind:this={scrollEl} class="chat-scroll">
		{#if messages.length === 0}
			<div class="chat-empty">
				<p class="text-sm text-[var(--color-text-secondary)]">
					Ask me anything about how to use Mankunku — practice flow, scoring, lick library, settings.
				</p>
				<div class="mt-3 flex flex-col gap-1.5">
					{#each SUGGESTIONS as suggestion}
						<button
							type="button"
							onclick={() => sendMessage(suggestion)}
							disabled={!configured}
							class="suggestion-btn"
						>
							{suggestion}
						</button>
					{/each}
				</div>
				{#if configChecked && !configured}
					<p class="mt-3 text-xs italic text-[var(--color-text-secondary)]">
						{configError}
					</p>
				{/if}
			</div>
		{/if}

		{#each messages as msg, i (i)}
			<div class="chat-msg chat-msg-{msg.role}">
				<div class="chat-bubble">
					{#if msg.role === 'assistant' && msg.content}
						{@html renderMarkdown(msg.content).html}
					{:else if msg.role === 'assistant' && isStreaming && i === messages.length - 1}
						<span class="typing">
							<span></span><span></span><span></span>
						</span>
					{:else}
						{msg.content}
					{/if}
				</div>
			</div>
		{/each}
	</div>

	<div class="chat-input-wrap">
		<textarea
			bind:value={input}
			onkeydown={handleKeydown}
			disabled={isStreaming || !configured}
			placeholder={configured ? 'Ask the assistant…' : 'Assistant unavailable'}
			rows="1"
			class="chat-input"
		></textarea>
		<button
			type="button"
			onclick={() => sendMessage()}
			disabled={isStreaming || !configured || !input.trim()}
			class="chat-send"
		>
			{isStreaming ? '…' : 'Send'}
		</button>
	</div>
</div>

<style>
	.chat-root {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: var(--color-bg-secondary);
	}

	.chat-header {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.875rem 1rem;
		border-bottom: 1px solid var(--color-bg-tertiary);
	}

	.chat-clear {
		font-size: 0.7rem;
		color: var(--color-text-secondary);
		background: transparent;
		border: 1px solid var(--color-bg-tertiary);
		border-radius: 0.25rem;
		padding: 0.2rem 0.5rem;
		cursor: pointer;
		transition: color 120ms ease-out, border-color 120ms ease-out;
	}
	.chat-clear:hover {
		color: var(--color-text);
		border-color: var(--color-text-secondary);
	}

	.chat-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.chat-empty {
		padding: 0.5rem 0;
	}

	.suggestion-btn {
		text-align: left;
		font-size: 0.8rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-bg-tertiary);
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: background-color 120ms ease-out, color 120ms ease-out, border-color 120ms ease-out;
	}
	.suggestion-btn:hover:not(:disabled) {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
		border-color: var(--color-brass);
	}
	.suggestion-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.chat-msg {
		display: flex;
		font-size: 0.85rem;
	}
	.chat-msg-user {
		justify-content: flex-end;
	}

	.chat-bubble {
		max-width: 85%;
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		line-height: 1.5;
		word-break: break-word;
	}

	.chat-msg-user .chat-bubble {
		background: var(--color-accent);
		color: white;
		border-bottom-right-radius: 0.125rem;
	}

	.chat-msg-assistant .chat-bubble {
		background: var(--color-bg);
		color: var(--color-text);
		border: 1px solid var(--color-bg-tertiary);
		border-left: 2px solid var(--color-brass);
		border-bottom-left-radius: 0.125rem;
	}

	/* Style the rendered markdown inside the assistant bubble */
	.chat-msg-assistant .chat-bubble :global(p) {
		margin: 0;
	}
	.chat-msg-assistant .chat-bubble :global(p + p) {
		margin-top: 0.5rem;
	}
	.chat-msg-assistant .chat-bubble :global(ul),
	.chat-msg-assistant .chat-bubble :global(ol) {
		padding-left: 1.25rem;
		margin: 0.25rem 0;
	}
	.chat-msg-assistant .chat-bubble :global(.docs-link) {
		color: var(--color-brass-soft);
		border-bottom: 1px solid color-mix(in srgb, var(--color-brass) 40%, transparent);
		text-decoration: none;
	}
	.chat-msg-assistant .chat-bubble :global(.docs-link:hover) {
		border-bottom-color: var(--color-brass);
	}
	.chat-msg-assistant .chat-bubble :global(.docs-codespan) {
		background: var(--color-bg-tertiary);
		color: var(--color-brass-soft);
		padding: 0.05rem 0.3rem;
		border-radius: 0.2rem;
		font-size: 0.85em;
	}

	.typing {
		display: inline-flex;
		gap: 3px;
		align-items: center;
	}
	.typing span {
		display: block;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--color-text-secondary);
		opacity: 0.6;
		animation: typing-bounce 1.2s ease-in-out infinite;
	}
	.typing span:nth-child(2) {
		animation-delay: 0.15s;
	}
	.typing span:nth-child(3) {
		animation-delay: 0.3s;
	}
	@keyframes typing-bounce {
		0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
		30% { transform: translateY(-4px); opacity: 1; }
	}

	.chat-input-wrap {
		flex-shrink: 0;
		display: flex;
		gap: 0.5rem;
		padding: 0.75rem;
		border-top: 1px solid var(--color-bg-tertiary);
	}

	.chat-input {
		flex: 1;
		min-height: 2.25rem;
		max-height: 8rem;
		padding: 0.5rem 0.75rem;
		font-size: 0.85rem;
		font-family: inherit;
		background: var(--color-bg);
		color: var(--color-text);
		border: 1px solid var(--color-bg-tertiary);
		border-radius: 0.375rem;
		resize: vertical;
	}
	.chat-input:focus {
		outline: none;
		border-color: var(--color-brass);
	}
	.chat-input:disabled {
		opacity: 0.5;
	}

	.chat-send {
		padding: 0 0.875rem;
		font-size: 0.8rem;
		font-weight: 600;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
		transition: opacity 120ms ease-out;
	}
	.chat-send:hover:not(:disabled) {
		opacity: 0.9;
	}
	.chat-send:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
