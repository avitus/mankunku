<script lang="ts">
	import Knob from '$lib/components/console/Knob.svelte';
	import type { LickPracticeSessionType } from '$lib/types/lick-practice';

	interface Props {
		sessionType: LickPracticeSessionType;
		durationMinutes: number;
		plannedLickCount: number;
		canStart: boolean;
		loading: boolean;
		startLabel: string;
		startCaption: string;
		showBrowseLink: boolean;
		ondurationchange: (minutes: number) => void;
		onstart: () => void;
	}

	let {
		sessionType, durationMinutes, plannedLickCount, canStart, loading,
		startLabel, startCaption, showBrowseLink, ondurationchange, onstart
	}: Props = $props();
	const timed = $derived(sessionType === 'daily' || sessionType === 'focused');
</script>

<section class="studio-panel launch-panel" aria-labelledby="practice-launch-title">
	<header class="launch-heading">
		<span class="studio-panel-number" aria-hidden="true">02</span>
		<h2 id="practice-launch-title">{timed ? 'Set your time. Make it count.' : 'Ready when you are.'}</h2>
	</header>
	<div class="launch-body">
		<div class="launch-budget">
			{#if timed}
				<Knob
					size="lg"
					label="Duration"
					ariaLabel="Practice time"
					helpText="Licks are queued up to this duration. The count below shows this session; a smaller practice set may finish sooner."
					value={durationMinutes}
					min={3}
					max={20}
					step={1}
					displayValue={`${durationMinutes} min`}
					onInput={ondurationchange}
				/>
			{/if}
			<div class="launch-count" aria-live="polite" aria-atomic="true">
				<strong>
					{#if loading}Preparing your session…
					{:else if timed}{plannedLickCount} lick{plannedLickCount === 1 ? '' : 's'} in this session
					{:else}Open-ended practice{/if}
				</strong>
				{#if !timed && canStart && !loading}<span>{startCaption}</span>{/if}
			</div>
		</div>
		<div class="launch-go">
			<p class="launch-ready">
				{loading ? 'Loading your progress' : canStart ? 'Ready to play' : 'Let’s get your session ready'}
			</p>
			<button
				type="button"
				class="launch-button"
				disabled={!canStart || loading}
				aria-describedby={!canStart && !loading ? 'practice-launch-guidance' : undefined}
				onclick={onstart}
			>
				<span class="launch-play" aria-hidden="true">▶</span>
				<span>{loading ? 'Loading progress…' : startLabel}</span>
				<span class="launch-arrow" aria-hidden="true">→</span>
			</button>
			{#if !canStart && !loading}
				<p id="practice-launch-guidance" class="launch-note">{startCaption}</p>
			{/if}
			{#if showBrowseLink && !loading}
				<a href="/licks">Browse your licks to tag more</a>
			{/if}
		</div>
	</div>
</section>

<style>
	.launch-panel {
		padding: 22px 26px 26px;
		border: 1px solid color-mix(in srgb, var(--color-brass) 55%, var(--studio-border));
		border-top: 3px solid var(--color-brass);
		background: linear-gradient(115deg, color-mix(in srgb, var(--color-brass) 5%, var(--studio-panel)), var(--studio-panel));
	}
	.launch-heading { display: flex; gap: 14px; align-items: center; }
	.launch-heading > span { flex-shrink: 0; }
	.launch-heading h2 {
		margin: 0; font-family: var(--font-display); font-size: 25px;
		line-height: 1.2; font-weight: 600; letter-spacing: -0.5px;
		text-wrap: balance;
	}
	.launch-body {
		display: grid; grid-template-columns: minmax(230px, 0.85fr) minmax(0, 1.15fr);
		align-items: center; gap: 32px; margin-top: 20px;
	}
	.launch-budget {
		display: flex; flex-direction: column; align-items: center; gap: 12px;
		padding-right: 30px; border-right: 1px solid var(--studio-border);
	}
	.launch-count { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; }
	.launch-count strong { color: var(--color-text); font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; }
	.launch-count > span { color: var(--studio-muted); font-size: 12px; line-height: 1.6; }
	.launch-ready { color: var(--color-brass); font-size: 10px; letter-spacing: 1.7px; margin: 0 0 12px; text-transform: uppercase; }
	.launch-button {
		display: flex; width: min(100%, 330px); align-items: center; gap: 12px;
		min-height: 54px; padding: 10px 16px;
		background: linear-gradient(180deg, #dfb65e, #c69236); color: #20190d;
		border: 1px solid #f5d891; border-bottom: 4px solid #8e6225; border-radius: 6px;
		box-shadow: 0 3px 0 #151b26, 0 8px 22px #0003, inset 0 1px 0 #fff5;
		font-family: var(--font-display); font-size: 20px; line-height: 1.15; font-weight: 650;
		text-align: left; cursor: pointer;
		transition: transform 150ms, filter 150ms, box-shadow 150ms;
	}
	.launch-play {
		display: grid; place-items: center; flex: 0 0 28px; width: 28px; height: 28px;
		border: 1px solid #38270e44; border-radius: 50%; font-family: system-ui; font-size: 11px; padding-left: 2px;
	}
	.launch-arrow { margin-left: auto; font-family: system-ui; font-size: 20px; }
	.launch-button:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-2px); box-shadow: 0 5px 0 #151b26, 0 10px 28px #d6a34924; }
	.launch-button:active:not(:disabled) { transform: translateY(1px); }
	.launch-button:focus-visible { outline: 3px solid var(--color-text); outline-offset: 5px; }
	.launch-button:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }
	.launch-note { margin: 12px 0 0; color: var(--studio-muted); font-size: 12px; line-height: 1.6; }
	.launch-go > a { display: inline-block; margin-top: 12px; font-size: 13px; text-decoration: underline; color: var(--color-brass); }
	@media (max-width: 700px) {
		.launch-panel { padding: 20px; }
		.launch-heading h2 { font-size: 22px; }
		.launch-body { grid-template-columns: 1fr; gap: 22px; }
		.launch-budget { padding: 0 0 20px; border-right: 0; border-bottom: 1px solid var(--studio-border); }
		.launch-button { min-height: 52px; font-size: 19px; padding: 10px 14px; }
		.launch-ready { font-size: 9px; letter-spacing: 1.2px; }
	}
	@media (prefers-reduced-motion: reduce) { .launch-button { transition: none; } }
</style>
