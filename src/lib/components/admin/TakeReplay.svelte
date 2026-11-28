<script lang="ts">
	import { onDestroy } from 'svelte';
	import { mixAudio } from '$lib/audio/media-playback';
	import type { Phrase } from '$lib/types/music';
	import type { InstrumentId } from '$lib/types/instruments';
	import { createLickAudition } from '$lib/state/lick-audition.svelte';

	let { userId, take, phrase, instrument, tempo, swing }: {
		userId: string; take: string | null; phrase: Phrase | null; instrument: InstrumentId | null;
		tempo: number | null; swing: number;
	} = $props();
	const audition = createLickAudition();
	let audio: HTMLAudioElement | undefined = $state();
	let failed = $state(false);
	onDestroy(() => audition.dispose());
</script>

<div class="take-replay">
	<div><span>Reference lick</span>
		{#if phrase && tempo && instrument}
			<button class="admin-inspect" onclick={() => {
				audio?.pause();
				if (phrase && tempo && instrument) void audition.play(phrase, { tempo, swing, instrument });
			}}>{audition.state.playingId ? 'Stop reference' : 'Play reference'}</button>
		{:else}<small>{!instrument ? 'No saved instrument' : 'Reference unavailable'}</small>{/if}
		{#if audition.state.error}<small role="alert">{audition.state.error}</small>{/if}
	</div>
	<div><span>Player recording</span>
		{#if take && /^[a-zA-Z0-9_-]+$/.test(take) && !failed}
			<audio controls preload="none" crossorigin="anonymous" bind:this={audio} use:mixAudio
				src={'/admin/' + userId + '/sessions/audio/' + take} onplay={() => audition.stop()}
				onerror={() => failed = true}></audio>
		{:else}<small>Recording unavailable</small>{/if}
	</div>
</div>
