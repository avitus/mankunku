<script lang="ts">
	import { INSTRUMENTS } from '$lib/types/instruments.ts';
	import { settings, saveSettings } from '$lib/state/settings.svelte.ts';
	import { checkMicPermission, startMicCapture, stopMicCapture } from '$lib/audio/capture.ts';

	let step = $state<'instrument' | 'mic' | 'ready'>('instrument');
	let micStatus = $state<'idle' | 'requesting' | 'granted' | 'denied'>('idle');

	const instruments = Object.entries(INSTRUMENTS);

	function selectInstrument(id: string) {
		settings.instrumentId = id;
		saveSettings();
		step = 'mic';
	}

	async function requestMic() {
		micStatus = 'requesting';
		try {
			await startMicCapture();
			stopMicCapture();
			micStatus = 'granted';
			step = 'ready';
		} catch {
			micStatus = 'denied';
		}
	}

	function skipMic() {
		step = 'ready';
	}

	function finish() {
		settings.onboardingComplete = true;
		saveSettings();
	}
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-bg)] p-4">
	<div class="w-full max-w-md space-y-6">
		<!-- Progress dots -->
		<div class="flex justify-center gap-2">
			{#each ['instrument', 'mic', 'ready'] as s}
				<div
					class="h-2 w-2 rounded-full transition-colors {s === step
						? 'bg-[var(--color-accent)]'
						: 'bg-[var(--color-bg-tertiary)]'}"
				></div>
			{/each}
		</div>

		{#if step === 'instrument'}
			<div class="space-y-4 text-center">
				<h1 class="text-3xl font-bold">Welcome to Mankunku</h1>
				<p class="text-[var(--color-text-secondary)]">
					Jazz ear training — call and response. Pick your instrument to get started.
				</p>
			</div>

			<div class="space-y-2">
				{#each instruments as [id, config]}
					<button
						onclick={() => selectInstrument(id)}
						class="w-full rounded-lg bg-[var(--color-bg-secondary)] p-4 text-left transition-colors hover:bg-[var(--color-bg-tertiary)]"
					>
						<p class="text-lg font-medium">{config.name}</p>
						<p class="text-xs text-[var(--color-text-secondary)]">
							{config.key} transposition
						</p>
					</button>
				{/each}
			</div>

		{:else if step === 'mic'}
			<div class="space-y-4 text-center">
				<h1 class="text-2xl font-bold">Microphone Access</h1>
				<p class="text-[var(--color-text-secondary)]">
					Mankunku listens to you play and scores your pitch and rhythm. Grant mic access to enable scoring.
				</p>
			</div>

			<div class="space-y-3">
				{#if micStatus === 'idle' || micStatus === 'requesting'}
					<button
						onclick={requestMic}
						disabled={micStatus === 'requesting'}
						class="w-full rounded-lg bg-[var(--color-accent)] p-4 font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
					>
						{micStatus === 'requesting' ? 'Requesting...' : 'Allow Microphone'}
					</button>
				{:else if micStatus === 'denied'}
					<div class="rounded-lg bg-[var(--color-error)]/10 p-4 text-center text-sm">
						<p class="font-medium text-[var(--color-error)]">Microphone access denied</p>
						<p class="mt-1 text-[var(--color-text-secondary)]">
							You can enable it later in your browser settings.
						</p>
					</div>
				{:else if micStatus === 'granted'}
					<div class="rounded-lg bg-[var(--color-success)]/10 p-4 text-center text-sm">
						<p class="font-medium text-[var(--color-success)]">Microphone access granted</p>
					</div>
				{/if}

				<button
					onclick={micStatus === 'granted' || micStatus === 'denied' ? () => { step = 'ready'; } : skipMic}
					class="w-full rounded-lg bg-[var(--color-bg-secondary)] p-3 text-sm transition-colors hover:bg-[var(--color-bg-tertiary)]"
				>
					{micStatus === 'granted' || micStatus === 'denied' ? 'Continue' : 'Skip for now'}
				</button>
			</div>

		{:else if step === 'ready'}
			<div class="space-y-4 text-center">
				<div class="text-5xl">🎷</div>
				<h1 class="text-2xl font-bold">You're all set!</h1>
				<p class="text-[var(--color-text-secondary)]">
					The app will play a phrase, then you play it back. Start with easy licks and work your way up.
				</p>
			</div>

			<div class="space-y-3">
				<a
					href="/practice"
					onclick={finish}
					class="block w-full rounded-lg bg-[var(--color-accent)] p-4 text-center font-medium transition-opacity hover:opacity-90"
				>
					Start Practicing
				</a>
				<a
					href="/"
					onclick={finish}
					class="block w-full rounded-lg bg-[var(--color-bg-secondary)] p-3 text-center text-sm transition-colors hover:bg-[var(--color-bg-tertiary)]"
				>
					Go to Dashboard
				</a>
			</div>
		{/if}
	</div>
</div>
