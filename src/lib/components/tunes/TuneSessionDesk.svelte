<script lang="ts">
	import RockerSwitch from '$lib/components/console/RockerSwitch.svelte';
	import TempoDial from '$lib/components/console/TempoDial.svelte';
	import type { TunePlayer } from '$lib/state/tune-player.svelte';
	let { player, hasMelody, disabled, centers, practice, canPractice, oncenters, onpractice }: {
		player: TunePlayer; hasMelody: boolean; disabled: boolean; centers: boolean;
		practice: boolean; canPractice: boolean; oncenters: (on: boolean) => void; onpractice: (on: boolean) => void;
	} = $props();
</script>

{#snippet rocker(label: string, checked: boolean, change: (on: boolean) => void, locked = disabled)}
	<label class="sd-switch"><span>{label}</span><RockerSwitch compact {label} {checked} onChange={change} disabled={locked} /></label>
{/snippet}
<section class="sd-surface sd-compact-session" aria-label="Session setup">
	<TempoDial value={player.tempo} onchange={v => player.setTempo(v)} {disabled} />
	<div class="sd-itinerary"><h2>Session form</h2>
		<div class="sd-form" role="group" aria-label="Session form">
			<div class="sd-stage" class:omitted={!hasMelody || !player.playHead}>{@render rocker('Head', hasMelody && player.playHead, v => player.setPlayHead(v), disabled || !hasMelody)}</div>
			<span class="sd-arrow" aria-hidden="true">→</span>
			<div class="sd-stage sd-choruses"><span>Choruses</span><div class="sd-count">
				<button aria-label="Fewer choruses" disabled={disabled || player.soloChoruses <= 1} onclick={() => player.setSoloChoruses(player.soloChoruses - 1)}>−</button>
				<input type="number" aria-label="Choruses" min="1" max="12" value={player.soloChoruses} {disabled} onchange={e => {
					player.setSoloChoruses(e.currentTarget.valueAsNumber);
					e.currentTarget.value = String(player.soloChoruses);
				}} />
				<button aria-label="More choruses" disabled={disabled || player.soloChoruses >= 12} onclick={() => player.setSoloChoruses(player.soloChoruses + 1)}>+</button>
			</div></div>
			<span class="sd-arrow" aria-hidden="true">→</span>
			<div class="sd-stage" class:omitted={!hasMelody || !player.playOutro}>{@render rocker('Outro', hasMelody && player.playOutro, v => player.setPlayOutro(v), disabled || !hasMelody)}</div>
		</div>
	</div>
	<div class="sd-accompaniment" role="group" aria-label="Accompaniment">
		{@render rocker('Backing track', player.backing, v => player.setBacking(v))}
		{@render rocker('Metronome', player.metronome, v => player.setMetronome(v))}
	</div>
	<div class="sd-choices">
		{@render rocker('Show key centers', centers, oncenters, false)}
		{@render rocker('Lick Practice', practice, onpractice, disabled || !canPractice)}
	</div>
</section>
