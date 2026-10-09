<script lang="ts">
	// Per-note tuning for the run that just ended, shown when ear training is
	// paused: one console channel per note played, low to high. The fader cap
	// sits at the note's median offset, the lit throw shows how far it moved
	// from the centre detent, and the faint band is where the middle half of
	// its takes landed.
	import { midiToDisplayName } from '$lib/music/notation';
	import { ALERT_CENTS } from '$lib/scoring/tuning';
	import { IN_TUNE_CENTS, tuningSummaryLines, type TuningSummary } from '$lib/scoring/tuning-summary';
	import { signedCents, tuningTone } from '$lib/ui/tuning-tone';

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
	}

	let { summary, transpositionSemitones, displayKey, scaleId, instrumentId, context }: Props = $props();

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
				label: `${name}: ${reading}, ${n.count} ${n.count === 1 ? 'take' : 'takes'}`
			};
		})
	);

	const H = 168;
	const LIMIT = 35;
	/** Pin an offset to the fader's ±LIMIT travel. */
	const clamp = (c: number) => Math.max(-LIMIT, Math.min(LIMIT, c));
	/** Pixel top within the slot for an offset in cents: sharp up, 0 at the centre detent. */
	const y = (c: number) => H / 2 - (clamp(c) / LIMIT) * (H / 2 - 8);
	const TICKS = [-30, -ALERT_CENTS, -IN_TUNE_CENTS, 0, IN_TUNE_CENTS, ALERT_CENTS, 30];
	const SCALE = [30, ALERT_CENTS, 0, -ALERT_CENTS, -30];
</script>

<section data-testid="tuning-faders" class="panel w-full max-w-xl rounded-xl p-4 sm:p-5" aria-labelledby="tuning-faders-title">
	<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
		<h2 id="tuning-faders-title" class="smallcaps text-[var(--color-brass)]">Your tuning</h2>
		<div class="jazz-rule min-w-6 flex-1"></div>
		<div class="flex rounded-full bg-[var(--color-bg-tertiary)] p-0.5 text-[11px]">
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
		{#if centred}
			· measured from your centre ({signedCents(shift)}¢)
		{/if}
	</p>

	<div class="flex gap-1.5 sm:gap-2">
		<div class="relative hidden w-7 shrink-0 sm:block" style="height: {H}px; margin-top: 22px" aria-hidden="true">
			{#each SCALE as t (t)}
				<span
					class="absolute right-0 -translate-y-1/2 text-[10px] tabular-nums text-[var(--color-text-secondary)]"
					style="top: {y(t)}px">{t === 0 ? '0' : signedCents(t)}</span
				>
			{/each}
		</div>

		<!-- Ten channels fit a phone; a longer run scrolls rather than squashing. -->
		<ul
			class="grid flex-1 gap-0.5 overflow-x-auto pb-1 sm:gap-2"
			style="grid-template-columns: repeat({channels.length}, minmax(1.6rem, 4.5rem))"
			aria-label="Tuning by note, low to high"
		>
			{#each channels as c (c.midi)}
				{@const color = tuningTone(c.median)}
				<li
					class="channel flex min-w-0 flex-col items-center rounded-md px-0.5 pb-2 pt-1"
					data-note={c.name}
					data-steady={c.steady}
					aria-label={c.label}
				>
					<span
						class="h-[18px] text-[11px] font-semibold tabular-nums sm:text-xs"
						style="color: {c.steady ? color : 'var(--color-text-secondary)'}"
						aria-hidden="true">{signedCents(c.median)}</span
					>
					<div class="relative w-full" style="height: {H}px" aria-hidden="true">
						<div
							class="absolute inset-x-2 rounded-sm"
							style="top: {y(IN_TUNE_CENTS)}px; height: {y(-IN_TUNE_CENTS) - y(IN_TUNE_CENTS)}px;
								   background: color-mix(in srgb, var(--color-brass) 12%, transparent)"
						></div>
						{#each TICKS as t (t)}
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
							class="absolute left-1/2 w-1 -translate-x-1/2 rounded-full"
							style="top: {Math.min(y(0), y(c.median))}px; height: {Math.abs(y(c.median) - y(0))}px;
								   background: {color}; opacity: {c.steady ? 1 : 0.4}"
						></div>
						<div
							class="cap absolute left-1/2 h-4 w-[min(30px,90%)] -translate-x-1/2 -translate-y-1/2 rounded-[3px]"
							class:is-unsteady={!c.steady}
							style="top: {y(c.median)}px; --cap: {color}"
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
					<span class="mt-1.5 font-display text-lg font-semibold leading-none" aria-hidden="true"
						>{c.letter}<sub class="ml-px align-baseline text-[10px] font-normal text-[var(--color-text-secondary)]"
							>{c.octave}</sub
						></span
					>
					<span class="mt-1 text-[10px] tabular-nums text-[var(--color-text-secondary)]" aria-hidden="true"
						>×{c.count}</span
					>
				</li>
			{/each}
		</ul>
	</div>

	<div
		class="mt-4 space-y-0.5 border-t border-[var(--color-bg-tertiary)] pt-3 text-center font-display text-[15px] italic leading-snug"
	>
		{#each lines as line, i (i)}
			<p class={i === 0 ? 'text-[var(--color-text)]' : 'text-[var(--color-text-secondary)]'}>{line}</p>
		{/each}
	</div>
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
</style>
