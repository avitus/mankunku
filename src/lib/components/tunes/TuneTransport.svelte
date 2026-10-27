<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import type { Tune } from '$lib/types/tune';
	import type { BackingStyle } from '$lib/types/instruments';
	import EditorIcon from '$lib/components/step-entry/EditorIcon.svelte';
	import { TunePlayer } from '$lib/state/tune-player.svelte';
	import { tuneBackingStyle } from '$lib/tunes/backing-style';
	import { BACKING_STYLE_NAMES } from '$lib/audio/backing-styles';
	const localPlayer = new TunePlayer();
	let { tune, player = localPlayer, style, compact = false, onsettings }: {
		tune: Tune; player?: TunePlayer; style?: BackingStyle; compact?: boolean; onsettings?: () => void;
	} = $props();
	const effectiveStyle = $derived(style ?? tuneBackingStyle(tune));
	/** Stop both queued and active playback from the parent’s keyboard/navigation handlers. */
	export function stop(): void { player.stop(); }
	/** Use the same production engine for buttons and the space shortcut. */
	export async function togglePlay(): Promise<void> { await player.toggle(tune, effectiveStyle, compact ? undefined : player.soloChoruses); }
	// Both callers derive a new tune on edits/transposition; track that reference.
	$effect(() => { tune; effectiveStyle; untrack(() => player.stop()); });
	onMount(() => { if (!compact) { player.restoreSoloChoruses(); player.restorePlaybackPreferences(); } });
	onDestroy(() => { player.stop(); localPlayer.dispose(); });
</script>

<div class="td-transport" class:td-desk-transport={!compact} aria-label="Tune playback">
	<button class="le-button le-play" class:td-playing={player.playing} onclick={togglePlay} aria-label={player.starting ? 'Cancel loading playback' : player.playing ? 'Stop' : 'Play tune'}><EditorIcon name={player.busy ? 'stop' : 'play'} size={16} />{player.starting ? 'Loading…' : player.playing ? 'Stop' : 'Play tune'}<kbd>space</kbd></button>
	{#if compact}<button class="le-loop" aria-pressed={player.loop} onclick={() => { player.loop = !player.loop; }}><EditorIcon name="loop" size={16} />Loop</button>{:else}<label class="td-solo-count">Solo choruses <input aria-label="Solo choruses" type="number" min="1" max="12" value={player.soloChoruses} onchange={event => player.setSoloChoruses(event.currentTarget.valueAsNumber)} /></label>{/if}
	{#if compact}
		<div class="le-tempo"><label for="tune-preview-tempo">Tempo</label><input id="tune-preview-tempo" type="number" min="40" max="240" value={player.tempo} onchange={e => player.setTempo(Number(e.currentTarget.value))} /><span>BPM</span></div>
	{:else}
		<div class="td-play-summary"><strong>{player.backing ? `${BACKING_STYLE_NAMES[effectiveStyle]} backing` : 'Backing off'}</strong><span>{player.tempo} BPM · Melody {player.melody ? 'on' : 'off'}</span></div>
		{#if onsettings}<button class="td-open-settings le-button le-quiet" onclick={onsettings}>Settings</button>{/if}
	{/if}
</div>
{#if compact}
	<div class="td-band" aria-label="Accompaniment">
		<span class="studio-label">{BACKING_STYLE_NAMES[effectiveStyle]}</span>
		<button aria-pressed={player.melody} onclick={() => { player.stop(); player.melody = !player.melody; }}>Melody <i class:active={player.melody}></i></button>
		<button aria-pressed={player.metronome} onclick={() => { player.stop(); player.metronome = !player.metronome; }}>Metronome <i class:active={player.metronome}></i></button>
		<button aria-pressed={player.backing} onclick={() => { player.stop(); player.backing = !player.backing; }}>Backing track <i class:active={player.backing}></i></button>
	</div>
{/if}
{#if player.error}<p class="td-playback-error" role="status">{player.error}</p>{/if}

<style>
.td-solo-count { display:flex; align-items:center; gap:10px; font-size:11px; color:var(--studio-muted); }
.td-solo-count input { width:52px; padding:6px; border:1px solid var(--studio-border); border-radius:3px; background:var(--studio-well); color:var(--studio-text); }
</style>
