<script lang="ts">
	import RockerSwitch from '$lib/components/console/RockerSwitch.svelte';
	import { BACKING_STYLE_IDS, BACKING_STYLE_NAMES } from '$lib/audio/backing-styles';
	import { TUNE_STYLE_DESCRIPTIONS } from '$lib/tunes/backing-style';
	import type { BackingStyle } from '$lib/types/instruments';
	import type { TunePlayer } from '$lib/state/tune-player.svelte';
	let { player, style, tuneId, personal = false, idPrefix = 'desk', onsave }: {
		player: TunePlayer; style: BackingStyle; tuneId: string; personal?: boolean;
		idPrefix?: string; onsave: (style: BackingStyle) => void;
	} = $props();
	let dialog: HTMLDialogElement;
	let selected = $state<BackingStyle>('swing');
	$effect(() => { tuneId; dialog?.close(); });
	/** The saved choice changes only after the explicit save action. */
	function openStyle(): void { selected = style; dialog.showModal(); }
</script>

<section class="td-rhythm" aria-label="Rhythm and band">
	<div class="td-saved-style" class:td-style-muted={!player.backing}>
		<div><span>Tune’s backing style</span><button onclick={openStyle} disabled={player.busy} aria-label="Change backing style">Change</button></div>
		<h2>{BACKING_STYLE_NAMES[style]}</h2>
		<p>{TUNE_STYLE_DESCRIPTIONS[style]}</p>
		<small>✓ {personal ? 'Saved for your tune book' : 'Saved for this tune'}</small>
	</div>
	{#if player.busy}<p class="td-style-hint">Stop playback to change the style.</p>{/if}
	<div class="td-feel"><span>Feel</span>
		{#if player.backing}
			<strong>{style === 'swing' ? 'Swing eighths' : style === 'ballad' ? 'Gentle swing' : 'Straight eighths'}</strong>
		{:else}
			<button aria-pressed={player.swingFor(style) > 0.5} disabled={player.busy} onclick={() => player.toggleFeel(style)}>
				{player.swingFor(style) > 0.5 ? 'Swing eighths' : 'Straight eighths'}
			</button>
		{/if}
	</div>
	<label class="sd-switch">Melody <RockerSwitch compact label="Melody" checked={player.melody} onChange={on => player.setMelody(on)} /></label>
</section>

<dialog bind:this={dialog} class="le-dialog td-style-dialog" aria-labelledby={`${idPrefix}-style-title`}>
	<header><div><p class="studio-label">For this tune</p><h2 id={`${idPrefix}-style-title`}>Choose the band’s feel.</h2></div><button aria-label="Close backing style" onclick={() => dialog.close()}>×</button></header>
	<p>{personal ? 'This choice stays in your tune book. The shared chart stays as it is.' : 'Save the accompaniment that fits this tune. You can change it here later.'}</p>
	<fieldset><legend class="sr-only">Backing style</legend>{#each BACKING_STYLE_IDS as option}
		<label class:td-style-selected={selected === option}>
			<input type="radio" name={`${idPrefix}-style`} value={option} bind:group={selected} />
			<span><strong>{BACKING_STYLE_NAMES[option]} {#if style === option}<small>Saved</small>{/if}</strong><span>{TUNE_STYLE_DESCRIPTIONS[option]}</span></span>
		</label>
	{/each}</fieldset>
	<div class="le-dialog-actions"><button class="le-button le-quiet" onclick={() => dialog.close()}>Cancel</button><button class="le-button le-save" disabled={player.busy} onclick={() => { onsave(selected); dialog.close(); }}>Save for this tune</button></div>
</dialog>
