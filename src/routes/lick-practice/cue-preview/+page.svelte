<script lang="ts">
	// TEMPORARY design-preview page — compare listen/play phase-cue designs.
	// Delete this folder once a style is chosen. Not linked from nav.
	import { onMount } from 'svelte';
	import PhaseCueBar from '$lib/components/lick-practice/PhaseCueBar.svelte';
	import UpcomingKeysDisplay from '$lib/components/lick-practice/UpcomingKeysDisplay.svelte';
	import CueStage from './CueStage.svelte';
	import {
		SCENARIOS,
		frameAt,
		PPQ,
		TICKS_PER_BAR,
		type CueVariant,
		type PreviewRow,
		type ScenarioId
	} from './scenarios';
	import { getInstrument } from '$lib/state/settings.svelte';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { displayPitchClass } from '$lib/music/notation';
	import type { PlannedKey } from '$lib/state/lick-practice.svelte';
	import type { Phrase } from '$lib/types/music';

	const OPTIONS: { variant: CueVariant; name: string; note: string }[] = [
		{
			variant: 'row-tab',
			name: 'A — Row tab',
			note: 'A booth-sign tab pinned to the row you are reading, riding the scroll: brass LISTEN while the band plays, on-air PLAY with the countdown and the key you enter in. The turnaround announces "Straight in" or "Listen first".'
		},
		{
			variant: 'surface',
			name: 'B — Stage lighting',
			note: 'The chart surface itself switches: brass wash and speaker watermark while the band demos, on-air red wash and mic watermark while your mic is live. No reading required — the room changes color.'
		},
		{
			variant: 'cursor',
			name: 'C — Cursor handoff',
			note: 'The beat cursor carries the signal: a brass note while the app plays, a red mic when it is your turn, and the 4-3-2-1 count lands in bar 1 — exactly where your entrance is.'
		}
	];

	let scenarioId = $state<ScenarioId>('demo-cycle');
	const scenario = $derived(SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0]);

	let tick = $state(SCENARIOS[0].loopStartTick);
	let playing = $state(true);
	let bpm = $state(140);

	let raf = 0;
	let last = 0;
	function loop(now: number) {
		const dt = Math.min(100, now - last);
		last = now;
		if (playing) {
			tick += (dt / 1000) * (bpm / 60) * PPQ;
			const span = scenario.loopEndTick - scenario.loopStartTick;
			if (tick >= scenario.loopEndTick) {
				tick = scenario.loopStartTick + ((tick - scenario.loopStartTick) % span);
			}
		}
		raf = requestAnimationFrame(loop);
	}
	onMount(() => {
		last = performance.now();
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	});

	function selectScenario(id: ScenarioId) {
		scenarioId = id;
		const s = SCENARIOS.find((sc) => sc.id === id) ?? SCENARIOS[0];
		tick = s.loopStartTick;
	}

	const frame = $derived(frameAt(scenario, tick));
	const instrument = $derived(getInstrument());

	const loopBars = $derived((scenario.loopEndTick - scenario.loopStartTick) / TICKS_PER_BAR);
	const loopBar = $derived(
		Math.min(loopBars, Math.floor((tick - scenario.loopStartTick) / TICKS_PER_BAR) + 1)
	);

	const headerKey = $derived.by(() => {
		const key = frame.rows[frame.activeRowIndex].key;
		const written = concertKeyToWritten(key, instrument);
		return displayPitchClass(written, written);
	});

	// The baseline reuses the production components verbatim, which need full
	// PlannedKey objects; the stub Phrase is never played or scored.
	function stubPhrase(r: PreviewRow): Phrase {
		return {
			id: `cue-preview-${r.key}`,
			name: 'Preview lick',
			timeSignature: [4, 4],
			key: r.key,
			notes: [],
			harmony: r.harmony,
			difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 4 },
			category: 'ii-V-I-major',
			tags: [],
			source: 'generated'
		};
	}
	const plannedKeys = $derived<PlannedKey[]>(
		frame.rows.map((r, i) => ({
			lickIndex: 0,
			keyIndex: i,
			key: r.key,
			phrase: stubPhrase(r),
			harmony: r.harmony,
			lickName: 'Preview lick',
			lickId: 'cue-preview'
		}))
	);
</script>

<svelte:head>
	<title>Listen/Play cues — Mankunku</title>
</svelte:head>

