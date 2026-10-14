<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import type { Tune } from '$lib/types/tune';
	import EditorIcon from '$lib/components/step-entry/EditorIcon.svelte';
	import { settings } from '$lib/state/settings.svelte';
	import { tuneToPhrase } from '$lib/tunes/to-phrase';
	import { melodySwingForStyle } from '$lib/audio/backing-styles';
	let { tune }: { tune: Tune } = $props();
	let previewTempo = $state<number | null>(null);
	const tempo = $derived(previewTempo ?? settings.defaultTempo);
	let swingEnabled = $state(true);
	let metronome = $state(false);
	let backing = $state(false);
	let loop = $state(false);
	let playing = $state(false);
	let starting = $state(false);
	let error = $state('');
	let playback: typeof import('$lib/audio/playback') | null = null;
	let run = 0;
	let disposed = false;
	/** Cancel both scheduled playback and any pending instrument load. */
	export function stop(): void {
		run++;
		if (playing) playback?.stopPlayback();
		playing = false;
		starting = false;
	}
	/** Preview through the production engine; loop and tempo stay local to this desk. */
	export async function togglePlay(): Promise<void> {
		if (playing || starting) { stop(); return; }
		const generation = ++run;
		starting = true;
		error = '';
		try {
			playback ??= await import('$lib/audio/playback');
			if (disposed || generation !== run) return;
			await playback.loadInstrument(settings.instrumentId, settings.masterVolume, backing ? settings.backingInstrument : undefined);
			if (disposed || generation !== run) return;
			starting = false;
			playing = true;
			do {
				await playback.playPhrase(tuneToPhrase(tune, { expandRepeats: true }), {
					tempo,
					swing: backing ? melodySwingForStyle(swingEnabled ? settings.swing : 0.5, settings.backingStyle) : swingEnabled ? settings.swing : 0.5,
					countInBeats: 0, metronomeEnabled: metronome, metronomeVolume: settings.metronomeVolume,
					backingTrackEnabled: backing, backingInstrument: settings.backingInstrument,
					backingTrackVolume: settings.backingTrackVolume, backingStyle: settings.backingStyle
				});
			} while (loop && generation === run && !disposed);
		} catch {
			if (!disposed && generation === run) error = 'Playback could not start. Please try again.';
		} finally {
			if (generation === run) { playing = false; starting = false; }
		}
	}
	$effect(() => { JSON.stringify(tune); untrack(stop); });
	onDestroy(() => { disposed = true; stop(); });
</script>

<div class="td-transport" aria-label="Tune playback">
	<button class="le-button le-play" class:td-playing={playing} onclick={togglePlay} aria-label={starting ? 'Cancel loading playback' : playing ? 'Stop' : 'Play tune'}><EditorIcon name={playing || starting ? 'stop' : 'play'} size={16} />{starting ? 'Loading…' : playing ? 'Stop' : 'Play tune'}<kbd>space</kbd></button>
	<div class="le-tempo"><label for="tune-preview-tempo">Tempo</label><input id="tune-preview-tempo" type="number" min="40" max="240" value={tempo} onchange={e => { stop(); previewTempo = Math.max(40, Math.min(240, Number(e.currentTarget.value) || 40)); }} /><span>BPM</span></div>
	<button class="le-loop" aria-pressed={loop} onclick={() => { loop = !loop; }}><EditorIcon name="loop" size={16} />Loop</button>
</div>
<div class="td-band" aria-label="Accompaniment">
	<span class="studio-label">Accompaniment</span>
	<button aria-pressed={swingEnabled} onclick={() => { stop(); swingEnabled = !swingEnabled; }}>Swing <i class:active={swingEnabled}></i></button>
	<button aria-pressed={metronome} onclick={() => { stop(); metronome = !metronome; }}>Metronome <i class:active={metronome}></i></button>
	<button aria-pressed={backing} onclick={() => { stop(); backing = !backing; }}>Backing track <i class:active={backing}></i></button>
</div>
{#if error}<p class="td-playback-error" role="status">{error}</p>{/if}
