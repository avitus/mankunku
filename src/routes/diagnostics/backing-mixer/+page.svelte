<script lang="ts">
	// Backing listening lab + mixer. Loops a chosen progression preset,
	// balances the rhythm section per instrument (levels persist on this
	// device), bounces the current engine to WAV for blind A/B against a
	// reference bounce, and hosts the listening checklist whose report
	// gates the backing-track milestones. Linked from /diagnostics.
	import { onDestroy } from 'svelte';
	import type { BackingInstrument, BackingStyle } from '$lib/types/instruments';
	import { initAudio } from '$lib/audio/audio-context';
	import {
		loadBackingInstruments,
		scheduleBackingTrack,
		disposeBackingParts,
		setBackingTrackVolume,
		getBackingMix,
		setBackingMix,
		getDecodedDrumBuffersForBounce
	} from '$lib/audio/backing-track';
	import { DEFAULT_BACKING_MIX, type BackingMixLevels } from '$lib/audio/backing-mix';
	import { BACKING_STYLE_NAMES } from '$lib/audio/backing-styles';
	import {
		BACKING_LAB_PRESETS,
		LAB_TEMPO_PRESETS,
		labPhraseWithSeed
	} from '$lib/audio/backing-lab-presets';
	import { bounceBacking, generateForBounce } from '$lib/audio/backing-bounce';
	import BlindAbPlayer from '$lib/components/diagnostics/BlindAbPlayer.svelte';
	import ListeningChecklist from '$lib/components/diagnostics/ListeningChecklist.svelte';
	import { settings } from '$lib/state/settings.svelte';

	const GAIN_SLIDERS: Array<{ key: keyof BackingMixLevels; label: string; hint: string }> = [
		{ key: 'bass', label: 'Bass', hint: 'Upright bass level' },
		{ key: 'comp', label: 'Piano / Organ', hint: 'Comping instrument level' },
		{ key: 'drums', label: 'Drum kit', hint: 'Whole kit level' }
	];
	const VOICE_SLIDERS: Array<{ key: keyof BackingMixLevels; label: string; hint: string }> = [
		{ key: 'kick', label: 'Kick', hint: 'Feathered quarters — 100% is the ear-tuned baseline' },
		{ key: 'ride', label: 'Ride', hint: 'Spang-a-lang voice' },
		{ key: 'hihat', label: 'Hi-hat', hint: 'Foot on 2 and 4' }
	];

	let mix = $state<BackingMixLevels>(getBackingMix());
	let volume = $state(settings.backingTrackVolume);
	let tempo = $state(140);
	let style = $state<BackingStyle>(settings.backingStyle);
	let instrument = $state<BackingInstrument>(settings.backingInstrument);
	let presetId = $state(BACKING_LAB_PRESETS[0].id);
	let seed = $state(0);
	let playing = $state(false);
	let loading = $state(false);
	let copied = $state(false);

	let bouncing = $state(false);
	let bounceError = $state<string | null>(null);
	let bounceUrl = $state<string | null>(null);
	let bounceName = $state<string | null>(null);

	const preset = $derived(BACKING_LAB_PRESETS.find((p) => p.id === presetId) ?? BACKING_LAB_PRESETS[0]);
	const phrase = $derived(labPhraseWithSeed(preset, seed));

	let toneModule: typeof import('tone') | null = null;

	// Generation counter: each start owns the transport only while it is the
	// newest request, so rapid style/tempo changes supersede an in-flight
	// restart instead of being dropped (same pattern as the diagnostics
	// page's replayRequestId).
	let playRequest = 0;

	async function start(): Promise<void> {
		const id = ++playRequest;
		loading = true;
		try {
			await initAudio();
			toneModule = await import('tone');
			await loadBackingInstruments(instrument);
			if (id !== playRequest) return;
			const transport = toneModule.getTransport();
			transport.stop();
			transport.position = 0;
			transport.bpm.value = tempo;
			await scheduleBackingTrack(
				phrase,
				{
					tempo,
					swing: settings.swing,
					countInBeats: 0,
					metronomeEnabled: false,
					metronomeVolume: 0,
					backingTrackEnabled: true,
					backingInstrument: instrument,
					backingTrackVolume: volume,
					backingStyle: style
				},
				0,
				true,
				() => id === playRequest
			);
			if (id !== playRequest) return;
			transport.start('+0.05');
			playing = true;
		} finally {
			if (id === playRequest) loading = false;
		}
	}

	function stop(): void {
		playRequest++; // cancel any in-flight start
		disposeBackingParts();
		toneModule?.getTransport().stop();
		playing = false;
	}

	async function restartIfPlaying(): Promise<void> {
		// `loading` covers the window where a start is in flight but
		// `playing` hasn't flipped yet — a change there must restart too.
		if (!playing && !loading) return;
		stop();
		await start();
	}

	function updateMix(key: keyof BackingMixLevels, value: number): void {
		mix = { ...mix, [key]: value };
		setBackingMix({ [key]: value });
	}

	function resetMix(): void {
		mix = { ...DEFAULT_BACKING_MIX };
		setBackingMix(mix);
	}

	function updateVolume(value: number): void {
		volume = value;
		setBackingTrackVolume(value);
	}

	async function copyMix(): Promise<void> {
		try {
			await navigator.clipboard.writeText(JSON.stringify(mix, null, 2));
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch (err) {
			console.warn('clipboard copy failed', err);
		}
	}

	function bounceParams() {
		return { phrase, style, tempo, swing: settings.swing, instrument, volume, mix };
	}

	async function bounce(): Promise<void> {
		bouncing = true;
		bounceError = null;
		try {
			await initAudio();
			const drumBuffers = await getDecodedDrumBuffersForBounce();
			const result = await bounceBacking(bounceParams(), drumBuffers);
			if (bounceUrl) URL.revokeObjectURL(bounceUrl);
			bounceUrl = URL.createObjectURL(result.blob);
			bounceName = result.filename;
		} catch (err) {
			bounceError = err instanceof Error ? err.message : String(err);
		} finally {
			bouncing = false;
		}
	}

	function downloadBlob(content: string, filename: string): void {
		const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	function exportGoldenJson(): void {
		const generated = generateForBounce(bounceParams());
		downloadBlob(
			JSON.stringify({ phraseId: phrase.id, style, tempo, ...generated }, null, 1),
			`golden-${phrase.id.replace(/[^a-zA-Z0-9-]/g, '_')}-${tempo}.json`
		);
	}

	const pct = (v: number) => `${Math.round(v * 100)}%`;

	onDestroy(() => {
		if (playing) stop();
		if (bounceUrl) URL.revokeObjectURL(bounceUrl);
	});
</script>

<svelte:head>
	<title>Backing Lab — Mankunku</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-6 space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div>
			<h1 class="text-2xl font-bold">Backing lab</h1>
			<p class="text-sm text-[var(--color-text-secondary)]">
				Loop a preset, balance the band, bounce the engine to WAV, and run blind A/B
				listening passes. Mix levels apply live, persist on this device, and shape every
				practice session's backing.
			</p>
		</div>
		<a
			href="/diagnostics"
			class="rounded-full bg-[var(--color-bg-secondary)] px-3 py-1 text-sm hover:bg-[var(--color-bg-tertiary)] transition-colors"
		>
			Back to diagnostics
		</a>
	</div>

	<!-- ── Transport ──────────────────────────────────────── -->
	<section class="rounded-lg bg-[var(--color-bg-secondary)] p-4 space-y-4">
		<div class="flex flex-wrap items-end gap-4">
			<button
				onclick={() => (playing ? stop() : start())}
				disabled={loading}
				class="rounded-full bg-[var(--color-accent)] text-white px-6 py-2 font-semibold hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
			>
				{loading ? 'Loading…' : playing ? 'Stop' : 'Play loop'}
			</button>

			<label class="text-sm">
				<span class="block text-[var(--color-text-secondary)] mb-1">Progression</span>
				<select
					bind:value={presetId}
					onchange={restartIfPlaying}
					data-testid="lab-preset"
					class="rounded bg-[var(--color-bg-tertiary)] px-2 py-1.5 max-w-64"
				>
					{#each BACKING_LAB_PRESETS as p (p.id)}
						<option value={p.id} title={p.hint}>{p.label}</option>
					{/each}
				</select>
			</label>

			<label class="text-sm">
				<span class="block text-[var(--color-text-secondary)] mb-1">Style</span>
				<select
					bind:value={style}
					onchange={restartIfPlaying}
					class="rounded bg-[var(--color-bg-tertiary)] px-2 py-1.5"
				>
					{#each Object.entries(BACKING_STYLE_NAMES) as [value, name] (value)}
						<option {value}>{name}</option>
					{/each}
				</select>
			</label>

			<label class="text-sm">
				<span class="block text-[var(--color-text-secondary)] mb-1">Instrument</span>
				<select
					bind:value={instrument}
					onchange={restartIfPlaying}
					class="rounded bg-[var(--color-bg-tertiary)] px-2 py-1.5"
				>
					<option value="piano">Piano</option>
					<option value="organ">Organ</option>
				</select>
			</label>

			<label class="text-sm">
				<span class="block text-[var(--color-text-secondary)] mb-1">Variation seed</span>
				<input
					type="number"
					min="0"
					max="99"
					bind:value={seed}
					onchange={restartIfPlaying}
					data-testid="lab-seed"
					class="w-20 rounded bg-[var(--color-bg-tertiary)] px-2 py-1.5"
				/>
			</label>
		</div>

		<div class="flex flex-wrap items-end gap-4">
			<div class="text-sm">
				<span class="block text-[var(--color-text-secondary)] mb-1">Tempo: {tempo} BPM</span>
				<div class="flex items-center gap-2">
					<input
						type="range"
						min="60"
						max="260"
						step="5"
						value={tempo}
						onchange={(e) => {
							tempo = e.currentTarget.valueAsNumber;
							restartIfPlaying();
						}}
						class="w-40 accent-[var(--color-accent)]"
					/>
					{#each LAB_TEMPO_PRESETS as t (t)}
						<button
							onclick={() => {
								tempo = t;
								restartIfPlaying();
							}}
							class="rounded-full px-2.5 py-0.5 text-xs transition-colors {tempo === t
								? 'bg-[var(--color-accent)] text-white'
								: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
						>
							{t}
						</button>
					{/each}
				</div>
			</div>

			<label class="text-sm">
				<span class="block text-[var(--color-text-secondary)] mb-1">Overall volume: {pct(volume)}</span>
				<input
					type="range"
					min="0"
					max="1"
					step="0.05"
					value={volume}
					oninput={(e) => updateVolume(e.currentTarget.valueAsNumber)}
					class="w-40 accent-[var(--color-accent)]"
				/>
			</label>
		</div>
	</section>

	<!-- ── Bounce + A/B ───────────────────────────────────── -->
	<section class="rounded-lg bg-[var(--color-bg-secondary)] p-4 space-y-4">
		<h2 class="text-sm font-semibold text-[var(--color-text-secondary)]">Bounce &amp; blind A/B</h2>
		<div class="flex flex-wrap items-center gap-3">
			<button
				onclick={bounce}
				disabled={bouncing}
				data-testid="lab-bounce"
				class="rounded-full bg-[var(--color-accent)] text-white px-4 py-1.5 text-sm font-semibold disabled:opacity-50"
			>
				{bouncing ? 'Rendering…' : 'Bounce to WAV'}
			</button>
			{#if bounceUrl && bounceName}
				<a
					href={bounceUrl}
					download={bounceName}
					class="rounded-full bg-[var(--color-bg-tertiary)] px-4 py-1.5 text-sm hover:bg-[var(--color-bg-secondary)] transition-colors"
				>
					Download {bounceName}
				</a>
			{/if}
			<button
				onclick={exportGoldenJson}
				class="rounded-full bg-[var(--color-bg-tertiary)] px-4 py-1.5 text-sm hover:bg-[var(--color-bg-secondary)] transition-colors"
			>
				Export events JSON
			</button>
			{#if bounceError}
				<span class="text-sm text-red-500">{bounceError}</span>
			{/if}
		</div>
		<p class="text-xs text-[var(--color-text-secondary)]">
			The bounce renders the exact events the live engine schedules, through the same
			instruments and mix. Long presets take a moment. Keep dated bounces as references:
			the blind player shuffles current-vs-reference behind X/Y labels.
		</p>
		<BlindAbPlayer currentUrl={bounceUrl} currentLabel={bounceName ?? 'Current bounce'} />
	</section>

	<!-- ── Listening checklist ────────────────────────────── -->
	<section class="rounded-lg bg-[var(--color-bg-secondary)] p-4 space-y-4">
		<h2 class="text-sm font-semibold text-[var(--color-text-secondary)]">Listening checklist</h2>
		<ListeningChecklist presetLabel={preset.label} style={style} {tempo} {seed} />
	</section>

	<!-- ── Instrument levels ──────────────────────────────── -->
	<section class="rounded-lg bg-[var(--color-bg-secondary)] p-4 space-y-4">
		<h2 class="text-sm font-semibold text-[var(--color-text-secondary)]">Instrument levels</h2>
		{#each GAIN_SLIDERS as { key, label, hint } (key)}
			<label class="block text-sm">
				<span class="flex justify-between mb-1">
					<span class="font-medium">{label} <span class="text-[var(--color-text-secondary)]">— {hint}</span></span>
					<span class="tabular-nums">{pct(mix[key])}</span>
				</span>
				<input
					type="range"
					min="0"
					max="3"
					step="0.05"
					value={mix[key]}
					oninput={(e) => updateMix(key, e.currentTarget.valueAsNumber)}
					data-testid={`mix-${key}`}
					class="w-full accent-[var(--color-accent)]"
				/>
			</label>
		{/each}
	</section>

	<!-- ── Drum voices ────────────────────────────────────── -->
	<section class="rounded-lg bg-[var(--color-bg-secondary)] p-4 space-y-4">
		<h2 class="text-sm font-semibold text-[var(--color-text-secondary)]">
			Drum voices <span class="font-normal">(velocity trims — take effect from the next hit)</span>
		</h2>
		{#each VOICE_SLIDERS as { key, label, hint } (key)}
			<label class="block text-sm">
				<span class="flex justify-between mb-1">
					<span class="font-medium">{label} <span class="text-[var(--color-text-secondary)]">— {hint}</span></span>
					<span class="tabular-nums">{pct(mix[key])}</span>
				</span>
				<input
					type="range"
					min="0"
					max="3"
					step="0.05"
					value={mix[key]}
					oninput={(e) => updateMix(key, e.currentTarget.valueAsNumber)}
					data-testid={`mix-${key}`}
					class="w-full accent-[var(--color-accent)]"
				/>
			</label>
		{/each}
	</section>

	<!-- ── Actions ────────────────────────────────────────── -->
	<section class="flex flex-wrap items-center gap-3">
		<button
			onclick={copyMix}
			class="rounded-full bg-[var(--color-bg-secondary)] px-4 py-1.5 text-sm hover:bg-[var(--color-bg-tertiary)] transition-colors"
		>
			{copied ? 'Copied ✓' : 'Copy values'}
		</button>
		<button
			onclick={resetMix}
			class="rounded-full bg-[var(--color-bg-secondary)] px-4 py-1.5 text-sm hover:bg-[var(--color-bg-tertiary)] transition-colors"
		>
			Reset to defaults
		</button>
		<span class="text-xs text-[var(--color-text-secondary)]">
			Found a balance you like? Copy the values and share them so they become the app defaults.
		</span>
	</section>
</div>
