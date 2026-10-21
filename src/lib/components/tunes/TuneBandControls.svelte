<script lang="ts">
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
	<p class="studio-label td-rule-label">Rhythm & band</p>
	<label class="td-tempo-label" for={`${idPrefix}-tempo`}>Tempo</label>
	<div class="td-tempo-control">
		<button aria-label="Decrease tempo" onclick={() => player.setTempo(player.tempo - 5)} disabled={player.tempo <= 40}>−</button>
		<div><input id={`${idPrefix}-tempo`} type="number" min="40" max="240" value={player.tempo} onchange={e => player.setTempo(Number(e.currentTarget.value))} /><span>BPM</span></div>
		<button aria-label="Increase tempo" onclick={() => player.setTempo(player.tempo + 5)} disabled={player.tempo >= 240}>+</button>
	</div>
	<button class="td-setting-toggle td-backing-toggle" role="switch" aria-checked={player.backing} aria-label="Backing track" onclick={() => { player.stop(); player.backing = !player.backing; }}><strong>Backing track</strong><span>{player.backing ? 'On' : 'Off'}<i class="td-switch" class:active={player.backing} aria-hidden="true"></i></span></button>
	<div class="td-saved-style" class:td-style-muted={!player.backing}>
		<div><span>Tune’s backing style</span><button onclick={openStyle} disabled={player.busy} aria-label="Change backing style">Change</button></div>
		<h2>{BACKING_STYLE_NAMES[style]}</h2>
		<p>{TUNE_STYLE_DESCRIPTIONS[style]}</p>
		<small>✓ {personal ? 'Saved for your tune book' : 'Saved for this tune'}</small>
	</div>
	{#if player.busy}<p class="td-style-hint">Stop playback to change the style.</p>{/if}
	<div class="td-feel"><span>Feel</span><strong>{style === 'swing' ? 'Swing eighths' : style === 'ballad' ? 'Gentle swing' : 'Straight eighths'}</strong></div>
	<button class="td-setting-toggle" role="switch" aria-checked={player.melody} aria-label="Melody" onclick={() => { player.stop(); player.melody = !player.melody; }}><span>Melody</span><span>{player.melody ? 'On' : 'Off'}<i class="td-switch" class:active={player.melody} aria-hidden="true"></i></span></button>
	<button class="td-setting-toggle" role="switch" aria-checked={player.metronome} aria-label="Metronome" onclick={() => { player.stop(); player.metronome = !player.metronome; }}><span>Metronome</span><span>{player.metronome ? 'On' : 'Off'}<i class="td-switch" class:active={player.metronome} aria-hidden="true"></i></span></button>
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
