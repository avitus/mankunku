<script lang="ts">
	// Per-note tuning for the run that just ended, shown when ear training is
	// paused: one console channel per note played, low to high. The fader cap
	// sits at the note's median offset, the lit throw shows how far it moved
	// from the centre detent, and the faint band is where the middle half of
	// its takes landed.
	import { midiToDisplayName } from '$lib/music/notation';
	import { ALERT_CENTS } from '$lib/scoring/tuning';
	import { IN_TUNE_CENTS, tuningSummaryLines, type TuningSummary } from '$lib/scoring/tuning-summary';
	import { signedCents, tuningTier } from '$lib/ui/tuning-tone';

	interface Props {
		summary: TuningSummary;
		/** Concert + this = written, for the note names. */
		transpositionSemitones: number;
		/** Written key of the session; spells the names as the session's note list does. */
		displayKey: string;
		/** The session's scale (a `ScaleDefinition.id`), rooted at `displayKey`. */
		scaleId?: string;
		instrumentId: string;
		/** Instrument, key and scale, e.g. "Tenor sax · G Mixolydian". */
		context: string;
		/** Opt into the approved Ear Training console without changing tuning calculations. */
		studio?: boolean;
	}

	let { summary, transpositionSemitones, displayKey, scaleId, instrumentId, context, studio = false }: Props = $props();

	/** Measure from A = 440, or from the player's own centre once there is one. */
	let fromCentre = $state(false);
	const centred = $derived(fromCentre && summary.centre !== null);
	const shift = $derived(centred ? summary.centre! : 0);

	/** A concert MIDI's written name with octave, spelled for the session key and scale. */
	const writtenName = (midi: number) => midiToDisplayName(midi + transpositionSemitones, displayKey, scaleId);
	const lines = $derived(tuningSummaryLines(summary, instrumentId, writtenName));
	const total = $derived(summary.notes.reduce((n, note) => n + note.count, 0));

	const channels = $derived(
		summary.notes.map((n) => {
			const name = writtenName(n.midi);
			const m = /^(.*?)(-?\d+)$/.exec(name);
			const median = n.median - shift;
			const tier = tuningTier(median);
			const size = Math.round(Math.abs(median));
			const reading = size <= IN_TUNE_CENTS ? 'in tune' : `${size} cents ${median > 0 ? 'sharp' : 'flat'}`;
			return {
				...n,
				name,
				letter: m ? m[1] : name,
				octave: m ? m[2] : '',
				median,
				q1: n.q1 === null ? null : n.q1 - shift,
				q3: n.q3 === null ? null : n.q3 - shift,
				tier,
				label: `${name}: ${reading}, ${tier.name}, ${n.count} ${n.count === 1 ? 'take' : 'takes'}`
			};
		})
	);

	const H = $derived(studio ? 134 : 168);
	const LIMIT = 35;
	/** Pin an offset to the fader's ±LIMIT travel. */
	const clamp = (c: number) => Math.max(-LIMIT, Math.min(LIMIT, c));
	/** Pixel top within the slot for an offset in cents: sharp up, 0 at the centre detent. */
	const y = (c: number) => H / 2 - (clamp(c) / LIMIT) * (studio ? H * 0.45 : H / 2 - 8);
	const TICKS = [-30, -ALERT_CENTS, -IN_TUNE_CENTS, 0, IN_TUNE_CENTS, ALERT_CENTS, 30];
	const SCALE = $derived(studio ? [30, 0, -30] : [30, ALERT_CENTS, 0, -ALERT_CENTS, -30]);
</script>