{#snippet mockHeader()}
	<!-- Stand-in for LickHeader: the big accent key letter is the loudest thing
	     on the real session screen, so every stage competes against it here too. -->
	<div class="flex items-end justify-between">
		<div>
			<div class="text-sm text-[var(--color-text-secondary)]">#12 · Preview lick</div>
			<div class="text-xs text-[var(--color-text-secondary)]">
				Key {frame.activeRowIndex + 1}/{frame.rows.length}
			</div>
		</div>
		<div class="font-display text-4xl font-black text-[var(--color-accent)]">{headerKey}</div>
	</div>
{/snippet}

<div class="space-y-8">
	<div>
		<div class="mb-2 flex items-center gap-2">
			<span class="smallcaps text-[var(--color-brass)]">Preview</span>
			<div class="jazz-rule flex-1"></div>
		</div>
		<h1 class="font-display text-2xl font-bold">Listen or play — cue options</h1>
		<p class="mt-1 text-sm text-[var(--color-text-secondary)]">
			Four stages, one clock — every stage sits at the same musical instant, so sweep your eyes
			down the page at a handoff and notice which design you catch without hunting. Option A (row
			tab) is what production now runs; the retired top-strip design is first for comparison. Pick
			a scenario below; “Turnaround → straight in” is the moment the old design failed. Toggle
			light/dark in Settings and macOS Reduce Motion to check both. Option C’s overlay alignment
			is a preview approximation — production would draw inside the chart cells.
		</p>
	</div>

	<div
		class="sticky top-0 z-20 space-y-2 rounded-lg border border-[var(--color-bg-tertiary)] bg-[var(--color-bg)] p-3"
	>
		<div class="flex flex-wrap items-center gap-2">
			{#each SCENARIOS as s (s.id)}
				<button
					onclick={() => selectScenario(s.id)}
					aria-pressed={s.id === scenarioId}
					class="rounded-full px-3 py-1 text-sm transition-colors
						{s.id === scenarioId
						? 'bg-[var(--color-accent)]/15 font-medium text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/40'
						: 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]'}"
				>
					{s.name}
				</button>
			{/each}
		</div>
		<p class="text-xs text-[var(--color-text-secondary)]">{scenario.note}</p>
		<div class="flex flex-wrap items-center gap-4">
			<button
				onclick={() => (playing = !playing)}
				class="rounded-full bg-[var(--color-bg-tertiary)] px-4 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--color-bg-secondary)]"
			>
				{playing ? 'Pause' : 'Play'}
			</button>
			<label class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
				Tempo
				<input
					type="range"
					min="80"
					max="220"
					step="5"
					bind:value={bpm}
					class="accent-[var(--color-accent)]"
				/>
				<span class="w-16 text-right font-mono">{bpm} BPM</span>
			</label>
			<label class="flex min-w-48 flex-1 items-center gap-2 text-sm text-[var(--color-text-secondary)]">
				Bar
				<input
					type="range"
					min={scenario.loopStartTick}
					max={scenario.loopEndTick - 1}
					step="1"
					bind:value={tick}
					class="flex-1 accent-[var(--color-accent)]"
				/>
				<span class="w-12 text-right font-mono">{loopBar}/{loopBars}</span>
			</label>
			<span class="smallcaps w-40 text-right text-[var(--color-text-secondary)]">
				{frame.cue.phase}{frame.cue.countdown > 0 ? ` · ${frame.cue.next} in ${frame.cue.countdown}` : ''}
			</span>
		</div>
	</div>

	<section class="space-y-2">
		<div class="flex items-baseline gap-3">
			<span class="smallcaps text-[var(--color-brass)]">Previous (replaced by A)</span>
			<span class="text-xs text-[var(--color-text-secondary)]">
				The retired top-strip design — the cue lived up here, far from the row you actually read.
			</span>
		</div>
		<div class="space-y-4">
			{@render mockHeader()}
			<PhaseCueBar cue={frame.cue} />
			<UpcomingKeysDisplay
				{plannedKeys}
				scrollFraction={frame.scrollFraction}
				currentBeat={Math.max(0, frame.currentBeat)}
				isPlaying={frame.currentBeat >= 0}
				isRecording={frame.isRecording}
				isArming={frame.isArming}
				scoreFlash={null}
				{instrument}
			/>
		</div>
	</section>

	{#each OPTIONS as opt (opt.variant)}
		<section class="space-y-2">
			<div class="flex items-baseline gap-3">
				<span class="smallcaps text-[var(--color-brass)]">{opt.name}</span>
				<span class="text-xs text-[var(--color-text-secondary)]">{opt.note}</span>
			</div>
			<div class="space-y-4">
				{@render mockHeader()}
				<CueStage variant={opt.variant} {frame} {instrument} />
			</div>
		</section>
	{/each}
</div>