<section data-domain={studio ? 'ear-training' : undefined} data-testid="tuning-faders" class="panel w-full {studio ? 'studio-panel tuning-console' : 'max-w-xl rounded-xl p-4 sm:p-5'}" aria-labelledby="tuning-faders-title">
	<div class="tuning-header flex flex-wrap items-center gap-x-3 gap-y-2">
		{#if studio}<span class="studio-panel-number" aria-hidden="true">02</span>{/if}
		<h2 id="tuning-faders-title" class={studio ? 'tuning-title' : 'smallcaps text-[var(--color-brass)]'}>Your tuning</h2>
		{#if !studio}<div class="jazz-rule min-w-6 flex-1"></div>{/if}
		<div class="reference-switch flex rounded-full bg-[var(--color-bg-tertiary)] p-0.5 text-[11px]">
			{#each [{ centre: false, label: 'A = 440' }, { centre: true, label: 'Your centre' }] as o (o.label)}
				<button
					type="button"
					aria-pressed={centred === o.centre}
					disabled={o.centre && summary.centre === null}
					onclick={() => (fromCentre = o.centre)}
					class="rounded-full px-2.5 py-0.5 font-medium transition-colors disabled:opacity-40
						   {centred === o.centre
							? 'bg-[var(--color-bg)] text-[var(--color-text)]'
							: 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)] disabled:hover:text-[var(--color-text-secondary)]'}"
				>
					{o.label}
				</button>
			{/each}
		</div>
	</div>
	<p class="mb-4 mt-1 text-xs text-[var(--color-text-secondary)]">
		{context} · {total} clean {total === 1 ? 'note' : 'notes'}
		{#if !studio && centred}
			· measured from your centre ({signedCents(shift)}¢)
		{/if}
	</p>

	<div class:console-body={studio}>
	<div class="fader-bank flex gap-1.5 sm:gap-2">
		<div class="ruler relative hidden w-7 shrink-0 sm:block" style="height: {H}px; margin-top: {studio ? 35 : 22}px" aria-hidden="true">
			{#each SCALE as t (t)}
				<span
					class="absolute right-0 -translate-y-1/2 text-[10px] tabular-nums text-[var(--color-text-secondary)]"
					style="top: {y(t)}px">{t === 0 ? '0' : signedCents(t)}{studio && t !== 0 ? '¢' : ''}</span
				>
			{/each}
		</div>

		<!-- Ten channels fit a phone; a longer run scrolls rather than squashing. -->
		<ul
			class="grid flex-1 gap-0.5 overflow-x-auto pb-1 sm:gap-2"
			style="grid-template-columns: repeat({channels.length}, minmax(1.6rem, {studio ? '1fr' : '4.5rem'}))"
			aria-label="Tuning by note, low to high"
		>
			{#each channels as c (c.midi)}
				{@const color = c.tier.color}
				<li
					class="channel flex min-w-0 flex-col items-center rounded-md px-0.5 pb-2 pt-1"
					data-note={c.name}
					data-steady={c.steady}
					aria-label={c.label}
				>
					<span
						class="cents h-[18px] text-[11px] font-semibold tabular-nums sm:text-xs"
						style="color: {c.steady ? color : 'var(--color-text-secondary)'}"
						aria-hidden="true">{signedCents(c.median)}{#if studio}<small>¢</small>{/if}</span
					>
					<div class="track relative w-full" style="height: {H}px" aria-hidden="true">
						<div
							class="in-tune absolute inset-x-2 rounded-sm"
							style="top: {y(IN_TUNE_CENTS)}px; height: {y(-IN_TUNE_CENTS) - y(IN_TUNE_CENTS)}px;
								   background: color-mix(in srgb, var(--accuracy-gold) 12%, transparent)"
						></div>
						{#each studio ? [] : TICKS as t (t)}
							<div
								class="absolute left-1 right-1 h-px"
								style="top: {y(t)}px; background: color-mix(in srgb, var(--color-text-secondary) {t === 0 ? 70 : 25}%, transparent)"
							></div>
						{/each}
						<div class="slot absolute bottom-1 left-1/2 top-1 w-1 -translate-x-1/2 rounded-full"></div>
						{#if c.q1 !== null && c.q3 !== null}
							<div
								class="absolute left-1/2 w-3 -translate-x-1/2 rounded-full"
								style="top: {y(c.q3)}px; height: {Math.max(3, y(c.q1) - y(c.q3))}px;
									   background: color-mix(in srgb, {color} 30%, transparent)"
							></div>
						{/if}
						<div
							class="throw absolute left-1/2 w-1 -translate-x-1/2 rounded-full"
							style="top: {Math.min(y(0), y(c.median))}px; height: {Math.abs(y(c.median) - y(0))}px;
								   background: {color}; opacity: {c.steady ? 1 : 0.4}"
						></div>
						<div
							class="cap absolute left-1/2 h-4 w-[min(30px,90%)] -translate-x-1/2 -translate-y-1/2 rounded-[3px]"
							class:is-unsteady={!c.steady}
							style="top: {y(c.median)}px; --cap: {c.tier.cap}"
						>
							<span class="grip"></span>
						</div>
						{#if Math.abs(c.median) > LIMIT}
							<span
								class="absolute left-1/2 -translate-x-1/2 text-[10px]"
								style="top: {c.median > 0 ? -2 : H - 10}px; color: {color}">{c.median > 0 ? '▲' : '▼'}</span
							>
						{/if}
					</div>
					<span class="note-name mt-1.5 font-display text-lg font-semibold leading-none" aria-hidden="true"
						>{c.letter}<sub class="ml-px align-baseline text-[10px] font-normal text-[var(--color-text-secondary)]"
							>{c.octave}</sub
						></span
					>
					<span class="count mt-1 text-[10px] tabular-nums text-[var(--color-text-secondary)]" aria-hidden="true"
						>×{c.count}</span
					>
				</li>
			{/each}
		</ul>
	</div>

	<div
		class="tuning-advice mt-4 space-y-0.5 border-t border-[var(--color-bg-tertiary)] pt-3 text-center font-display text-[15px] italic leading-snug"
	>
		{#each lines as line, i (i)}
			<p class={i === 0 ? 'text-[var(--color-text)]' : 'text-[var(--color-text-secondary)]'}>{line}</p>
		{/each}
		{#if studio}
			<small>{centred ? `Measured from your centre (${signedCents(shift)}¢).` : 'Measured against A = 440 Hz.'}</small>
		{/if}
	</div>
	</div>
	{#if studio}<p class="tuning-footer">Median cents per note · Read-only</p>{/if}
</section>

<style>
	.panel {
		background: color-mix(in srgb, var(--color-bg-secondary) 55%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-brass) 22%, transparent);
	}
	.channel {
		background: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
	}
	.slot {
		background: color-mix(in srgb, var(--color-bg) 80%, black);
		box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.4);
	}
	.cap {
		background: linear-gradient(
			to bottom,
			color-mix(in srgb, var(--cap) 55%, white) 0%,
			var(--cap) 45%,
			color-mix(in srgb, var(--cap) 70%, black) 100%
		);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
	}
	/* Fewer than three takes is a reading, not a tendency: an outlined cap. */
	.cap.is-unsteady {
		background: color-mix(in srgb, var(--color-bg) 70%, transparent);
		box-shadow: inset 0 0 0 1.5px var(--cap);
	}
	.cap.is-unsteady .grip {
		display: none;
	}
	.grip {
		position: absolute;
		inset: 50% 18% auto;
		height: 1px;
		background: color-mix(in srgb, black 55%, transparent);
	}
	.panel.tuning-console { background: linear-gradient(125deg, var(--studio-panel-highlight), var(--studio-panel) 65%); box-shadow: var(--studio-shadow); }
	.tuning-console .tuning-title { font: 500 24px/1.2 var(--font-display); }
	.tuning-console .reference-switch {
		margin-left: auto;
		width: 238px;
		border-radius: 5px;
		padding: 5px;
		background: var(--studio-well);
		gap: 4px;
	}
	.reference-switch button { position: relative; }
	.tuning-console .reference-switch button {
		flex: 1;
		min-height: 44px;
		padding: 9px 19px 9px 12px;
		text-align: left;
		font-size: 11px;
		color: var(--studio-text);
		background: var(--studio-panel-highlight);
		border: 1px solid var(--studio-border);
		border-radius: 3px;
	}
	.tuning-console .reference-switch button[aria-pressed='true'] {
		color: white;
		background: var(--studio-button);
		box-shadow: inset 0 2px 3px #0005;
	}
	.tuning-console .reference-switch button::after {
		content: '';
		position: absolute;
		top: 8px;
		right: 7px;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--studio-well);
	}
	.tuning-console .reference-switch button[aria-pressed='true']::after {
		background: #83bdc8;
		box-shadow: 0 0 5px #83bdc8;
	}
	.tuning-console .tuning-header + p { color: var(--studio-muted); margin: 7px 0 22px 38px; }
	.console-body { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 45px; align-items: center; }
	.fader-bank { min-width: 0; }
	.tuning-console .fader-bank { gap: 12px; }
	.tuning-console .fader-bank ul { min-width: 0; gap: 7px; padding: 0; }
	.tuning-console .ruler { display: block; }
	.tuning-console .ruler span { font-size: 9px; }
	.tuning-console .channel {
		padding: 8px 5px;
		border: 1px solid color-mix(in srgb, var(--studio-border) 40%, transparent);
		border-radius: 4px;
		background: color-mix(in srgb, var(--studio-well) 38%, transparent);
		box-shadow: none;
	}
	.tuning-console .cents { font-size: 11px; font-weight: 400; }
	.cents small { font-size: 9px; margin-left: 2px; opacity: .75; }
	.tuning-console .track {
		margin: 8px 0 10px;
		background: repeating-linear-gradient(to bottom, transparent 0 21px, color-mix(in srgb, var(--studio-muted) 22%, transparent) 21px 22px);
	}
	.tuning-console .in-tune { inset-inline: 0; }
	.tuning-console .slot { top: 0; bottom: 0; }
	.tuning-console .throw { width: 3px; }
	.tuning-console .cap {
		width: min(28px, 100%);
		height: 13px;
		border: 1px solid var(--cap);
		border-radius: 2px;
		box-shadow: 0 2px 3px #0009;
	}
	.tuning-console .grip { inset: 5px 4px auto; }
	.tuning-console .note-name { margin: 0; font-size: 19px; font-weight: 500; }
	.tuning-console .count { font-size: 9px; }
	.tuning-console .tuning-advice {
		border-top: 0;
		border-left: 1px solid var(--studio-border);
		padding: 0 0 0 35px;
		margin: 0;
		text-align: left;
		font-style: normal;
	}
	.tuning-console .tuning-advice p:first-child { font: 500 24px/1.2 var(--font-display); margin: 11px 0; }
	.tuning-console .tuning-advice p + p { font: 12px/1.8 var(--font-sans); color: var(--studio-muted); }
	.tuning-advice small { display: block; margin-top: 8px; font: 10px/1.5 var(--font-sans); color: var(--studio-muted); }
	.tuning-footer { margin-top: 18px; border-top: 1px solid var(--studio-border); padding-top: 12px; font-size: 10px; color: var(--studio-muted); }
	@media (max-width: 900px) {
		.console-body { gap: 25px; }
		.tuning-console .tuning-advice { padding-left: 23px; }
		.tuning-console .reference-switch { width: 214px; }
	}
	@media (max-width: 600px) {
		.console-body { grid-template-columns: minmax(0, 1fr); gap: 23px; }
		.tuning-console .tuning-header { display: contents; }
		.tuning-console { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; column-gap: 12px; }
		.tuning-console .tuning-header + p { grid-area: 2 / 2; margin: 7px 0 18px; }
		.tuning-console .reference-switch { grid-area: 3 / 1 / 4 / -1; width: 100%; margin: 0 0 20px; }
		.console-body, .tuning-footer { grid-column: 1 / -1; }
		.tuning-console .fader-bank { gap: 6px; }
		.tuning-console .fader-bank ul { gap: 4px; }
		.tuning-console .channel { padding: 8px 3px; }
		.tuning-console .ruler { width: 24px; }
		.tuning-console .cap { width: min(24px, 100%); }
		.tuning-console .tuning-advice { border-left: 0; border-top: 1px solid var(--studio-border); padding: 20px 0 0; }
		.tuning-console .tuning-advice p:first-child { font-size: 23px; }
	}
</style>
